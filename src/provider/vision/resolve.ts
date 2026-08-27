import * as vscode from 'vscode';
import { getVisionPrompt } from '../../config';
import {
	VISION_IMAGE_MIME_EXTENSIONS,
	VISION_MAX_IMAGE_BYTES,
	VISION_MAX_IMAGES_PER_REQUEST,
} from '../../consts';
import { t } from '../../i18n';
import { logger } from '../../logger';
import { reportThinking } from '../thinking';
import {
	FlashAnalysisTimeoutError,
	type FlashAnalysisTarget,
	type FlashImageAnalyzer,
} from './analyze';
import {
	computeDescriptionCacheKey,
	hashImageContent,
	type VisionDescriptionCache,
	type VisionImage,
} from './cache';
import { describedImageText, IMAGE_DESCRIPTION_UNAVAILABLE } from './consts';
import { collectImagePartRun, isImageDataPart } from './parts';

const FAILURE_REASON_MAX_LENGTH = 200;

export interface VisionResolveDeps {
	analyzer: Pick<FlashImageAnalyzer, 'getTarget' | 'analyze'>;
	cache: VisionDescriptionCache;
	nativeImageInput: boolean;
	/** Test seam. Production uses the configured Flash image-analysis prompt. */
	prompt?: string;
}

export interface VisionResolveResult {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	/** Localized notice streamed at the start of the reply (first failure only). */
	failureNotice?: string;
}

interface ContainerContext {
	analyzer: VisionResolveDeps['analyzer'];
	cache: VisionDescriptionCache;
	nativeImageInput: boolean;
	prompt: string;
	target: FlashAnalysisTarget;
	requestValidationFailure?: string;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	token: vscode.CancellationToken;
}

interface ContainerResolution {
	text: string;
	failureNotice?: string;
}

interface ResolvedImagePartRun {
	parts: vscode.LanguageModelInputPart[];
	nextIndex: number;
	failureNotice?: string;
}

/**
 * Route image containers before wire conversion. Native-capable models retain
 * valid images in user messages. Every other container is described once by
 * GLM-5.3-Flash and replaced with explicitly untrusted text.
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
	if (token.isCancellationRequested) {
		throw new vscode.CancellationError();
	}

	const requestImages = collectImages(messages);
	const ctx: ContainerContext = {
		analyzer: deps.analyzer,
		cache: deps.cache,
		nativeImageInput: deps.nativeImageInput,
		prompt: deps.prompt ?? getVisionPrompt(),
		target: deps.analyzer.getTarget(),
		requestValidationFailure:
			requestImages.length > VISION_MAX_IMAGES_PER_REQUEST
				? t('vision.error.tooMany', String(VISION_MAX_IMAGES_PER_REQUEST))
				: undefined,
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
		const result = await resolveMessageContent(message, ctx);
		failureNotice ??= result.notice;
		resolved.push(createResolvedMessage(message, result.content));
	}
	return { messages: resolved, failureNotice };
}

async function resolveMessageContent(
	message: vscode.LanguageModelChatRequestMessage,
	ctx: ContainerContext,
): Promise<{ content: vscode.LanguageModelInputPart[]; notice?: string }> {
	const source = message.content as readonly vscode.LanguageModelInputPart[];
	const content: vscode.LanguageModelInputPart[] = [];
	let notice: string | undefined;
	const allowNativeUserImages =
		ctx.nativeImageInput && message.role === vscode.LanguageModelChatMessageRole.User;

	for (let index = 0; index < source.length; index += 1) {
		const part = source[index];
		if (isImageDataPart(part)) {
			const resolution = await routeImagePartRun(source, index, allowNativeUserImages, ctx);
			notice ??= resolution.failureNotice;
			content.push(...resolution.parts);
			index = resolution.nextIndex - 1;
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

async function routeImagePartRun(
	parts: readonly unknown[],
	startIndex: number,
	allowNative: boolean,
	ctx: ContainerContext,
): Promise<ResolvedImagePartRun> {
	const run = collectImagePartRun(parts, startIndex);
	const images = run.images.map(toVisionImage);
	const invalidReason = ctx.requestValidationFailure ?? findInvalidImageReason(images);
	if (allowNative && invalidReason === undefined) {
		return { parts: run.images, nextIndex: run.nextIndex };
	}
	const resolution = invalidReason
		? failure(invalidReason)
		: await resolveContainer(images, ctx);
	return {
		parts: [new vscode.LanguageModelTextPart(resolution.text)],
		nextIndex: run.nextIndex,
		failureNotice: resolution.failureNotice,
	};
}

async function resolveToolResult(
	part: vscode.LanguageModelToolResultPart,
	ctx: ContainerContext,
): Promise<{ part: vscode.LanguageModelToolResultPart; failureNotice?: string }> {
	const source = part.content as readonly unknown[];
	const content: unknown[] = [];
	let failureNotice: string | undefined;
	for (let index = 0; index < source.length; index += 1) {
		const item = source[index];
		if (!isImageDataPart(item)) {
			content.push(item);
			continue;
		}
		const resolution = await routeImagePartRun(source, index, false, ctx);
		failureNotice ??= resolution.failureNotice;
		content.push(...resolution.parts);
		index = resolution.nextIndex - 1;
	}
	return {
		part: new vscode.LanguageModelToolResultPart(part.callId, content),
		failureNotice,
	};
}

async function resolveContainer(
	images: readonly VisionImage[],
	ctx: ContainerContext,
): Promise<ContainerResolution> {
	const key = descriptionCacheKey(ctx.target, ctx.prompt, images);
	const cached = ctx.cache.get(key);
	if (cached !== undefined) {
		return { text: describedImageText(images.length, cached) };
	}
	if (ctx.token.isCancellationRequested) {
		throw new vscode.CancellationError();
	}

	reportDescribeProgress(ctx.progress, images.length);
	let description: string;
	try {
		description = await ctx.analyzer.analyze(ctx.target, images, ctx.prompt, ctx.token);
	} catch (error) {
		if (ctx.token.isCancellationRequested || error instanceof vscode.CancellationError) {
			throw error instanceof vscode.CancellationError ? error : new vscode.CancellationError();
		}
		if (error instanceof FlashAnalysisTimeoutError) {
			return failure(t('vision.error.timeout'));
		}
		logger.warn('GLM-5.3-Flash image analysis failed', error);
		return failure(analysisFailureReason(error));
	}
	if (!description.trim()) {
		return failure(t('vision.error.empty'));
	}

	ctx.cache.set(key, description);
	return { text: describedImageText(images.length, description) };
}

export function descriptionCacheKey(
	target: FlashAnalysisTarget,
	prompt: string,
	images: readonly VisionImage[],
): string {
	return computeDescriptionCacheKey({
		baseUrl: target.baseUrl,
		modelId: target.modelId,
		prompt,
		images: images.map((image) => ({
			mimeType: image.mimeType,
			contentHash: hashImageContent(image.data),
		})),
	});
}

/** Reason a container is rejected before any network request, if any. */
export function findInvalidImageReason(images: readonly VisionImage[]): string | undefined {
	if (images.length > VISION_MAX_IMAGES_PER_REQUEST) {
		return t('vision.error.tooMany', String(VISION_MAX_IMAGES_PER_REQUEST));
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

function collectImages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): VisionImage[] {
	const images: VisionImage[] = [];
	for (const message of messages) {
		for (const part of message.content as readonly unknown[]) {
			if (isImageDataPart(part)) {
				images.push(toVisionImage(part));
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				for (const item of part.content as readonly unknown[]) {
					if (isImageDataPart(item)) {
						images.push(toVisionImage(item));
					}
				}
			}
		}
	}
	return images;
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
