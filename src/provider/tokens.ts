import * as vscode from 'vscode';

const IMAGE_PART_ESTIMATED_CHARS = 1020;
const DATA_PART_MAX_CHARS = 10000;

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
export function estimatePartChars(part: unknown): number {
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
				chars += estimatePartChars(item);
			}
		}
		return chars;
	}
	if (isImageDataPart(part)) {
		return IMAGE_PART_ESTIMATED_CHARS;
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
): number {
	if (typeof text === 'string') {
		return Math.max(1, Math.ceil(text.length / charsPerToken));
	}
	if (!text?.content || !Array.isArray(text.content)) {
		return 1;
	}
	let totalChars = 0;
	for (const part of text.content) {
		totalChars += estimatePartChars(part);
	}
	return Math.max(1, Math.ceil(totalChars / charsPerToken));
}

function isThinkingPart(part: unknown): part is ThinkingPartLike {
	const ctor = (vscode as { LanguageModelThinkingPart?: unknown }).LanguageModelThinkingPart;
	return typeof ctor === 'function' && part instanceof (ctor as new (...args: never[]) => object);
}
