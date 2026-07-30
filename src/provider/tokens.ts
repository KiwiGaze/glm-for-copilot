import * as vscode from 'vscode';
import { VISION_DESCRIPTION_MAX_TOKENS } from '../consts';
import { computeDescriptionCacheKey, hashImageContent, type VisionDescriptionCache } from './vision/cache';
import { describedImageText, IMAGE_DESCRIPTION_UNAVAILABLE } from './vision/consts';
import { collectImagePartRun, isImageDataPart } from './vision/parts';
import { findInvalidImageReason } from './vision/resolve';
import { isThinkingPart } from './thinking';

const DATA_PART_MAX_CHARS = 10000;
const MULTI_IMAGE_LABEL_ESTIMATED_CHARS = 16;

/** Resolve the real char count of an image container, or undefined to use its maximum budget. */
export type ImageContainerChars = (
	images: readonly vscode.LanguageModelDataPart[],
) => number | undefined;

/**
 * Char count of the text an image container is replaced with, from the vision
 * description cache. Containers use the same ordered multi-image key as vision
 * resolution, so cached descriptions are counted exactly.
 */
export function cachedImageDescriptionChars(
	cache: VisionDescriptionCache,
	prompt: string,
): ImageContainerChars {
	return (images) => {
		const imageHashes = images.map((image) => hashImageContent(image.data));
		const cached = cache.get(computeDescriptionCacheKey(prompt, imageHashes));
		return cached === undefined ? undefined : describedImageText(images.length, cached).length;
	};
}

function estimatePartChars(
	part: unknown,
	charsPerToken: number,
	imageChars?: ImageContainerChars,
): number {
	if (part instanceof vscode.LanguageModelTextPart) {
		return part.value.length;
	}
	if (part instanceof vscode.LanguageModelToolCallPart) {
		let chars = part.callId.length + part.name.length;
		try {
			chars += JSON.stringify(part.input).length;
		} catch {
			chars += 2;
		}
		return chars;
	}
	if (part instanceof vscode.LanguageModelToolResultPart) {
		return (
			part.callId.length +
			(Array.isArray(part.content)
				? estimateContentChars(part.content, charsPerToken, imageChars)
				: 0)
		);
	}
	if (part instanceof vscode.LanguageModelDataPart) {
		return Math.min(part.data?.byteLength ?? 0, DATA_PART_MAX_CHARS);
	}
	if (isThinkingPart(part)) {
		if (typeof part.value === 'string') {
			return part.value.length;
		}
		if (Array.isArray(part.value)) {
			let chars = 0;
			for (const text of part.value) {
				chars += text.length;
			}
			return chars;
		}
		return 0;
	}
	if (part && typeof part === 'object') {
		try {
			return JSON.stringify(part).length;
		} catch {
			return 0;
		}
	}
	return 0;
}

function estimateContentChars(
	content: readonly unknown[],
	charsPerToken: number,
	imageChars?: ImageContainerChars,
): number {
	let totalChars = 0;
	for (let index = 0; index < content.length; index += 1) {
		const part = content[index];
		if (!isImageDataPart(part)) {
			totalChars += estimatePartChars(part, charsPerToken, imageChars);
			continue;
		}
		const run = collectImagePartRun(content, index);
		totalChars += estimateImageContainerChars(run.images, charsPerToken, imageChars);
		index = run.nextIndex - 1;
	}
	return totalChars;
}

function estimateImageContainerChars(
	images: readonly vscode.LanguageModelDataPart[],
	charsPerToken: number,
	imageChars?: ImageContainerChars,
): number {
	if (findInvalidImageReason(images) !== undefined) {
		return IMAGE_DESCRIPTION_UNAVAILABLE.length;
	}
	const cachedChars = imageChars?.(images);
	if (cachedChars !== undefined) {
		return cachedChars;
	}
	const descriptionChars = images.length * VISION_DESCRIPTION_MAX_TOKENS * charsPerToken;
	const labels = images.length > 1 ? images.length * MULTI_IMAGE_LABEL_ESTIMATED_CHARS : 0;
	return descriptionChars + labels + describedImageText(images.length, '').length;
}

/** Estimate the token count of a string or chat message. */
export function estimateTokenCount(
	text: string | vscode.LanguageModelChatRequestMessage,
	charsPerToken: number,
	imageChars?: ImageContainerChars,
): number {
	if (typeof text === 'string') {
		return Math.max(1, Math.ceil(text.length / charsPerToken));
	}
	if (!text?.content || !Array.isArray(text.content)) {
		return 1;
	}
	const totalChars = estimateContentChars(text.content, charsPerToken, imageChars);
	return Math.max(1, Math.ceil(totalChars / charsPerToken));
}
