import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GLMChatRequest, IAuthManager, IGLMClient, StreamCallbacks } from '../../types';

const configMocks = vi.hoisted(() => ({
	baseUrl: 'https://proxy.example/v4',
	modelId: 'proxy-flash',
	maxRetries: 2,
}));

vi.mock('vscode', () => {
	class CancellationError extends Error {}
	class CancellationTokenSource {
		private cancelled = false;
		private readonly listeners = new Set<() => void>();
		readonly token: vscode.CancellationToken;
		constructor() {
			const isCancelled = () => this.cancelled;
			this.token = {
				get isCancellationRequested() {
					return isCancelled();
				},
				onCancellationRequested: (listener: () => void) => {
					this.listeners.add(listener);
					return { dispose: () => this.listeners.delete(listener) };
				},
			} as vscode.CancellationToken;
		}
		cancel(): void {
			if (this.cancelled) {
				return;
			}
			this.cancelled = true;
			for (const listener of this.listeners) {
				listener();
			}
		}
		dispose(): void {
			this.listeners.clear();
		}
	}
	return { CancellationError, CancellationTokenSource };
});

vi.mock('../../config', () => ({
	getApiModelId: () => configMocks.modelId,
	getMaxRetries: () => configMocks.maxRetries,
}));
vi.mock('../../endpoint', () => ({ resolveBaseUrl: () => configMocks.baseUrl }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));

import * as vscodeApi from 'vscode';
import {
	createFlashRequest,
	FlashAnalysisTimeoutError,
	FlashImageAnalyzer,
} from './analyze';

function passiveToken(): vscode.CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose: () => {} }),
	} as vscode.CancellationToken;
}

function authManager(apiKey: string | undefined): IAuthManager {
	return {
		getApiKey: async () => apiKey,
		hasApiKey: async () => apiKey !== undefined,
		promptForApiKey: async () => false,
		deleteApiKey: async () => {},
	};
}

describe('GLM-5.3-Flash image analysis', () => {
	beforeEach(() => {
		configMocks.baseUrl = 'https://proxy.example/v4';
		configMocks.modelId = 'proxy-flash';
		configMocks.maxRetries = 2;
		vi.useRealTimers();
	});

	it('builds the fixed multimodal analysis request', () => {
		const request = createFlashRequest('mapped-flash', 'Describe these images', [
			{ mimeType: 'image/PNG', data: new Uint8Array([0, 1, 2]) },
			{ mimeType: 'image/jpeg', data: new Uint8Array([3, 4]) },
		]);

		expect(request).toEqual({
			model: 'mapped-flash',
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'Describe these images' },
						{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAEC' } },
						{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AwQ=' } },
					],
				},
			],
			stream: true,
			max_tokens: 32_768,
			thinking: { type: 'enabled', clear_thinking: false },
			reasoning_effort: 'max',
			temperature: 1,
			top_p: 0.95,
		});
	});

	it('uses the current endpoint, key, mapped model id, and only final content', async () => {
		const observed: Array<{ baseUrl: string; apiKey: string; version: string; retries: number }> = [];
		let sentRequest: GLMChatRequest | undefined;
		const client: IGLMClient = {
			streamChatCompletion: async (request, callbacks) => {
				sentRequest = request;
				callbacks.onThinking('private reasoning');
				callbacks.onContent('visible ');
				callbacks.onContent('description');
				callbacks.onDone();
			},
		};
		const analyzer = new FlashImageAnalyzer(
			authManager('chat.secret'),
			'0.4.0',
			(baseUrl, apiKey, version, retries) => {
				observed.push({ baseUrl, apiKey, version, retries });
				return client;
			},
		);

		const target = analyzer.getTarget();
		const description = await analyzer.analyze(
			target,
			[{ mimeType: 'image/png', data: new Uint8Array([1]) }],
			'Describe',
			passiveToken(),
		);

		expect(target).toEqual({ baseUrl: 'https://proxy.example/v4', modelId: 'proxy-flash' });
		expect(observed).toEqual([
			{ baseUrl: 'https://proxy.example/v4', apiKey: 'chat.secret', version: '0.4.0', retries: 2 },
		]);
		expect(sentRequest?.model).toBe('proxy-flash');
		expect(description).toBe('visible description');
	});

	it('does not construct a client when the chat key is missing', async () => {
		const createClient = vi.fn();
		const analyzer = new FlashImageAnalyzer(authManager(undefined), '0.4.0', createClient);

		await expect(
			analyzer.analyze(
				analyzer.getTarget(),
				[{ mimeType: 'image/png', data: new Uint8Array([1]) }],
				'Describe',
				passiveToken(),
			),
		).rejects.toThrow('vision.error.noKey');
		expect(createClient).not.toHaveBeenCalled();
	});

	it('distinguishes its timeout from user cancellation', async () => {
		vi.useFakeTimers();
		const client: IGLMClient = {
			streamChatCompletion: async (
				_request: GLMChatRequest,
				_callbacks: StreamCallbacks,
				token?: vscode.CancellationToken,
			) => {
				await new Promise<void>((resolve) => token?.onCancellationRequested(resolve));
			},
		};
		const analyzer = new FlashImageAnalyzer(
			authManager('chat.secret'),
			'0.4.0',
			() => client,
			25,
		);
		const pending = analyzer.analyze(
			analyzer.getTarget(),
			[{ mimeType: 'image/png', data: new Uint8Array([1]) }],
			'Describe',
			passiveToken(),
		);
		const rejection = expect(pending).rejects.toBeInstanceOf(FlashAnalysisTimeoutError);

		await vi.advanceTimersByTimeAsync(25);
		await rejection;
	});

	it('aborts an in-flight Flash request when the user cancels', async () => {
		const client: IGLMClient = {
			streamChatCompletion: async (
				_request: GLMChatRequest,
				_callbacks: StreamCallbacks,
				childToken?: vscode.CancellationToken,
			) => {
				await new Promise<void>((resolve) => childToken?.onCancellationRequested(resolve));
			},
		};
		const requestCancellation = new vscodeApi.CancellationTokenSource();
		const analyzer = new FlashImageAnalyzer(
			authManager('chat.secret'),
			'0.4.0',
			() => client,
		);
		const pending = analyzer.analyze(
			analyzer.getTarget(),
			[{ mimeType: 'image/png', data: new Uint8Array([1]) }],
			'Describe',
			requestCancellation.token,
		);
		const rejection = expect(pending).rejects.toBeInstanceOf(vscodeApi.CancellationError);

		requestCancellation.cancel();
		await rejection;
	});
});
