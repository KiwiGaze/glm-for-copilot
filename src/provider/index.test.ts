import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	findModelDefinition: vi.fn(),
	resolveVisionMessages: vi.fn(),
	prepareChatRequest: vi.fn(),
	streamChatCompletion: vi.fn(),
}));

vi.mock('vscode', () => {
	class EventEmitter<T> {
		readonly event = (_listener: (event: T) => unknown) => ({ dispose: () => {} });
		fire(): void {}
		dispose(): void {}
	}
	class CancellationError extends Error {}
	class LanguageModelTextPart {
		constructor(public value: string) {}
	}
	return {
		EventEmitter,
		CancellationError,
		LanguageModelTextPart,
		workspace: {
			onDidChangeConfiguration: () => ({ dispose: () => {} }),
		},
		window: { showInformationMessage: vi.fn() },
		lm: { selectChatModels: vi.fn() },
	};
});
vi.mock('../config', () => ({
	findModelDefinition: (...args: unknown[]) => mocks.findModelDefinition(...args),
	getVisionPrompt: () => 'PROMPT',
	listProviderModels: () => [],
}));
vi.mock('../i18n', () => ({ t: (key: string) => key }));
vi.mock('../logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('./models', () => ({ toChatInfo: vi.fn() }));
vi.mock('./request', () => ({
	prepareChatRequest: (...args: unknown[]) => mocks.prepareChatRequest(...args),
}));
vi.mock('./stream', () => ({
	streamChatCompletion: (...args: unknown[]) => mocks.streamChatCompletion(...args),
}));
vi.mock('./tokens', () => ({
	cachedImageDescriptionChars: vi.fn(),
	estimateTokenCount: vi.fn(),
}));
vi.mock('./vision/analyze', () => ({
	FlashImageAnalyzer: class {
		getTarget() {
			return { baseUrl: 'https://proxy.example/v4', modelId: 'mapped-flash' };
		}
	},
}));
vi.mock('./vision/resolve', () => ({
	resolveVisionMessages: (...args: unknown[]) => mocks.resolveVisionMessages(...args),
}));

import * as vscodeApi from 'vscode';
import type { IAuthManager } from '../types';
import { GLMChatProvider } from './index';

const authManager: IAuthManager = {
	getApiKey: async () => 'chat.secret',
	hasApiKey: async () => true,
	promptForApiKey: async () => true,
	deleteApiKey: async () => {},
};

function context(): vscode.ExtensionContext {
	return {
		extension: { packageJSON: { version: '0.4.0' } },
		subscriptions: [],
		secrets: {
			onDidChange: () => ({ dispose: () => {} }),
		},
	} as unknown as vscode.ExtensionContext;
}

function model(id = 'glm-5.3'): vscode.LanguageModelChatInformation {
	return {
		id,
		name: id,
		family: 'glm',
		version: '5.3',
		maxInputTokens: 1_000_000,
		maxOutputTokens: 128_000,
		capabilities: { toolCalling: true, imageInput: true },
	};
}

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose: () => {} }),
} as vscode.CancellationToken;

describe('GLMChatProvider image routing', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findModelDefinition.mockReturnValue({
			capabilities: { nativeImageInput: false },
		});
	});

	it('does not prepare or send the main-model request after image-analysis cancellation', async () => {
		mocks.resolveVisionMessages.mockRejectedValue(new vscodeApi.CancellationError());
		const provider = new GLMChatProvider(context(), authManager);

		await provider.provideLanguageModelChatResponse(
			model(),
			[],
			{} as vscode.ProvideLanguageModelChatResponseOptions,
			{ report: vi.fn() },
			token,
		);

		expect(mocks.prepareChatRequest).not.toHaveBeenCalled();
		expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
	});

	it.each([
		['glm-5.3-flash', true],
		['glm-5.3', false],
	])('routes %s with nativeImageInput=%s and keeps it as the main model', async (modelId, nativeImageInput) => {
		mocks.findModelDefinition.mockReturnValue({
			capabilities: { nativeImageInput },
		});
		const resolvedMessages = [{ role: 1, content: [] }];
		mocks.resolveVisionMessages.mockResolvedValue({ messages: resolvedMessages });
		const prepared = { request: { model: modelId } };
		mocks.prepareChatRequest.mockResolvedValue(prepared);
		const provider = new GLMChatProvider(context(), authManager);
		const selectedModel = model(modelId);

		await provider.provideLanguageModelChatResponse(
			selectedModel,
			[],
			{} as vscode.ProvideLanguageModelChatResponseOptions,
			{ report: vi.fn() },
			token,
		);

		expect(mocks.resolveVisionMessages.mock.calls[0][0]).toMatchObject({
			nativeImageInput,
		});
		expect(mocks.prepareChatRequest.mock.calls[0][0]).toMatchObject({
			modelInfo: selectedModel,
			messages: resolvedMessages,
		});
		expect(mocks.streamChatCompletion).toHaveBeenCalledWith(
			expect.objectContaining({ prepared }),
		);
	});
});
