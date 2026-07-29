import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	settingsApiKey: 'settings.secret',
	showInputBox: vi.fn<() => Promise<string | undefined>>(async () => undefined),
	showInformationMessage: vi.fn(),
}));

vi.mock('vscode', () => ({
	window: {
		showInputBox: (...args: unknown[]) => mocks.showInputBox(...args),
		showInformationMessage: (...args: unknown[]) => mocks.showInformationMessage(...args),
	},
}));
vi.mock('./config', () => ({
	getSettingsApiKey: () => mocks.settingsApiKey,
}));
vi.mock('./i18n', () => ({
	t: (key: string) => key,
}));

import type * as vscode from 'vscode';
import { AuthManager } from './auth';
import { API_KEY_SECRET, VISION_API_KEY_SECRET } from './consts';

function fakeContext(storedSecrets: Map<string, string>): vscode.ExtensionContext {
	return {
		secrets: {
			get: async (key: string) => storedSecrets.get(key),
			store: async (key: string, value: string) => {
				storedSecrets.set(key, value);
			},
			delete: async (key: string) => {
				storedSecrets.delete(key);
			},
		},
	} as unknown as vscode.ExtensionContext;
}

beforeEach(() => {
	mocks.settingsApiKey = 'settings.secret';
	mocks.showInputBox.mockReset();
	mocks.showInputBox.mockResolvedValue(undefined);
	mocks.showInformationMessage.mockReset();
});

describe('AuthManager Vision credentials', () => {
	it('does not fall back to the chat credential for the Vision key', async () => {
		const storedSecrets = new Map([[API_KEY_SECRET, 'proxy.secret']]);
		const authManager = new AuthManager(fakeContext(storedSecrets));

		expect(await authManager.getApiKey()).toBe('proxy.secret');
		expect(await authManager.getVisionApiKey()).toBeUndefined();
	});

	it('stores and removes the Vision key without changing the chat credential', async () => {
		const storedSecrets = new Map([[API_KEY_SECRET, 'proxy.secret']]);
		const authManager = new AuthManager(fakeContext(storedSecrets));
		mocks.showInputBox.mockResolvedValueOnce(' vision.secret ');

		expect(await authManager.promptForVisionApiKey()).toBe(true);
		expect(storedSecrets.get(API_KEY_SECRET)).toBe('proxy.secret');
		expect(storedSecrets.get(VISION_API_KEY_SECRET)).toBe('vision.secret');

		await authManager.deleteVisionApiKey();

		expect(storedSecrets.get(API_KEY_SECRET)).toBe('proxy.secret');
		expect(storedSecrets.has(VISION_API_KEY_SECRET)).toBe(false);
	});
});
