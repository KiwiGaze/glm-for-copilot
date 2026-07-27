import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { getVisionEnabled, getVisionPrompt } from '../../config';
import {
	VISION_IMAGE_MIME_EXTENSIONS,
	VISION_INVOKE_TIMEOUT_MS,
	VISION_MAX_IMAGE_BYTES,
	VISION_MAX_IMAGES_PER_CONTAINER,
	VISION_TEMP_DIR_NAME,
	VISION_TEMP_MAX_FILES,
} from '../../consts';
import { t } from '../../i18n';
import { logger } from '../../logger';
import type { IAuthManager } from '../../types';
import { findVisionAnalyzeTool } from '../../vision-tool';
import { reportThinking } from '../thinking';
import { isImageDataPart } from '../tokens';
import {
	computeDescriptionCacheKey,
	hashImageContent,
	type VisionDescriptionCache,
	type VisionImage,
} from './cache';
import { describedImageText, IMAGE_DESCRIPTION_UNAVAILABLE } from './consts';

/** Longest failure reason shown inside the leading notice. */
const FAILURE_REASON_MAX_LENGTH = 200;

/**
 * The vision MCP server reports tool-level failures as a single-line text
 * payload (`Error: …`, `isError: true`); VS Code surfaces only the text to us.
 * Multi-line results are treated as real analyses — a successful transcription
 * of an error screenshot can legitimately start with "Error:".
 */
const MCP_TOOL_ERROR_PREFIX = /^error:\s/i;

type InvokeTool = (
	name: string,
	input: Record<string, unknown>,
	token: vscode.CancellationToken,
) => Promise<vscode.LanguageModelToolResult>;

export interface VisionResolveDeps {
	authManager: IAuthManager;
	cache: VisionDescriptionCache;
	/** Base directory (globalStorage) for temp image files handed to the MCP tool. */
	storageDir: string;
	/** Test seam: locate the vision analyze tool. Defaults to a live `lm.tools` lookup. */
	findTool?: () => vscode.LanguageModelToolInformation | undefined;
	/** Test seam: invoke an MCP tool. Defaults to `vscode.lm.invokeTool`. */
	invokeTool?: InvokeTool;
	/** Test seam: per-analysis timeout. Defaults to VISION_INVOKE_TIMEOUT_MS. */
	timeoutMs?: number;
}

export interface VisionResolveResult {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	/** Localized notice streamed at the very start of the reply (first failure only). */
	failureNotice?: string;
}

interface ContainerContext {
	prompt: string;
	cache: VisionDescriptionCache;
	imageDir: string;
	toolName: string;
	invokeTool: InvokeTool;
	timeoutMs: number;
	/** Set when analysis cannot run at all (no tool / no API key); failures are not cached. */
	preflightFailure?: string;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	token: vscode.CancellationToken;
}

interface ContainerResolution {
	text: string;
	failureNotice?: string;
}

interface ImageRun {
	images: VisionImage[];
	nextIndex: number;
}

/**
 * Turn image attachments into text so text-only GLM models can reason about
 * them. Runs on every chat request — a cheap no-op for text-only messages.
 * Each container (a user message's own images, or one tool result's images) is
 * written to a per-run temp directory (removed once the run settles) and
 * analyzed through the vision MCP `analyze_image` tool, cached by content for
 * the session, and its image parts are replaced by a text description. A
 * cancelled request propagates as cancellation; when vision is turned off, the
 * server is unavailable, or analysis fails, the container degrades to the
 * unavailable marker + notice — no image is written to disk or sent anywhere.
 * Cached descriptions still resolve so history stays coherent.
 */
export async function resolveVisionMessages(
	deps: VisionResolveDeps,
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	token: vscode.CancellationToken,
): Promise<VisionResolveResult> {
	if (!messages.some(messageHasImages)) {
		return { messages };
	}

	let preflightFailure: string | undefined;
	let toolName: string | undefined;
	if (!getVisionEnabled()) {
		preflightFailure = t('vision.error.disabled');
	} else {
		const tool = (deps.findTool ?? findVisionAnalyzeTool)();
		if (!tool) {
			preflightFailure = t('vision.error.toolUnavailable');
		} else if (!(await deps.authManager.getApiKey())) {
			preflightFailure = t('vision.error.noKey');
		} else {
			toolName = tool.name;
		}
	}

	const ctx: ContainerContext = {
		prompt: getVisionPrompt(),
		cache: deps.cache,
		imageDir: getVisionTempDir(deps.storageDir),
		toolName: toolName ?? '',
		invokeTool: deps.invokeTool ?? defaultInvokeTool,
		timeoutMs: deps.timeoutMs ?? VISION_INVOKE_TIMEOUT_MS,
		preflightFailure,
		progress,
		token,
	};

	const resolved: vscode.LanguageModelChatRequestMessage[] = [];
	let failureNotice: string | undefined;
	for (const message of messages) {
		if (!messageHasImages(message)) {
			resolved.push(message);
			continue;
		}
		const { content, notice } = await resolveMessageContent(message, ctx);
		failureNotice ??= notice;
		resolved.push(createResolvedMessage(message, content));
	}
	return { messages: resolved, failureNotice };
}

async function resolveMessageContent(
	message: vscode.LanguageModelChatRequestMessage,
	ctx: ContainerContext,
): Promise<{ content: vscode.LanguageModelInputPart[]; notice?: string }> {
	const parts = message.content as readonly vscode.LanguageModelInputPart[];
	const content: vscode.LanguageModelInputPart[] = [];
	let notice: string | undefined;

	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		if (isImageDataPart(part)) {
			const run = collectImageRun(parts, index);
			const resolution = await resolveContainer(run.images, ctx);
			notice ??= resolution.failureNotice;
			content.push(new vscode.LanguageModelTextPart(resolution.text));
			index = run.nextIndex - 1;
			continue;
		}
		if (isToolResultWithImages(part)) {
			const resolution = await resolveToolResult(part, ctx);
			notice ??= resolution.failureNotice;
			content.push(resolution.part);
			continue;
		}
		content.push(part);
	}
	return { content, notice };
}

async function resolveToolResult(
	part: vscode.LanguageModelToolResultPart,
	ctx: ContainerContext,
): Promise<{ part: vscode.LanguageModelToolResultPart; failureNotice?: string }> {
	const items = part.content as readonly unknown[];
	const content: unknown[] = [];
	let failureNotice: string | undefined;
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		if (isImageDataPart(item)) {
			const run = collectImageRun(items, index);
			const resolution = await resolveContainer(run.images, ctx);
			failureNotice ??= resolution.failureNotice;
			content.push(new vscode.LanguageModelTextPart(resolution.text));
			index = run.nextIndex - 1;
		} else {
			content.push(item);
		}
	}
	return {
		part: new vscode.LanguageModelToolResultPart(part.callId, content),
		failureNotice,
	};
}

function collectImageRun(parts: readonly unknown[], startIndex: number): ImageRun {
	const images: VisionImage[] = [];
	let nextIndex = startIndex;
	while (nextIndex < parts.length) {
		const part = parts[nextIndex];
		if (!isImageDataPart(part)) {
			break;
		}
		images.push(toVisionImage(part));
		nextIndex += 1;
	}
	return { images, nextIndex };
}

async function resolveContainer(
	images: readonly VisionImage[],
	ctx: ContainerContext,
): Promise<ContainerResolution> {
	const invalidReason = findInvalidImageReason(images);
	if (invalidReason) {
		return failure(invalidReason);
	}

	// Cache first: a stored analysis survives a stopped/uninstalled server.
	const imageHashes = images.map((image) => hashImageContent(image.data));
	const key = computeDescriptionCacheKey(ctx.prompt, imageHashes);
	const cached = ctx.cache.get(key);
	if (cached !== undefined) {
		return { text: describedImageText(images.length, cached) };
	}
	if (ctx.preflightFailure) {
		return failure(ctx.preflightFailure);
	}

	// Abort before any side effect: an already-cancelled token only fires
	// onCancellationRequested asynchronously, so the run would write files and
	// call MCP for a dead request before cancellation lands.
	if (ctx.token.isCancellationRequested) {
		throw new vscode.CancellationError();
	}

	reportDescribeProgress(ctx.progress, images.length);
	let description: string;
	try {
		await mkdir(ctx.imageDir, { recursive: true });
		await pruneTempImages(ctx.imageDir);
		description = await analyzeImages(images, imageHashes, ctx);
	} catch (error) {
		if (ctx.token.isCancellationRequested) {
			throw error instanceof vscode.CancellationError ? error : new vscode.CancellationError();
		}
		if (isCancellationError(error)) {
			// Only our own timeout cancels the invocation when the request is alive.
			return failure(t('vision.error.timeout'));
		}
		logger.warn('GLM Vision image analysis failed', error);
		return failure(analysisFailureReason(error));
	}

	if (!description.trim()) {
		return failure(t('vision.error.empty'));
	}
	ctx.cache.set(key, description);
	return { text: describedImageText(images.length, description) };
}

/**
 * Write the images into a per-run temp directory (the MCP tool only accepts
 * paths/URLs, not data URLs) and analyze them in parallel through the vision
 * MCP tool. Multiple images are joined with `Image N:` labels. The first
 * failed call cancels its siblings, and the run directory is removed once the
 * run settles so image content never lingers on disk.
 */
async function analyzeImages(
	images: readonly VisionImage[],
	imageHashes: readonly string[],
	ctx: ContainerContext,
): Promise<string> {
	const runDir = join(ctx.imageDir, randomUUID());
	await mkdir(runDir, { recursive: true });
	const cts = new vscode.CancellationTokenSource();
	const subscription = ctx.token.onCancellationRequested(() => cts.cancel());
	// Cancellation can land between the caller's check and this subscription.
	if (ctx.token.isCancellationRequested) {
		cts.cancel();
	}
	const timer = setTimeout(() => cts.cancel(), ctx.timeoutMs);
	try {
		const texts = await Promise.all(
			images.map(async (image, index) => {
				const filePath = await writeImageFile(runDir, image, imageHashes[index]);
				const result = await ctx.invokeTool(
					ctx.toolName,
					{ image_source: filePath, prompt: ctx.prompt },
					cts.token,
				);
				const text = toolResultText(result).trim();
				if (!text.includes('\n') && MCP_TOOL_ERROR_PREFIX.test(text)) {
					throw new Error(text);
				}
				return text;
			}),
		);
		if (texts.some((text) => !text)) {
			return '';
		}
		return texts.length === 1
			? texts[0]
			: texts.map((text, index) => `Image ${index + 1}:\n${text}`).join('\n\n');
	} finally {
		clearTimeout(timer);
		subscription.dispose();
		cts.cancel();
		cts.dispose();
		try {
			await rm(runDir, { recursive: true, force: true });
		} catch (error) {
			logger.warn('Failed to remove GLM Vision temp images', error);
		}
	}
}

/** Directory (under `storageDir`) holding temp image files handed to the MCP tool. */
export function getVisionTempDir(storageDir: string): string {
	return join(storageDir, VISION_TEMP_DIR_NAME);
}

/** Write the image into the run directory unless already present (hash name ⇒ no duplicates). */
async function writeImageFile(dir: string, image: VisionImage, hash: string): Promise<string> {
	const ext = VISION_IMAGE_MIME_EXTENSIONS[image.mimeType.toLowerCase()];
	const filePath = join(dir, `${hash.slice(0, 32)}.${ext}`);
	try {
		await writeFile(filePath, image.data, { flag: 'wx' });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
			throw error;
		}
	}
	return filePath;
}

/** Bound the temp dir so it stays within VISION_TEMP_MAX_FILES once the run dir is created. */
async function pruneTempImages(dir: string): Promise<void> {
	try {
		const names = await readdir(dir);
		const retainedLimit = VISION_TEMP_MAX_FILES - 1;
		if (names.length <= retainedLimit) {
			return;
		}
		const entries = await Promise.all(
			names.map(async (name) => ({
				name,
				mtimeMs: (await stat(join(dir, name))).mtimeMs,
			})),
		);
		entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
		for (const entry of entries.slice(0, entries.length - retainedLimit)) {
			await rm(join(dir, entry.name), { recursive: true, force: true });
		}
	} catch (error) {
		logger.warn('Failed to prune GLM Vision temp images', error);
	}
}

function toolResultText(result: vscode.LanguageModelToolResult): string {
	return result.content
		.filter(
			(part): part is vscode.LanguageModelTextPart =>
				part instanceof vscode.LanguageModelTextPart,
		)
		.map((part) => part.value)
		.join('\n');
}

async function defaultInvokeTool(
	name: string,
	input: Record<string, unknown>,
	token: vscode.CancellationToken,
): Promise<vscode.LanguageModelToolResult> {
	// `toolInvocationToken: undefined` — this runs outside a chat participant
	// request, so VS Code shows no inline UI (except tool confirmations).
	return vscode.lm.invokeTool(name, { input, toolInvocationToken: undefined }, token);
}

/** First localized reason an image run is rejected (too many / unsupported type / too large), or undefined. */
function findInvalidImageReason(images: readonly VisionImage[]): string | undefined {
	if (images.length > VISION_MAX_IMAGES_PER_CONTAINER) {
		return t('vision.error.tooMany', String(VISION_MAX_IMAGES_PER_CONTAINER));
	}
	for (const image of images) {
		if (VISION_IMAGE_MIME_EXTENSIONS[image.mimeType.toLowerCase()] === undefined) {
			return t('vision.error.unsupportedType', image.mimeType);
		}
		if (image.data.byteLength > VISION_MAX_IMAGE_BYTES) {
			const limitMb = String(Math.round(VISION_MAX_IMAGE_BYTES / (1024 * 1024)));
			return t('vision.error.tooLarge', limitMb);
		}
	}
	return undefined;
}

function failure(reason: string): ContainerResolution {
	return { text: IMAGE_DESCRIPTION_UNAVAILABLE, failureNotice: t('vision.notice.failed', reason) };
}

function reportDescribeProgress(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	count: number,
): void {
	const message = count === 1 ? t('vision.progress.one') : t('vision.progress.many', String(count));
	reportThinking(progress, message);
}

function analysisFailureReason(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	const collapsed = raw.replace(/\s+/gu, ' ').trim();
	return collapsed.length > FAILURE_REASON_MAX_LENGTH
		? `${collapsed.slice(0, FAILURE_REASON_MAX_LENGTH)}…`
		: collapsed;
}

function isCancellationError(error: unknown): boolean {
	if (error instanceof vscode.CancellationError) {
		return true;
	}
	const name = (error as { name?: string } | undefined)?.name;
	return name === 'Canceled' || name === 'AbortError';
}

function messageHasImages(message: vscode.LanguageModelChatRequestMessage): boolean {
	return (message.content as readonly unknown[]).some(
		(part) => isImageDataPart(part) || isToolResultWithImages(part),
	);
}

function isToolResultWithImages(part: unknown): part is vscode.LanguageModelToolResultPart {
	return (
		part instanceof vscode.LanguageModelToolResultPart &&
		(part.content as readonly unknown[]).some(isImageDataPart)
	);
}

function toVisionImage(part: vscode.LanguageModelDataPart): VisionImage {
	return { mimeType: part.mimeType, data: part.data };
}

function createResolvedMessage(
	message: vscode.LanguageModelChatRequestMessage,
	content: readonly vscode.LanguageModelInputPart[],
): vscode.LanguageModelChatRequestMessage {
	return {
		role: message.role,
		content,
		name: message.name,
	} as unknown as vscode.LanguageModelChatRequestMessage;
}
