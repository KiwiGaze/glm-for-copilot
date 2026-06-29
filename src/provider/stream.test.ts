import { describe, it, expect, vi } from 'vitest';
import type { IGLMClient, StreamCallbacks } from '../types';

const textParts: string[] = [];
const thinkingParts: string[] = [];
const dataParts: Array<{ data: Uint8Array; mimeType: string }> = [];

vi.mock('vscode', () => ({
	LanguageModelTextPart: class {
		constructor(public value: string) {
			textParts.push(value);
		}
	},
	LanguageModelThinkingPart: class {
		constructor(public value: string) {
			thinkingParts.push(value);
		}
	},
	LanguageModelDataPart: class {
		constructor(public data: Uint8Array, public mimeType: string) {
			dataParts.push({ data, mimeType });
		}
	},
	LanguageModelToolCallPart: class {
		constructor(
			public id: string,
			public name: string,
			public args: object,
		) {}
	},
}));

vi.mock('../i18n', () => ({
	t: (key: string, ...args: string[]) => {
		const strings: Record<string, string> = {
			'request.retry.rateLimited': `GLM is rate limited. Retrying in ${args[0]}s (${args[1]}/${args[2]}).`,
			'request.retry.busy': `GLM is busy. Retrying in ${args[0]}s (${args[1]}/${args[2]}).`,
		};
		return strings[key] ?? key;
	},
}));

vi.mock('../client', () => ({
	createUserFacingError: (error: unknown) => error,
}));

vi.mock('../logger', () => ({
	logger: { warn: vi.fn() },
}));

import * as vscode from 'vscode';
import { streamChatCompletion } from './stream';

const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };

function clientWith(callback: (callbacks: StreamCallbacks) => void): IGLMClient {
	return {
		streamChatCompletion: vi.fn(async (_request, callbacks) => {
			callback(callbacks);
		}),
	};
}

function args(client: IGLMClient): Parameters<typeof streamChatCompletion>[0] {
	return {
		prepared: {
			client,
			request: { model: 'glm', messages: [], stream: true },
			totalRequestChars: 0,
			isThinkingModel: true,
		},
		progress: { report: vi.fn() },
		token: token as never,
		getCharsPerToken: () => 4,
		setCharsPerToken: vi.fn(),
	};
}

describe('streamChatCompletion retry backoff progress', () => {
	it('reports rate-limit retry as a thinking part', async () => {
		textParts.length = 0;
		thinkingParts.length = 0;
		dataParts.length = 0;
		const client = clientWith((callbacks) => {
			callbacks.onRetryBackoff?.({
				status: 429,
				nextAttempt: 2,
				maxAttempts: 3,
				delayMs: 1500,
			});
		});

		await streamChatCompletion(args(client));

		expect(thinkingParts).toEqual(['GLM is rate limited. Retrying in 2s (2/3).']);
		expect(textParts).toEqual([]);
	});

	it('reports server retry as a thinking part', async () => {
		textParts.length = 0;
		thinkingParts.length = 0;
		const client = clientWith((callbacks) => {
			callbacks.onRetryBackoff?.({
				status: 503,
				nextAttempt: 2,
				maxAttempts: 3,
				delayMs: 1000,
			});
		});

		await streamChatCompletion(args(client));

		expect(thinkingParts).toEqual(['GLM is busy. Retrying in 1s (2/3).']);
		expect(textParts).toEqual([]);
	});

	it('skips retry progress when thinking parts are unavailable', async () => {
		textParts.length = 0;
		thinkingParts.length = 0;
		const original = (vscode as { LanguageModelThinkingPart?: unknown }).LanguageModelThinkingPart;
		(vscode as { LanguageModelThinkingPart?: unknown }).LanguageModelThinkingPart = undefined;
		const client = clientWith((callbacks) => {
			callbacks.onRetryBackoff?.({
				status: 429,
				nextAttempt: 2,
				maxAttempts: 3,
				delayMs: 1000,
			});
		});

		try {
			await streamChatCompletion(args(client));
		} finally {
			(vscode as { LanguageModelThinkingPart?: unknown }).LanguageModelThinkingPart = original;
		}

		expect(thinkingParts).toEqual([]);
		expect(textParts).toEqual([]);
	});
});
