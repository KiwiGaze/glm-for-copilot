import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAuthManager } from '../types';

const settings = vi.hoisted(() => new Map<string, unknown>());

vi.mock('vscode', () => ({
	workspace: {
		getConfiguration: () => ({
			get<TValue>(key: string, fallback: TValue): TValue {
				return (settings.has(key) ? settings.get(key) : fallback) as TValue;
			},
		}),
	},
}));

vi.mock('../client', () => ({
	GLMClient: class {
		async streamChatCompletion(): Promise<void> {}
	},
}));

vi.mock('../i18n', () => ({
	t: (key: string) => key,
}));

import { prepareChatRequest } from './request';

const AUTH_MANAGER: IAuthManager = {
	getApiKey: async () => 'id.secret',
	hasApiKey: async () => true,
	promptForApiKey: async () => true,
	deleteApiKey: async () => {},
};

const MODEL_INFO = {
	id: 'glm-5.3',
	name: 'GLM-5.3',
	family: 'glm',
	version: '5.3',
	maxInputTokens: 1_000_000,
	maxOutputTokens: 128_000,
	capabilities: { toolCalling: true },
} satisfies vscode.LanguageModelChatInformation;

const TOKEN = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose: () => {} }),
} as unknown as vscode.CancellationToken;

function optionsWithEffort(
	reasoningEffort?: string,
): vscode.ProvideLanguageModelChatResponseOptions {
	return {
		...(reasoningEffort ? { modelConfiguration: { reasoningEffort } } : {}),
	} as unknown as vscode.ProvideLanguageModelChatResponseOptions;
}

describe('prepareChatRequest GLM-5.3 thinking', () => {
	beforeEach(() => {
		settings.clear();
		settings.set('thinking', 'disabled');
	});

	it('uses enabled thinking with Max effort by default', async () => {
		const prepared = await prepareChatRequest({
			authManager: AUTH_MANAGER,
			extensionVersion: '0.3.0',
			modelInfo: MODEL_INFO,
			messages: [],
			options: optionsWithEffort(),
			token: TOKEN,
		});

		expect(prepared.request).toMatchObject({
			model: 'glm-5.3',
			thinking: { type: 'enabled' },
			reasoning_effort: 'max',
		});
	});

	it('keeps thinking enabled when Low effort is selected', async () => {
		const prepared = await prepareChatRequest({
			authManager: AUTH_MANAGER,
			extensionVersion: '0.3.0',
			modelInfo: MODEL_INFO,
			messages: [],
			options: optionsWithEffort('low'),
			token: TOKEN,
		});

		expect(prepared.request).toMatchObject({
			thinking: { type: 'enabled' },
			reasoning_effort: 'low',
		});
	});
});
