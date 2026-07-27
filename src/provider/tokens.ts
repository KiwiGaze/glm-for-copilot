import * as vscode from 'vscode';
import { computeDescriptionCacheKey, hashImageContent, type VisionDescriptionCache } from './vision/cache';
import { describedImageText } from './vision/consts';

const IMAGE_PART_ESTIMATED_CHARS = 1020;
const DATA_PART_MAX_CHARS = 10000;

/** Resolve the real char count of an image part, or undefined to fall back to the estimate. */
export type ImagePartChars = (part: vscode.LanguageModelDataPart) => number | undefined;

/**
 * Char count of the text an image part is replaced with, from the vision
 * description cache: resolved descriptions are unbounded, so the flat estimate
 * undercounts successful vision requests. Only single-image containers are
 * keyed per image; cache misses keep the flat estimate.
 */
export function cachedImageDescriptionChars(
	cache: VisionDescriptionCache,
	prompt: string,
): ImagePartChars {
	return (part) => {
		const cached = cache.get(computeDescriptionCacheKey(prompt, [hashImageContent(part.data)]));
		return cached === undefined ? undefined : describedImageText(1, cached).length;
	};
}

/**
 * A `LanguageModelThinkingPart`-shaped value. The thinking part is a proposed
 * VS Code API, so it is feature-detected and read through this narrow shape.
 */
interface ThinkingPartLike {
	value: string | string[];
}

/** Whether the part is a `LanguageModelDataPart` holding image bytes. */
export function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType.toLowerCase().startsWith('image/');
}

/** Estimate the character count of a single content part. */
export function estimatePartChars(part: unknown, imageChars?: ImagePartChars): number {
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
		let chars = part.callId.length;
		if (Array.isArray(part.content)) {
			for (const item of part.content) {
				chars += estimatePartChars(item, imageChars);
			}
		}
		return chars;
	}
	if (isImageDataPart(part)) {
		return imageChars?.(part) ?? IMAGE_PART_ESTIMATED_CHARS;
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

/** Estimate the token count of a string or chat message. */
export function estimateTokenCount(
	text: string | vscode.LanguageModelChatRequestMessage,
	charsPerToken: number,
	imageChars?: ImagePartChars,
): number {
	if (typeof text === 'string') {
		return Math.max(1, Math.ceil(text.length / charsPerToken));
	}
	if (!text?.content || !Array.isArray(text.content)) {
		return 1;
	}
	let totalChars = 0;
	for (const part of text.content) {
		totalChars += estimatePartChars(part, imageChars);
	}
	return Math.max(1, Math.ceil(totalChars / charsPerToken));
}

function isThinkingPart(part: unknown): part is ThinkingPartLike {
	const ctor = (vscode as { LanguageModelThinkingPart?: unknown }).LanguageModelThinkingPart;
	return typeof ctor === 'function' && part instanceof (ctor as new (...args: never[]) => object);
}
