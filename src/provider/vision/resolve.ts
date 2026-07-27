import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { getVisionEnabled, getVisionPrompt } from '../../config';
import {
	VISION_ALLOWED_IMAGE_MIME_TYPES,
	VISION_IMAGE_MIME_EXTENSIONS,
	VISION_INVOKE_TIMEOUT_MS,
	VISION_MAX_IMAGE_BYTES,
	VISION_TEMP_DIR_NAME,
	VISION_TEMP_MAX_FILES,
} from '../../consts';
import { t } from '../../i18n';
import { logger } from '../../logger';
import type { IAuthManager } from '../../types';
import { findVisionAnalyzeTool } from '../../vision-tool';
import { reportThinking } from '../thinking';
import { computeDescriptionCacheKey, hashImageContent, type VisionDescriptionCache } from './cache';
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

interface VisionImage {
	mimeType: string;
	data: Uint8Array;
}

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

/**
 * Turn image attachments into text so text-only GLM models can reason about
 * them. Runs on every chat request — a cheap no-op for text-only messages.
 * Each container (a user message's own images, or one tool result's images) is
 * written to temp files and analyzed through the vision MCP `analyze_image`
 * tool, cached by content, and its image parts are replaced by a text
 * description. A cancelled request propagates as cancellation; when vision is
 * turned off, the server is unavailable, or analysis fails, the container
 * degrades to the unavailable marker + notice — no image is written to disk or
 * sent anywhere. Cached descriptions still resolve so history stays coherent.
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
		imageDir: join(deps.storageDir, VISION_TEMP_DIR_NAME),
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
	const directImages = parts.filter(isImageDataPart).map(toVisionImage);
	const content: vscode.LanguageModelInputPart[] = [];
	let injectedDirect = false;
	let notice: string | undefined;

	for (const part of parts) {
		if (isImageDataPart(part)) {
			if (!injectedDirect) {
				injectedDirect = true;
				const resolution = await resolveContainer(directImages, ctx);
				notice ??= resolution.failureNotice;
				content.push(new vscode.LanguageModelTextPart(resolution.text));
			}
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
	const images = items.filter(isImageDataPart).map(toVisionImage);
	const kept = items.filter((item) => !isImageDataPart(item));
	const resolution = await resolveContainer(images, ctx);
	return {
		part: new vscode.LanguageModelToolResultPart(part.callId, [
			...kept,
			new vscode.LanguageModelTextPart(resolution.text),
		]),
		failureNotice: resolution.failureNotice,
	};
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
	const key = computeDescriptionCacheKey(ctx.prompt, images);
	const cached = ctx.cache.get(key);
	if (cached !== undefined) {
		return { text: describedImageText(images.length, cached) };
	}
	if (ctx.preflightFailure) {
		return failure(ctx.preflightFailure);
	}

	reportDescribeProgress(ctx.progress, images.length);
	let description: string;
	try {
		description = await analyzeImages(images, ctx);
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
	await ctx.cache.set(key, description);
	return { text: describedImageText(images.length, description) };
}

/**
 * Write each image to a content-addressed temp file (the MCP tool only accepts
 * paths/URLs, not data URLs) and analyze them in parallel through the vision
 * MCP tool. Multiple images are joined with `Image N:` labels.
 */
async function analyzeImages(images: readonly VisionImage[], ctx: ContainerContext): Promise<string> {
	await mkdir(ctx.imageDir, { recursive: true });
	await pruneTempImages(ctx.imageDir);

	const cts = new vscode.CancellationTokenSource();
	const subscription = ctx.token.onCancellationRequested(() => cts.cancel());
	const timer = setTimeout(() => cts.cancel(), ctx.timeoutMs);
	try {
		const texts = await Promise.all(
			images.map(async (image) => {
				const filePath = await ensureImageFile(ctx.imageDir, image);
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
		if (texts.every((text) => !text)) {
			return '';
		}
		return texts.length === 1
			? texts[0]
			: texts.map((text, index) => `Image ${index + 1}:\n${text}`).join('\n\n');
	} finally {
		clearTimeout(timer);
		subscription.dispose();
		cts.dispose();
	}
}

/** Write the image unless already present (content hash name ⇒ no duplicates). */
async function ensureImageFile(dir: string, image: VisionImage): Promise<string> {
	const hash = hashImageContent(image.data).slice(0, 32);
	const ext = VISION_IMAGE_MIME_EXTENSIONS[image.mimeType.toLowerCase()];
	const filePath = join(dir, `${hash}.${ext}`);
	try {
		await writeFile(filePath, image.data, { flag: 'wx' });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
			throw error;
		}
	}
	return filePath;
}

/** Bound the temp dir to VISION_TEMP_MAX_FILES, evicting oldest-mtime files. */
async function pruneTempImages(dir: string): Promise<void> {
	try {
		const names = await readdir(dir);
		if (names.length <= VISION_TEMP_MAX_FILES) {
			return;
		}
		const entries = await Promise.all(
			names.map(async (name) => ({
				name,
				mtimeMs: (await stat(join(dir, name))).mtimeMs,
			})),
		);
		entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
		for (const entry of entries.slice(0, entries.length - VISION_TEMP_MAX_FILES)) {
			await unlink(join(dir, entry.name));
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

/** First localized reason an image is rejected (unsupported type / too large), or undefined. */
function findInvalidImageReason(images: readonly VisionImage[]): string | undefined {
	for (const image of images) {
		if (!VISION_ALLOWED_IMAGE_MIME_TYPES.includes(image.mimeType.toLowerCase())) {
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

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
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
