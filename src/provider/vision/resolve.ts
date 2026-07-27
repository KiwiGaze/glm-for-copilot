import * as vscode from 'vscode';
import { GLMClient, GLMRequestError } from '../../client';
import { getMaxRetries, getVisionModel, getVisionPrompt } from '../../config';
import {
	VISION_ALLOWED_IMAGE_MIME_TYPES,
	VISION_DESCRIBE_MAX_TOKENS,
	VISION_MAX_IMAGE_BYTES,
} from '../../consts';
import { resolveBaseUrl } from '../../endpoint';
import { t } from '../../i18n';
import { logger } from '../../logger';
import type { GLMChatRequest, GLMContentPart, IAuthManager, IGLMClient, StreamCallbacks } from '../../types';
import { reportThinking } from '../thinking';
import { computeDescriptionCacheKey, type VisionDescriptionCache } from './cache';
import { describedImageText, IMAGE_DESCRIPTION_UNAVAILABLE } from './consts';

/** Longest failure reason shown inside the leading notice. */
const FAILURE_REASON_MAX_LENGTH = 200;

interface VisionImage {
	mimeType: string;
	data: Uint8Array;
}

export interface VisionResolveDeps {
	authManager: IAuthManager;
	extensionVersion: string;
	cache: VisionDescriptionCache;
	/** Test seam: build the describe client. Defaults to the real GLM client. */
	createClient?: (apiKey: string, extensionVersion: string) => IGLMClient;
}

export interface VisionResolveResult {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	/** Localized notice streamed at the very start of the reply (first failure only). */
	failureNotice?: string;
}

interface ContainerContext {
	model: string;
	prompt: string;
	cache: VisionDescriptionCache;
	getClient: () => IGLMClient;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	token: vscode.CancellationToken;
}

interface ContainerResolution {
	text: string;
	failureNotice?: string;
}

/**
 * Turn image attachments into text so text-only GLM models can reason about
 * them. Each container (a user message's own images, or one tool result's
 * images) is described in a single batched call, cached by content, and its
 * image parts are replaced by a text description. Text-only messages (and all
 * messages when no API key is configured) are returned unchanged. A cancelled
 * describe call propagates as cancellation.
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
	const apiKey = await deps.authManager.getApiKey();
	if (!apiKey) {
		return { messages };
	}

	const createClient = deps.createClient ?? defaultCreateClient;
	let client: IGLMClient | undefined;
	const ctx: ContainerContext = {
		model: getVisionModel(),
		prompt: getVisionPrompt(),
		cache: deps.cache,
		getClient: () => (client ??= createClient(apiKey, deps.extensionVersion)),
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

	const key = computeDescriptionCacheKey(ctx.model, ctx.prompt, images);
	const cached = ctx.cache.get(key);
	if (cached !== undefined) {
		return { text: describedImageText(images.length, ctx.model, cached) };
	}

	reportDescribeProgress(ctx.progress, images.length, ctx.model);
	let description: string;
	try {
		description = await requestDescription(ctx.getClient(), ctx.model, ctx.prompt, images, ctx.token);
	} catch (error) {
		if (isCancellation(error, ctx.token)) {
			throw error instanceof vscode.CancellationError ? error : new vscode.CancellationError();
		}
		logger.warn('GLM vision describe failed', error);
		return failure(describeFailureReason(error));
	}

	if (!description.trim()) {
		return failure(t('vision.error.empty'));
	}
	await ctx.cache.set(key, description);
	return { text: describedImageText(images.length, ctx.model, description) };
}

/** Stream the describe request and collect its text; reuses the shared GLM client. */
async function requestDescription(
	client: IGLMClient,
	model: string,
	prompt: string,
	images: readonly VisionImage[],
	token: vscode.CancellationToken,
): Promise<string> {
	const request = buildDescribeRequest(model, prompt, images);
	let text = '';
	let failureError: unknown;
	const callbacks: StreamCallbacks = {
		onContent: (content) => {
			text += content;
		},
		onThinking: () => {},
		onToolCall: () => {},
		onError: (error) => {
			failureError = error;
		},
		onDone: () => {},
	};
	await client.streamChatCompletion(request, callbacks, token);
	if (token.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
	if (failureError !== undefined) {
		throw failureError;
	}
	return text;
}

function buildDescribeRequest(
	model: string,
	prompt: string,
	images: readonly VisionImage[],
): GLMChatRequest {
	const content: GLMContentPart[] = images.map((image) => ({
		type: 'image_url',
		image_url: { url: toDataUrl(image) },
	}));
	content.push({ type: 'text', text: prompt });
	return {
		model,
		messages: [{ role: 'user', content }],
		stream: true,
		max_tokens: VISION_DESCRIBE_MAX_TOKENS,
		thinking: { type: 'disabled' },
	};
}

function toDataUrl(image: VisionImage): string {
	return `data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}`;
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
	model: string,
): void {
	const message =
		count === 1 ? t('vision.progress.one', model) : t('vision.progress.many', String(count), model);
	reportThinking(progress, message);
}

function describeFailureReason(error: unknown): string {
	const raw =
		error instanceof GLMRequestError
			? error.userSummary
			: error instanceof Error
				? error.message
				: String(error);
	const collapsed = raw.replace(/\s+/gu, ' ').trim();
	return collapsed.length > FAILURE_REASON_MAX_LENGTH
		? `${collapsed.slice(0, FAILURE_REASON_MAX_LENGTH)}…`
		: collapsed;
}

function isCancellation(error: unknown, token: vscode.CancellationToken): boolean {
	if (error instanceof vscode.CancellationError || token.isCancellationRequested) {
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

function defaultCreateClient(apiKey: string, extensionVersion: string): IGLMClient {
	return new GLMClient(resolveBaseUrl(), apiKey, extensionVersion, getMaxRetries());
}
