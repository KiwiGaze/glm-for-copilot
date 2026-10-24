import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeMemento } from '../test-helpers';

const host = vi.hoisted(() => ({
	global: new Map<string, unknown>(),
	workspace: new Map<string, unknown>(),
	inWorkspace: true,
	policy: undefined as string | undefined,
	commands: new Map<string, () => Promise<void>>(),
	listeners: [] as Array<(event: { affectsConfiguration(key: string): boolean }) => void>,
	update: vi.fn(),
	message: vi.fn(),
}));

vi.mock('vscode', () => ({
	ConfigurationTarget: { Global: 1, Workspace: 2 },
	workspace: {
		get workspaceFolders() { return host.inWorkspace ? [{}] : undefined; },
		getConfiguration: (section: string) => ({
			get: (key: string, fallback?: unknown) => {
				const full = `${section}.${key}`;
				return (full === 'chat.defaultModel' ? host.policy : undefined)
					?? host.workspace.get(full) ?? host.global.get(full)
					?? (full === 'chat.defaultModel' ? 'glm/glm-5.3' : fallback);
			},
			inspect: (key: string) => ({
				globalValue: host.global.get(`${section}.${key}`),
				workspaceValue: host.workspace.get(`${section}.${key}`),
				defaultValue: section === 'chat' ? host.policy ?? 'glm/glm-5.3' : undefined,
			}),
			update: async (key: string, value: unknown, target: number) => {
				if (section === 'chat' && host.policy !== undefined) {
					throw new Error('Setting is managed by policy');
				}
				host.update(`${section}.${key}`, value, target);
				const store = target === 1 ? host.global : host.workspace;
				if (value === undefined) { store.delete(`${section}.${key}`); }
				else { store.set(`${section}.${key}`, value); }
			},
		}),
		onDidChangeConfiguration: (listener: (event: { affectsConfiguration(key: string): boolean }) => void) => {
			host.listeners.push(listener);
			return { dispose() {} };
		},
	},
	commands: {
		registerCommand: (id: string, run: () => Promise<void>) => {
			host.commands.set(id, run);
			return { dispose() {} };
		},
		executeCommand: vi.fn(),
	},
	window: { showInformationMessage: host.message },
}));
vi.mock('../i18n', () => ({ t: (key: string) => key }));
vi.mock('../logger', () => ({ logger: { warn: vi.fn() } }));

import { ModelPreferences } from './model-preferences';

function fixture() {
	const globalState = fakeMemento();
	const workspaceState = fakeMemento();
	const context = { globalState, workspaceState, subscriptions: [] } as unknown as vscode.ExtensionContext;
	return { preferences: new ModelPreferences(context), globalState, workspaceState };
}

beforeEach(() => {
	host.global.clear();
	host.workspace.clear();
	host.commands.clear();
	host.listeners.length = 0;
	host.inWorkspace = true;
	host.policy = undefined;
	vi.clearAllMocks();
	host.message.mockResolvedValue(undefined);
});

describe('model preference lifecycle', () => {
	it('seeds Standard API with Flash and updates only its owned default on mode changes', async () => {
		host.global.set('glm-copilot.apiMode', 'standard');
		const { preferences } = fixture();
		await preferences.initialize();
		expect(host.workspace.get('chat.defaultModel')).toBe('glm/glm-5.3-flash');
		expect(host.global.has('chat.defaultModel')).toBe(false);
		host.global.set('glm-copilot.apiMode', 'coding-plan');
		for (const listener of host.listeners) {
			listener({ affectsConfiguration: (key) => key === 'glm-copilot.apiMode' });
		}
		await preferences.synchronize();
		expect(host.workspace.get('chat.defaultModel')).toBe('glm/glm-5.3');
		host.workspace.set('chat.defaultModel', 'auto');
		await preferences.synchronize();
		host.global.set('glm-copilot.apiMode', 'standard');
		await preferences.synchronize();
		expect(host.workspace.get('chat.defaultModel')).toBe('auto');
	});

	it.each(['global', 'workspace'] as const)('preserves an explicit %s default including an empty string', async (scope) => {
		host.global.set('glm-copilot.apiMode', 'standard');
		host[scope].set('chat.defaultModel', '');
		await fixture().preferences.initialize();
		expect(host.update).not.toHaveBeenCalledWith('chat.defaultModel', expect.anything(), expect.anything());
	});

	it('does not write over an organization policy, even through the recommendation command', async () => {
		host.policy = 'auto';
		host.global.set('glm-copilot.apiMode', 'standard');
		await fixture().preferences.initialize();
		await host.commands.get('glm-copilot.useRecommendedModel')?.();
		expect(host.update).not.toHaveBeenCalledWith('chat.defaultModel', expect.anything(), expect.anything());
	});

	it('uses a global default in an empty window and follows it locally in a workspace', async () => {
		host.inWorkspace = false;
		host.global.set('glm-copilot.apiMode', 'standard');
		const { preferences } = fixture();
		await preferences.initialize();
		expect(host.global.get('chat.defaultModel')).toBe('glm/glm-5.3-flash');
		host.inWorkspace = true;
		host.workspace.set('glm-copilot.apiMode', 'coding-plan');
		await preferences.synchronize();
		expect(host.workspace.get('chat.defaultModel')).toBe('glm/glm-5.3');
		expect(host.global.get('chat.defaultModel')).toBe('glm/glm-5.3-flash');
	});

	it('preserves legacy access on upgrade once and does not undo a later opt-out', async () => {
		const { preferences, globalState } = fixture();
		await globalState.update('glm-copilot.welcomeShown', true);
		await preferences.initialize();
		expect(host.global.get('glm-copilot.showLegacyModels')).toBe(true);
		host.global.delete('glm-copilot.showLegacyModels');
		await preferences.initialize();
		expect(host.global.has('glm-copilot.showLegacyModels')).toBe(false);
	});

	it('leaves new installations hidden and respects an existing explicit legacy opt-out', async () => {
		await fixture().preferences.initialize();
		expect(host.global.has('glm-copilot.showLegacyModels')).toBe(false);
		const { preferences, globalState } = fixture();
		await globalState.update('glm-copilot.welcomeShown', true);
		host.workspace.set('glm-copilot.showLegacyModels', false);
		await preferences.initialize();
		expect(host.global.has('glm-copilot.showLegacyModels')).toBe(false);
		expect(host.workspace.get('glm-copilot.showLegacyModels')).toBe(false);
	});

	it('does not automatically choose for custom endpoints or replacement models', async () => {
		host.global.set('glm-copilot.apiMode', 'standard');
		host.global.set('glm-copilot.baseUrl', 'https://proxy.example/v4');
		const { preferences } = fixture();
		await preferences.initialize();
		await host.commands.get('glm-copilot.useRecommendedModel')?.();
		expect(host.update).not.toHaveBeenCalledWith('chat.defaultModel', expect.anything(), expect.anything());
		host.global.delete('glm-copilot.baseUrl');
		host.global.set('glm-copilot.customModels', ['glm-5.3-flash']);
		await preferences.synchronize();
		expect(host.update).not.toHaveBeenCalledWith('chat.defaultModel', expect.anything(), expect.anything());
	});

	it('the registered command replaces an old explicit default and opts in to mode-aware updates', async () => {
		host.message.mockImplementation(() => new Promise(() => {}));
		host.global.set('chat.defaultModel', 'glm-4.5-air');
		const { preferences } = fixture();
		await preferences.initialize();
		expect(host.workspace.has('chat.defaultModel')).toBe(false);
		const command = host.commands.get('glm-copilot.useRecommendedModel');
		expect(command).toBeDefined();
		await command!();
		expect(host.workspace.get('chat.defaultModel')).toBe('glm/glm-5.3');
		host.global.set('glm-copilot.apiMode', 'standard');
		await preferences.synchronize();
		expect(host.workspace.get('chat.defaultModel')).toBe('glm/glm-5.3-flash');
		expect(host.global.get('chat.defaultModel')).toBe('glm-4.5-air');
	});
});
