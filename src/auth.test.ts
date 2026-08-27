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
import { API_KEY_SECRET } from './consts';

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

describe('AuthManager chat credential', () => {
	it('prefers the secret-storage key and falls back to the setting', async () => {
		const stored = new Map([[API_KEY_SECRET, 'stored.secret']]);
		const manager = new AuthManager(fakeContext(stored));

		expect(await manager.getApiKey()).toBe('stored.secret');
		stored.delete(API_KEY_SECRET);
		expect(await manager.getApiKey()).toBe('settings.secret');
	});

	it('stores a trimmed key and can remove it', async () => {
		const stored = new Map<string, string>();
		const manager = new AuthManager(fakeContext(stored));
		mocks.showInputBox.mockResolvedValueOnce(' chat.secret ');

		expect(await manager.promptForApiKey()).toBe(true);
		expect(stored.get(API_KEY_SECRET)).toBe('chat.secret');

		await manager.deleteApiKey();
		expect(stored.has(API_KEY_SECRET)).toBe(false);
	});
});
