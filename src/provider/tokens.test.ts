import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
	class LanguageModelTextPart {
		constructor(public value: string) {}
	}
	class LanguageModelDataPart {
		constructor(
			public data: Uint8Array,
			public mimeType: string,
		) {}
	}
	class LanguageModelToolResultPart {
		constructor(
			public callId: string,
			public content: unknown[],
		) {}
	}
	class LanguageModelToolCallPart {
		constructor(
			public callId: string,
			public name: string,
			public input: object,
		) {}
	}
	return { LanguageModelTextPart, LanguageModelDataPart, LanguageModelToolResultPart, LanguageModelToolCallPart };
});

import * as vscode from 'vscode';
import { VISION_DESCRIPTION_MAX_TOKENS } from '../consts';
import { cachedImageDescriptionChars, estimateTokenCount } from './tokens';
import { computeDescriptionCacheKey, hashImageContent, VisionDescriptionCache } from './vision/cache';
import { describedImageText } from './vision/consts';

const PROMPT = 'PROMPT';

function imageMessage(data: Uint8Array): vscode.LanguageModelChatRequestMessage {
	return {
		role: 1,
		content: [new vscode.LanguageModelDataPart(data, 'image/png')],
		name: undefined,
	} as unknown as vscode.LanguageModelChatRequestMessage;
}

function seededCache(data: Uint8Array, description: string): VisionDescriptionCache {
	const cache = new VisionDescriptionCache();
	cache.set(computeDescriptionCacheKey(PROMPT, [hashImageContent(data)]), description);
	return cache;
}

describe('estimateTokenCount', () => {
	it('budgets the maximum description size for an uncached image', () => {
		expect(estimateTokenCount(imageMessage(new Uint8Array([1, 2, 3])), 4)).toBeGreaterThan(
			VISION_DESCRIPTION_MAX_TOKENS,
		);
	});

	it('counts the real cached description length for a resolved image', () => {
		const data = new Uint8Array([1, 2, 3]);
		const description = 'x'.repeat(5000);
		const cache = seededCache(data, description);

		const count = estimateTokenCount(imageMessage(data), 4, cachedImageDescriptionChars(cache, PROMPT));

		expect(count).toBe(Math.ceil(describedImageText(1, description).length / 4));
	});

	it('budgets the maximum description size when the description is not cached', () => {
		const cache = new VisionDescriptionCache();
		const count = estimateTokenCount(
			imageMessage(new Uint8Array([9])),
			4,
			cachedImageDescriptionChars(cache, PROMPT),
		);
		expect(count).toBeGreaterThan(VISION_DESCRIPTION_MAX_TOKENS);
	});

	it('counts a cached multi-image container using its ordered image hashes', () => {
		const a = new Uint8Array([1]);
		const b = new Uint8Array([2]);
		const cache = new VisionDescriptionCache();
		const description = 'joined description';
		cache.set(computeDescriptionCacheKey(PROMPT, [hashImageContent(a), hashImageContent(b)]), description);
		const message = {
			role: 1,
			content: [new vscode.LanguageModelDataPart(a, 'image/png'), new vscode.LanguageModelDataPart(b, 'image/jpeg')],
			name: undefined,
		} as unknown as vscode.LanguageModelChatRequestMessage;

		const count = estimateTokenCount(message, 4, cachedImageDescriptionChars(cache, PROMPT));

		expect(count).toBe(Math.ceil(describedImageText(2, description).length / 4));
	});

	it('uses the cached description for images nested inside tool results', () => {
		const data = new Uint8Array([1, 2, 3]);
		const description = 'y'.repeat(3000);
		const cache = seededCache(data, description);
		const message = {
			role: 1,
			content: [new vscode.LanguageModelToolResultPart('call-1', [new vscode.LanguageModelDataPart(data, 'image/png')])],
			name: undefined,
		} as unknown as vscode.LanguageModelChatRequestMessage;

		const count = estimateTokenCount(message, 4, cachedImageDescriptionChars(cache, PROMPT));

		expect(count).toBe(Math.ceil(('call-1'.length + describedImageText(1, description).length) / 4));
	});
});
