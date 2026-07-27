import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	showInformationMessage: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
	showWarningMessage: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
	executeCommand: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
	registerMcpServerDefinitionProvider: vi.fn(() => ({ dispose: vi.fn() })),
	configUpdate: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
	findVisionAnalyzeTool: vi.fn<() => unknown>(() => undefined),
}));

vi.mock('vscode', () => {
	class EventEmitter<T = void> {
		private readonly listeners: Array<(e: T) => void> = [];
		readonly event = (listener: (e: T) => void) => {
			this.listeners.push(listener);
			return { dispose: () => {} };
		};
		fire(event: T): void {
			for (const listener of this.listeners) {
				listener(event);
			}
		}
		dispose(): void {}
	}
	class McpStdioServerDefinition {
		constructor(
			readonly label: string,
			public command: string,
			public args: string[] = [],
			public env: Record<string, string | number | null> = {},
			public version?: string,
		) {}
	}
	return {
		EventEmitter,
		McpStdioServerDefinition,
		ConfigurationTarget: { Global: 1 },
		commands: { executeCommand: (...args: unknown[]) => mocks.executeCommand(...args) },
		window: {
			showInformationMessage: (...args: unknown[]) => mocks.showInformationMessage(...args),
			showWarningMessage: (...args: unknown[]) => mocks.showWarningMessage(...args),
		},
		workspace: {
			onDidChangeConfiguration: () => ({ dispose: () => {} }),
			getConfiguration: () => ({ update: (...args: unknown[]) => mocks.configUpdate(...args) }),
			fs: { delete: async () => {} },
		},
		Uri: { joinPath: (base: unknown, ...parts: string[]) => ({ base, parts }), parse: (v: string) => ({ v }) },
		env: { openExternal: async () => true },
		lm: { registerMcpServerDefinitionProvider: mocks.registerMcpServerDefinitionProvider },
	};
});

vi.mock('../config', () => ({
	getRegion: () => 'international',
	getVisionEnabled: () => visionEnabledValue,
}));
vi.mock('../i18n', () => ({
	t: (key: string, ...args: string[]) => (args.length ? `${key}(${args.join('|')})` : key),
}));
vi.mock('../logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('../vision-tool', () => ({ findVisionAnalyzeTool: () => mocks.findVisionAnalyzeTool() }));

import * as vscode from 'vscode';
import type { IAuthManager } from '../types';
import { buildVisionMcpServerSpec, VisionMcpManager, type NodeRuntimeProbe } from './mcp';

let visionEnabledValue = false;

function fakeContext(installed: boolean) {
	const state = new Map<string, unknown>();
	if (installed) {
		state.set('glm-copilot.visionMcp.installed', true);
	}
	return {
		globalState: {
			get: <T,>(key: string) => state.get(key) as T | undefined,
			update: async (key: string, value: unknown) => {
				if (value === undefined) {
					state.delete(key);
				} else {
					state.set(key, value);
				}
			},
		},
		secrets: { onDidChange: () => ({ dispose: () => {} }) },
		subscriptions: [] as Array<{ dispose(): void }>,
		globalStorageUri: { fsPath: '/tmp/glm-test-storage' },
	} as unknown as vscode.ExtensionContext;
}

function authWithKey(): IAuthManager {
	return {
		getApiKey: async () => 'id.secret',
		hasApiKey: async () => true,
		promptForApiKey: async () => true,
		deleteApiKey: async () => {},
	};
}

function makeManager(
	installed: boolean,
	probe: () => Promise<NodeRuntimeProbe> = async () => ({ npxOk: true, nodeMajor: 22 }),
) {
	const context = fakeContext(installed);
	const manager = new VisionMcpManager(context, authWithKey(), probe);
	return { context, manager };
}

beforeEach(() => {
	visionEnabledValue = false;
	vi.clearAllMocks();
	mocks.findVisionAnalyzeTool.mockReturnValue(undefined);
});

describe('buildVisionMcpServerSpec', () => {
	it('uses plain npx and ZAI mode for the international region', () => {
		const spec = buildVisionMcpServerSpec({ region: 'international', platform: 'darwin' });
		expect(spec.label).toBe('GLM Vision');
		expect(spec.command).toBe('npx');
		expect(spec.args).toEqual(['-y', '@z_ai/mcp-server@latest']);
		expect(spec.env).toEqual({ Z_AI_MODE: 'ZAI' });
	});

	it('uses ZHIPU mode for the China region', () => {
		const spec = buildVisionMcpServerSpec({ region: 'china', platform: 'linux' });
		expect(spec.env).toEqual({ Z_AI_MODE: 'ZHIPU' });
	});

	it('wraps npx in cmd.exe /c on Windows', () => {
		const spec = buildVisionMcpServerSpec({ region: 'china', platform: 'win32' });
		expect(spec.command).toBe('cmd.exe');
		expect(spec.args).toEqual(['/c', 'npx', '-y', '@z_ai/mcp-server@latest']);
		expect(spec.env).toEqual({ Z_AI_MODE: 'ZHIPU' });
	});

	it('never embeds the API key in the base spec (injected only when the server starts)', () => {
		const spec = buildVisionMcpServerSpec({ region: 'international', platform: 'darwin' });
		expect(JSON.stringify(spec)).not.toContain('Z_AI_API_KEY');
	});
});

describe('VisionMcpManager', () => {
	it('does not register the MCP server at activation when not installed (no silent install)', () => {
		const { manager } = makeManager(false);
		manager.initialize();
		expect(mocks.registerMcpServerDefinitionProvider).not.toHaveBeenCalled();
		manager.dispose();
	});

	it('restores the MCP server registration at activation when installed', () => {
		const { manager } = makeManager(true);
		manager.initialize();
		expect(mocks.registerMcpServerDefinitionProvider).toHaveBeenCalledTimes(1);
		expect(mocks.registerMcpServerDefinitionProvider.mock.calls[0][0]).toBe('glm-copilot.vision');
		manager.dispose();
	});

	it('install registers the server, persists the flag, and confirms', async () => {
		const { context, manager } = makeManager(false);
		await manager.install();
		expect(mocks.registerMcpServerDefinitionProvider).toHaveBeenCalledTimes(1);
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBe(true);
		expect(mocks.showInformationMessage).toHaveBeenCalledWith('visionMcp.install.success', 'visionMcp.openServers');
		manager.dispose();
	});

	it('install is a no-op when already installed', async () => {
		const { manager } = makeManager(true);
		manager.initialize();
		await manager.install();
		expect(mocks.registerMcpServerDefinitionProvider).toHaveBeenCalledTimes(1);
		expect(mocks.showInformationMessage).toHaveBeenCalledWith('visionMcp.install.alreadyInstalled');
		manager.dispose();
	});

	it('install aborts without registering when the API key prompt is declined', async () => {
		const noKeyAuth: IAuthManager = {
			getApiKey: async () => undefined,
			hasApiKey: async () => false,
			promptForApiKey: vi.fn(async () => false),
			deleteApiKey: async () => {},
		};
		const context = fakeContext(false);
		const manager = new VisionMcpManager(context, noKeyAuth, async () => ({
			npxOk: true,
			nodeMajor: 22,
		}));

		await manager.install();

		expect(noKeyAuth.promptForApiKey).toHaveBeenCalled();
		expect(mocks.showWarningMessage).toHaveBeenCalledWith(
			'visionMcp.auth.required',
			'visionMcp.auth.enterKey',
			'visionMcp.notNow',
		);
		expect(mocks.registerMcpServerDefinitionProvider).not.toHaveBeenCalled();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		manager.dispose();
	});

	it('install aborts without registering when Node.js is missing and the user cancels', async () => {
		const { context, manager } = makeManager(false, async () => ({ npxOk: false }));
		await manager.install();
		expect(mocks.showWarningMessage).toHaveBeenCalledWith(
			'visionMcp.npx.missing',
			'visionMcp.npx.installAnyway',
			'visionMcp.npx.requirements',
			'visionMcp.cancel',
		);
		expect(mocks.registerMcpServerDefinitionProvider).not.toHaveBeenCalled();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		manager.dispose();
	});

	it('install proceeds when Node.js is missing but the user installs anyway', async () => {
		mocks.showWarningMessage.mockResolvedValueOnce('visionMcp.npx.installAnyway');
		const { context, manager } = makeManager(false, async () => ({ npxOk: false }));
		await manager.install();
		expect(mocks.registerMcpServerDefinitionProvider).toHaveBeenCalledTimes(1);
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBe(true);
		manager.dispose();
	});

	it('install warns with the detected version when Node.js is older than required', async () => {
		const { context, manager } = makeManager(false, async () => ({ npxOk: true, nodeMajor: 16 }));
		await manager.install();
		expect(mocks.showWarningMessage).toHaveBeenCalledWith(
			'visionMcp.npx.tooOld(16|18)',
			'visionMcp.npx.installAnyway',
			'visionMcp.npx.requirements',
			'visionMcp.cancel',
		);
		expect(mocks.registerMcpServerDefinitionProvider).not.toHaveBeenCalled();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		manager.dispose();
	});

	it('install proceeds on an old Node.js when the user installs anyway', async () => {
		mocks.showWarningMessage.mockResolvedValueOnce('visionMcp.npx.installAnyway');
		const { context, manager } = makeManager(false, async () => ({ npxOk: true, nodeMajor: 16 }));
		await manager.install();
		expect(mocks.registerMcpServerDefinitionProvider).toHaveBeenCalledTimes(1);
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBe(true);
		manager.dispose();
	});

	it('install skips the version warning when the Node.js version is unknown', async () => {
		const { context, manager } = makeManager(false, async () => ({ npxOk: true }));
		await manager.install();
		expect(mocks.showWarningMessage).not.toHaveBeenCalled();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBe(true);
		manager.dispose();
	});

	it('uninstall disposes the registration and clears the installed flag', async () => {
		const { context, manager } = makeManager(true);
		manager.initialize();
		const registration = mocks.registerMcpServerDefinitionProvider.mock.results[0].value;

		await manager.uninstall();

		expect(registration.dispose).toHaveBeenCalled();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		expect(mocks.showInformationMessage).toHaveBeenCalledWith('visionMcp.uninstall.done');
		manager.dispose();
	});

	it('uninstall resets the visionEnabled setting so a reinstall asks for consent again', async () => {
		visionEnabledValue = true;
		const { manager } = makeManager(true);
		manager.initialize();

		await manager.uninstall();

		expect(mocks.configUpdate).toHaveBeenCalledWith('visionEnabled', undefined, 1);
		manager.dispose();
	});

	it('refuses to enable vision while the server is not healthy', async () => {
		const { manager } = makeManager(true);
		manager.initialize();
		await manager.toggleVision();
		expect(mocks.showWarningMessage).toHaveBeenCalledWith('visionMcp.toggle.notRunning');
		expect(mocks.configUpdate).not.toHaveBeenCalled();
		manager.dispose();
	});

	it('enables the visionEnabled setting when healthy', async () => {
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		const { manager } = makeManager(true);
		manager.initialize();
		await manager.toggleVision();
		expect(mocks.configUpdate).toHaveBeenCalledWith('visionEnabled', true, 1);
		expect(mocks.showInformationMessage).toHaveBeenCalledWith('visionMcp.toggle.on');
		manager.dispose();
	});

	it('isVisionActive requires both a healthy server and the visionEnabled setting', async () => {
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		const { manager } = makeManager(true);
		manager.initialize();
		expect(manager.isVisionActive()).toBe(false);
		visionEnabledValue = true;
		expect(manager.isVisionActive()).toBe(true);
		manager.dispose();
	});

	it('registers only once for overlapping install calls', async () => {
		const { manager } = makeManager(false);
		await Promise.all([manager.install(), manager.install()]);
		expect(mocks.registerMcpServerDefinitionProvider).toHaveBeenCalledTimes(1);
		manager.dispose();
	});

	it('uninstall does not raise the "stopped" warning for an explicit uninstall', async () => {
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		visionEnabledValue = true;
		const { manager } = makeManager(true);
		manager.initialize();

		await manager.uninstall();

		const warnings = mocks.showWarningMessage.mock.calls.map((call) => call[0]);
		expect(warnings).not.toContain('visionMcp.unhealthy');
		manager.dispose();
	});

	it('injects the API key into the server environment when the server starts', async () => {
		const { manager } = makeManager(false);
		await manager.install();
		const provider = mocks.registerMcpServerDefinitionProvider.mock.calls[0][1] as {
			resolveMcpServerDefinition?: (server: {
				env: Record<string, string>;
			}) => Promise<{ env: Record<string, string> } | undefined>;
		};

		const resolved = await provider.resolveMcpServerDefinition?.({ env: { Z_AI_MODE: 'ZAI' } });

		expect(resolved?.env.Z_AI_API_KEY).toBe('id.secret');
		manager.dispose();
	});
});
