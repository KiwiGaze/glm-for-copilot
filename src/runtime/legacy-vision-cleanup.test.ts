import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	showWarningMessage: vi.fn(),
	loggerWarn: vi.fn(),
}));

vi.mock('vscode', () => ({
	window: {
		showWarningMessage: (...args: unknown[]) => mocks.showWarningMessage(...args),
	},
}));
vi.mock('../i18n', () => ({ t: (key: string) => key }));
vi.mock('../logger', () => ({ logger: { warn: (...args: unknown[]) => mocks.loggerWarn(...args) } }));

import { cleanupLegacyVisionState } from './legacy-vision-cleanup';

const CLEANUP_KEY = 'glm-copilot.flashImageMigration.v1';

function context(
	secrets: Map<string, string>,
	globalState: Map<string, unknown>,
): vscode.ExtensionContext {
	return {
		secrets: {
			delete: async (key: string) => {
				secrets.delete(key);
			},
		},
		globalState: {
			get: <T>(key: string) => globalState.get(key) as T | undefined,
			update: async (key: string, value: unknown) => {
				if (value === undefined) {
					globalState.delete(key);
				} else {
					globalState.set(key, value);
				}
			},
		},
		globalStorageUri: { fsPath: '/extension-storage' },
	} as unknown as vscode.ExtensionContext;
}

describe('retired image-integration cleanup', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('removes only retired extension-owned data', async () => {
		const secrets = new Map([
			['glm-copilot.apiKey', 'chat.secret'],
			['glm-copilot.visionApiKey', 'retired.secret'],
			['other.secret', 'keep'],
		]);
		const state = new Map<string, unknown>([
			['glm-copilot.visionMcp.installed', true],
			['other.state', 42],
		]);
		const removed: string[] = [];

		await cleanupLegacyVisionState(context(secrets, state), {
			removeDirectory: async (path) => {
				removed.push(path);
			},
		});

		expect(secrets).toEqual(
			new Map([
				['glm-copilot.apiKey', 'chat.secret'],
				['other.secret', 'keep'],
			]),
		);
		expect(state.get('other.state')).toBe(42);
		expect(state.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		expect(state.get(CLEANUP_KEY)).toBe(true);
		expect(removed).toEqual([
			'/extension-storage/vision-mcp',
			'/extension-storage/vision-tmp',
		]);
		expect(mocks.showWarningMessage).not.toHaveBeenCalled();
	});

	it('does not repeat extension-owned cleanup after the migration marker is recorded', async () => {
		const secrets = new Map<string, string>();
		const state = new Map<string, unknown>([[CLEANUP_KEY, true]]);
		const removeDirectory = vi.fn(async () => {});

		await cleanupLegacyVisionState(context(secrets, state), { removeDirectory });

		expect(removeDirectory).not.toHaveBeenCalled();
		expect(mocks.showWarningMessage).not.toHaveBeenCalled();
	});

	it('continues cleanup, leaves the global marker unset, and warns when a global step fails', async () => {
		const secrets = new Map([['glm-copilot.visionApiKey', 'retired.secret']]);
		const state = new Map<string, unknown>([['glm-copilot.visionMcp.installed', true]]);
		const removed: string[] = [];

		await cleanupLegacyVisionState(context(secrets, state), {
			removeDirectory: async (path) => {
				removed.push(path);
				if (path.endsWith('vision-mcp')) {
					throw new Error('locked');
				}
			},
		});

		expect(removed).toHaveLength(2);
		expect(state.has(CLEANUP_KEY)).toBe(false);
		expect(mocks.showWarningMessage).toHaveBeenCalledWith('migration.visionCleanupFailed');
		expect(mocks.loggerWarn).toHaveBeenCalled();
	});
});
