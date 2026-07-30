import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const APPROVAL_GUIDANCE_MESSAGE = 'visionMcp.approval.guidance';
const MANAGE_TOOL_APPROVAL_ACTION = 'visionMcp.approval.manage';

const mocks = vi.hoisted(() => ({
	showInformationMessage: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
	showWarningMessage: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
	showErrorMessage: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
	withProgress: vi.fn(
		async (_options: unknown, task: () => Promise<unknown>): Promise<unknown> => task(),
	),
	executeCommand: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
	registerMcpServerDefinitionProvider: vi.fn(() => ({ dispose: vi.fn() })),
	configUpdate: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
	configInspect: vi.fn<() => unknown>(() => undefined),
	deleteWorkspaceFiles: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
	configurationListeners: [] as Array<(event: { affectsConfiguration(section: string): boolean }) => void>,
	secretListeners: [] as Array<(event: { key: string }) => void>,
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
	class FileSystemError extends Error {
		constructor(readonly code: string) {
			super(code);
		}
		static FileNotFound(): FileSystemError {
			return new FileSystemError('FileNotFound');
		}
	}
	return {
		EventEmitter,
		McpStdioServerDefinition,
		FileSystemError,
		ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
		ProgressLocation: { Notification: 15 },
		commands: { executeCommand: (...args: unknown[]) => mocks.executeCommand(...args) },
		window: {
			showInformationMessage: (...args: unknown[]) => mocks.showInformationMessage(...args),
			showWarningMessage: (...args: unknown[]) => mocks.showWarningMessage(...args),
			showErrorMessage: (...args: unknown[]) => mocks.showErrorMessage(...args),
			withProgress: (...args: [unknown, () => Promise<unknown>]) => mocks.withProgress(...args),
		},
		workspace: {
			onDidChangeConfiguration: (
				listener: (event: { affectsConfiguration(section: string): boolean }) => void,
			) => {
				mocks.configurationListeners.push(listener);
				return { dispose: () => {} };
			},
			getConfiguration: () => ({
				inspect: () => mocks.configInspect(),
				update: (...args: unknown[]) => mocks.configUpdate(...args),
			}),
			fs: {
				delete: (...args: unknown[]) => mocks.deleteWorkspaceFiles(...args),
			},
		},
		Uri: { file: (path: string) => ({ fsPath: path }), parse: (v: string) => ({ v }) },
		env: { openExternal: async () => true },
		lm: { registerMcpServerDefinitionProvider: mocks.registerMcpServerDefinitionProvider },
	};
});

vi.mock('../config', () => ({
	getBaseUrlOverride: () => baseUrlOverrideValue,
	getRegion: () => 'international',
	getVisionEnabled: () => visionEnabledValue,
}));
vi.mock('../i18n', () => ({
	t: (key: string, ...args: string[]) => (args.length ? `${key}(${args.join('|')})` : key),
}));
vi.mock('../logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('../vision-tool', () => ({ findVisionAnalyzeTool: () => mocks.findVisionAnalyzeTool() }));

import * as vscode from 'vscode';
import { VISION_API_KEY_SECRET, VISION_HEALTH_POLL_MS } from '../consts';
import { fakeMemento } from '../test-helpers';
import type { IAuthManager, IVisionApiKeyManager } from '../types';
import { buildVisionMcpServerSpec, VisionMcpManager, type NodeRuntimeProbe } from './mcp';
import type { IVisionMcpPackageInstaller } from './mcp-package';

let baseUrlOverrideValue = '';
let visionEnabledValue = false;

function emitConfigurationChange(section: string): void {
	for (const listener of mocks.configurationListeners) {
		listener({ affectsConfiguration: (candidate: string) => candidate === section });
	}
}

function emitSecretChange(key: string): void {
	for (const listener of mocks.secretListeners) {
		listener({ key });
	}
}

function getApprovalGuidanceCalls(): unknown[][] {
	return mocks.showInformationMessage.mock.calls.filter(
		(call) => call[0] === APPROVAL_GUIDANCE_MESSAGE,
	);
}

function fakeContext(installed: boolean) {
	const globalState = fakeMemento();
	if (installed) {
		globalState.store.set('glm-copilot.visionMcp.installed', true);
	}
	return {
		globalState,
		secrets: {
			onDidChange: (listener: (event: { key: string }) => void) => {
				mocks.secretListeners.push(listener);
				return { dispose: () => {} };
			},
		},
		subscriptions: [] as Array<{ dispose(): void }>,
		globalStorageUri: { fsPath: '/tmp/glm-test-storage' },
		extensionUri: { fsPath: '/tmp/glm-test-extension' },
	} as unknown as vscode.ExtensionContext;
}

interface AuthFixtureOptions {
	chatApiKey?: string;
	visionApiKey?: string;
}

function authWithCredentials(
	options: AuthFixtureOptions = {},
): IAuthManager & IVisionApiKeyManager {
	return {
		getApiKey: vi.fn(async () => options.chatApiKey),
		hasApiKey: vi.fn(async () => options.chatApiKey !== undefined),
		promptForApiKey: vi.fn(async () => false),
		deleteApiKey: vi.fn(async () => {}),
		getVisionApiKey: vi.fn(async () => options.visionApiKey),
		promptForVisionApiKey: vi.fn(async () => false),
		deleteVisionApiKey: vi.fn(async () => {}),
	};
}

function authWithKey(): IAuthManager & IVisionApiKeyManager {
	return authWithCredentials({ chatApiKey: 'id.secret' });
}

function makeManager(
	installed: boolean,
	probe: () => Promise<NodeRuntimeProbe> = async () => ({ npmOk: true, nodeMajor: 22 }),
) {
	const context = fakeContext(installed);
	const packageInstaller = fakePackageInstaller(installed);
	const manager = new VisionMcpManager(context, authWithKey(), probe, packageInstaller);
	return { context, manager, packageInstaller };
}

function fakePackageInstaller(installed: boolean): IVisionMcpPackageInstaller & {
	install: ReturnType<typeof vi.fn<() => Promise<void>>>;
	uninstall: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
	let present = installed;
	return {
		entryPoint: '/tmp/glm-test-storage/vision-mcp/node_modules/@z_ai/mcp-server/build/index.js',
		isInstalled: () => present,
		install: vi.fn(async () => {
			present = true;
		}),
		uninstall: vi.fn(async () => {
			present = false;
		}),
	};
}

beforeEach(() => {
	baseUrlOverrideValue = '';
	visionEnabledValue = false;
	vi.clearAllMocks();
	mocks.configurationListeners.length = 0;
	mocks.secretListeners.length = 0;
	mocks.configInspect.mockReturnValue(undefined);
	mocks.deleteWorkspaceFiles.mockReset();
	mocks.deleteWorkspaceFiles.mockResolvedValue(undefined);
	mocks.findVisionAnalyzeTool.mockReturnValue(undefined);
	mocks.configUpdate.mockImplementation(async (section: unknown, value: unknown) => {
		if (section === 'visionEnabled') {
			visionEnabledValue = value === true;
			emitConfigurationChange('glm-copilot.visionEnabled');
		}
	});
	mocks.showInformationMessage.mockImplementation(async () => undefined);
	mocks.showWarningMessage.mockImplementation(async (message: unknown) =>
		message === 'visionMcp.install.consent' ? 'visionMcp.install.confirm' : undefined,
	);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('buildVisionMcpServerSpec', () => {
	it('runs the verified local entry point with Node.js in the international region', () => {
		const entryPoint = '/secure/vision-mcp/build/index.js';
		const spec = buildVisionMcpServerSpec({ region: 'international', entryPoint });
		expect(spec.label).toBe('GLM Vision');
		expect(spec.command).toBe(process.execPath);
		expect(spec.args).toEqual([entryPoint]);
		expect(spec.env).toEqual({
			Z_AI_MODE: 'ZAI',
			PLATFORM_MODE: 'ZAI',
			Z_AI_BASE_URL: null,
			ANTHROPIC_AUTH_TOKEN: null,
			ZAI_API_KEY: null,
			SERVER_NAME: null,
			Z_AI_TIMEOUT: '120000',
			Z_AI_VISION_MODEL_MAX_TOKENS: '32768',
		});
	});

	it('uses ZHIPU mode for the China region', () => {
		const spec = buildVisionMcpServerSpec({ region: 'china', entryPoint: '/secure/index.js' });
		expect(spec.env.Z_AI_MODE).toBe('ZHIPU');
		expect(spec.env.PLATFORM_MODE).toBe('ZHIPU');
	});

	it('never embeds the API key in the base spec (injected only when the server starts)', () => {
		const spec = buildVisionMcpServerSpec({
			region: 'international',
			entryPoint: '/secure/index.js',
		});
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

	it('clears stale state instead of registering when the verified package is missing', () => {
		const context = fakeContext(true);
		const packageInstaller = fakePackageInstaller(false);
		const manager = new VisionMcpManager(
			context,
			authWithKey(),
			async () => ({ npmOk: true, nodeMajor: 22 }),
			packageInstaller,
		);

		manager.initialize();

		expect(mocks.registerMcpServerDefinitionProvider).not.toHaveBeenCalled();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		expect(packageInstaller.uninstall).toHaveBeenCalledOnce();
		manager.dispose();
	});

	it('resets the healthy context key at activation even when the server is stopped', () => {
		const { manager } = makeManager(true);
		manager.initialize();
		expect(mocks.executeCommand).toHaveBeenCalledWith(
			'setContext',
			'glmCopilot.visionMcp.healthy',
			false,
		);
		manager.dispose();
	});

	it('mirrors the visionEnabled setting into its context key at activation', () => {
		visionEnabledValue = true;
		const { manager } = makeManager(false);
		manager.initialize();
		expect(mocks.executeCommand).toHaveBeenCalledWith('setContext', 'glmCopilot.visionEnabled', true);
		manager.dispose();
	});

	it('re-mirrors the visionEnabled context key when the setting changes', () => {
		const { manager } = makeManager(false);
		manager.initialize();
		expect(mocks.executeCommand).toHaveBeenCalledWith('setContext', 'glmCopilot.visionEnabled', false);

		visionEnabledValue = true;
		emitConfigurationChange('glm-copilot.visionEnabled');
		expect(mocks.executeCommand).toHaveBeenCalledWith('setContext', 'glmCopilot.visionEnabled', true);
		manager.dispose();
	});

	it('install registers the server, persists the flag, and confirms', async () => {
		const { context, manager, packageInstaller } = makeManager(false);
		await manager.install();
		expect(packageInstaller.install).toHaveBeenCalledOnce();
		expect(mocks.registerMcpServerDefinitionProvider).toHaveBeenCalledTimes(1);
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBe(true);
		expect(mocks.showInformationMessage).toHaveBeenCalledWith(
			'visionMcp.install.success',
			'visionMcp.openServers',
			'visionMcp.editPrompt',
		);
		manager.dispose();
	});

	it('notifies listeners after installation makes configured image input available', async () => {
		visionEnabledValue = true;
		const { manager } = makeManager(false);
		const imageInputStates: boolean[] = [];
		manager.onDidChangeState(() => {
			imageInputStates.push(manager.isImageInputEnabled());
		});

		await manager.install();

		expect(imageInputStates).toEqual([true]);
		manager.dispose();
	});

	it('guides approval after installation makes configured image input healthy', async () => {
		visionEnabledValue = true;
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		const { manager } = makeManager(false);

		await manager.install();

		expect(getApprovalGuidanceCalls()).toEqual([
			[APPROVAL_GUIDANCE_MESSAGE, MANAGE_TOOL_APPROVAL_ACTION],
		]);
		manager.dispose();
	});

	it('shows the package impact and requires explicit consent before installation', async () => {
		mocks.showWarningMessage.mockResolvedValueOnce(undefined);
		const { context, manager, packageInstaller } = makeManager(false);

		await manager.install();

		expect(mocks.showWarningMessage).toHaveBeenCalledWith(
			'visionMcp.install.consent',
			{
				modal: true,
				detail: 'visionMcp.install.consentDetail(@z_ai/mcp-server@0.1.4)',
			},
			'visionMcp.install.confirm',
			'visionMcp.install.viewPackage',
		);
		expect(packageInstaller.install).not.toHaveBeenCalled();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		manager.dispose();
	});

	it('rolls back the registration and persisted state when persisting installation fails', async () => {
		const context = fakeContext(false);
		const packageInstaller = fakePackageInstaller(false);
		const realUpdate = context.globalState.update.bind(context.globalState);
		vi.spyOn(context.globalState, 'update').mockImplementation((key: string, value: unknown) => {
			if (key === 'glm-copilot.visionMcp.installed' && value === true) {
				return Promise.reject(new Error('persist boom'));
			}
			return realUpdate(key, value);
		});
		const manager = new VisionMcpManager(context, authWithKey(), async () => ({
			npmOk: true,
			nodeMajor: 22,
		}), packageInstaller);

		await expect(manager.install()).rejects.toThrow('persist boom');

		const registration = mocks.registerMcpServerDefinitionProvider.mock.results[0].value;
		expect(registration.dispose).toHaveBeenCalled();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		expect(mocks.executeCommand).toHaveBeenCalledWith('setContext', 'glmCopilot.visionMcp.installed', false);
		expect(packageInstaller.uninstall).toHaveBeenCalledOnce();
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
		const noKeyAuth = authWithCredentials();
		const context = fakeContext(false);
		const packageInstaller = fakePackageInstaller(false);
		const manager = new VisionMcpManager(context, noKeyAuth, async () => ({
			npmOk: true,
			nodeMajor: 22,
		}), packageInstaller);

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

	it('install requires a separate Vision key when a custom Base URL is active', async () => {
		baseUrlOverrideValue = 'https://proxy.example/v4';
		const auth = authWithCredentials({ chatApiKey: 'proxy.secret' });
		const context = fakeContext(false);
		const packageInstaller = fakePackageInstaller(false);
		const manager = new VisionMcpManager(
			context,
			auth,
			async () => ({ npmOk: true, nodeMajor: 22 }),
			packageInstaller,
		);

		await manager.install();

		expect(auth.getApiKey).not.toHaveBeenCalled();
		expect(auth.promptForApiKey).not.toHaveBeenCalled();
		expect(auth.promptForVisionApiKey).toHaveBeenCalledOnce();
		expect(mocks.showWarningMessage).toHaveBeenCalledWith(
			'visionMcp.auth.separateRequired',
			'visionMcp.auth.enterVisionKey',
			'visionMcp.notNow',
		);
		expect(packageInstaller.install).not.toHaveBeenCalled();
		manager.dispose();
	});

	it('install aborts without registering when Node.js is missing and the user cancels', async () => {
		const { context, manager, packageInstaller } = makeManager(false, async () => ({
			npmOk: false,
		}));
		await manager.install();
		expect(mocks.showWarningMessage).toHaveBeenCalledWith(
			'visionMcp.runtime.missing',
			'visionMcp.runtime.requirements',
			'visionMcp.cancel',
		);
		expect(packageInstaller.install).not.toHaveBeenCalled();
		expect(mocks.registerMcpServerDefinitionProvider).not.toHaveBeenCalled();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		manager.dispose();
	});

	it('install warns with the detected version when Node.js is older than required', async () => {
		const { context, manager, packageInstaller } = makeManager(false, async () => ({
			npmOk: true,
			nodeMajor: 16,
		}));
		await manager.install();
		expect(mocks.showWarningMessage).toHaveBeenCalledWith(
			'visionMcp.runtime.tooOld(16|18)',
			'visionMcp.runtime.requirements',
			'visionMcp.cancel',
		);
		expect(packageInstaller.install).not.toHaveBeenCalled();
		expect(mocks.registerMcpServerDefinitionProvider).not.toHaveBeenCalled();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		manager.dispose();
	});

	it('install skips the version warning when the Node.js version is unknown', async () => {
		const { context, manager } = makeManager(false, async () => ({ npmOk: true }));
		await manager.install();
		expect(
			mocks.showWarningMessage.mock.calls.some((call) =>
				String(call[0]).startsWith('visionMcp.runtime.'),
			),
		).toBe(false);
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBe(true);
		manager.dispose();
	});

	it('does not register the server when the locked package installation fails', async () => {
		const { context, manager, packageInstaller } = makeManager(false);
		packageInstaller.install.mockRejectedValueOnce(new Error('integrity mismatch'));

		await manager.install();

		expect(mocks.showErrorMessage).toHaveBeenCalledWith(
			'visionMcp.install.failed',
			'visionMcp.showLogs',
		);
		expect(mocks.registerMcpServerDefinitionProvider).not.toHaveBeenCalled();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		manager.dispose();
	});

	it('ignores uninstall while an install is in flight', async () => {
		const { manager, packageInstaller } = makeManager(false);
		let finishInstall!: () => void;
		packageInstaller.install.mockImplementationOnce(() => {
			packageInstaller.isInstalled = () => true;
			return new Promise<void>((resolve) => {
				finishInstall = resolve;
			});
		});
		manager.initialize();

		const installPromise = manager.install();
		await vi.waitFor(() => expect(packageInstaller.install).toHaveBeenCalledOnce());

		await manager.uninstall();

		expect(packageInstaller.uninstall).not.toHaveBeenCalled();

		finishInstall();
		await installPromise;
		expect(manager.isInstalled).toBe(true);
		manager.dispose();
	});

	it('uninstall disposes the registration and clears the installed flag', async () => {
		const { context, manager, packageInstaller } = makeManager(true);
		manager.initialize();
		const registration = mocks.registerMcpServerDefinitionProvider.mock.results[0].value;

		await manager.uninstall();

		expect(registration.dispose).toHaveBeenCalled();
		expect(packageInstaller.uninstall).toHaveBeenCalledOnce();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		expect(mocks.showInformationMessage).toHaveBeenCalledWith('visionMcp.uninstall.done');
		manager.dispose();
	});

	it('notifies listeners after uninstall removes image input', async () => {
		visionEnabledValue = true;
		const { manager } = makeManager(true);
		manager.initialize();
		const imageInputStates: boolean[] = [];
		manager.onDidChangeState(() => {
			imageInputStates.push(manager.isImageInputEnabled());
		});

		await manager.uninstall();

		expect(imageInputStates).toEqual([false]);
		manager.dispose();
	});

	it('uninstall resets the visionEnabled setting so a reinstall asks for consent again', async () => {
		visionEnabledValue = true;
		mocks.configInspect.mockReturnValue({ globalValue: true });
		const { manager } = makeManager(true);
		manager.initialize();

		await manager.uninstall();

		expect(mocks.configUpdate).toHaveBeenCalledWith('visionEnabled', undefined, 1);
		manager.dispose();
	});

	it('uninstall clears workspace and global visionEnabled values', async () => {
		visionEnabledValue = true;
		mocks.configInspect.mockReturnValue({ globalValue: true, workspaceValue: true });
		const { manager } = makeManager(true);
		manager.initialize();

		await manager.uninstall();

		expect(mocks.configUpdate.mock.calls).toContainEqual(['visionEnabled', undefined, 2]);
		expect(mocks.configUpdate.mock.calls).toContainEqual(['visionEnabled', undefined, 1]);
		manager.dispose();
	});

	it('uninstall clears recorded state even when the local package is incomplete', async () => {
		const context = fakeContext(true);
		const packageInstaller = fakePackageInstaller(false);
		const manager = new VisionMcpManager(
			context,
			authWithKey(),
			async () => ({ npmOk: true, nodeMajor: 22 }),
			packageInstaller,
		);

		await manager.uninstall();

		expect(packageInstaller.uninstall).toHaveBeenCalledOnce();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		expect(mocks.executeCommand).toHaveBeenCalledWith(
			'setContext',
			'glmCopilot.visionMcp.installed',
			false,
		);
		manager.dispose();
	});

	it('disables Vision before reporting residual package files after cleanup fails', async () => {
		visionEnabledValue = true;
		mocks.configInspect.mockReturnValue({ globalValue: true });
		const context = fakeContext(true);
		const auth = {
			...authWithKey(),
			deleteVisionApiKey: vi.fn(async () => {}),
		};
		const packageInstaller = fakePackageInstaller(true);
		const manager = new VisionMcpManager(
			context,
			auth,
			async () => ({ npmOk: true, nodeMajor: 22 }),
			packageInstaller,
		);
		manager.initialize();
		const registration = mocks.registerMcpServerDefinitionProvider.mock.results[0].value;
		packageInstaller.uninstall.mockImplementationOnce(async () => {
			expect(registration.dispose).toHaveBeenCalledOnce();
			expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
			expect(visionEnabledValue).toBe(false);
			expect(auth.deleteVisionApiKey).toHaveBeenCalledOnce();
			throw new Error('permission denied');
		});

		await manager.uninstall();

		expect(registration.dispose).toHaveBeenCalledOnce();
		expect(context.globalState.get('glm-copilot.visionMcp.installed')).toBeUndefined();
		expect(mocks.executeCommand).toHaveBeenCalledWith(
			'setContext',
			'glmCopilot.visionMcp.installed',
			false,
		);
		expect(mocks.configUpdate).toHaveBeenCalledWith('visionEnabled', undefined, 1);
		expect(auth.deleteVisionApiKey).toHaveBeenCalledOnce();
		expect(manager.isInstalled).toBe(false);
		expect(manager.isImageInputEnabled()).toBe(false);
		expect(packageInstaller.isInstalled()).toBe(true);
		expect(mocks.showWarningMessage).toHaveBeenCalledWith(
			'visionMcp.uninstall.cleanupFailed',
			'visionMcp.showLogs',
		);
		manager.dispose();
	});

	it('still removes the package when Vision key cleanup fails', async () => {
		visionEnabledValue = true;
		mocks.configInspect.mockReturnValue({ globalValue: true });
		const context = fakeContext(true);
		const auth = {
			...authWithKey(),
			deleteVisionApiKey: vi.fn(async () => {
				throw new Error('keychain locked');
			}),
		};
		const packageInstaller = fakePackageInstaller(true);
		const manager = new VisionMcpManager(
			context,
			auth,
			async () => ({ npmOk: true, nodeMajor: 22 }),
			packageInstaller,
		);
		manager.initialize();

		await manager.uninstall();

		expect(packageInstaller.uninstall).toHaveBeenCalledOnce();
		expect(manager.isInstalled).toBe(false);
		expect(manager.isImageInputEnabled()).toBe(false);
		expect(mocks.showWarningMessage).toHaveBeenCalledWith(
			'visionMcp.uninstall.cleanupFailed',
			'visionMcp.showLogs',
		);
		expect(
			mocks.showInformationMessage.mock.calls.map((call) => call[0]),
		).not.toContain('visionMcp.uninstall.done');
		manager.dispose();
	});

	it('reports temp-image cleanup failure after it removes the package', async () => {
		const { manager, packageInstaller } = makeManager(true);
		mocks.deleteWorkspaceFiles.mockRejectedValueOnce(new Error('permission denied'));
		manager.initialize();

		await manager.uninstall();

		expect(packageInstaller.uninstall).toHaveBeenCalledOnce();
		expect(manager.isInstalled).toBe(false);
		expect(manager.isImageInputEnabled()).toBe(false);
		expect(mocks.showWarningMessage).toHaveBeenCalledWith(
			'visionMcp.uninstall.cleanupFailed',
			'visionMcp.showLogs',
		);
		expect(
			mocks.showInformationMessage.mock.calls.map((call) => call[0]),
		).not.toContain('visionMcp.uninstall.done');
		manager.dispose();
	});

	it('treats a missing temp-image directory as already-clean during uninstall', async () => {
		const { manager, packageInstaller } = makeManager(true);
		mocks.deleteWorkspaceFiles.mockRejectedValueOnce(vscode.FileSystemError.FileNotFound());
		manager.initialize();

		await manager.uninstall();

		expect(packageInstaller.uninstall).toHaveBeenCalledOnce();
		expect(mocks.showWarningMessage).not.toHaveBeenCalledWith(
			'visionMcp.uninstall.cleanupFailed',
			'visionMcp.showLogs',
		);
		expect(mocks.showInformationMessage).toHaveBeenCalledWith('visionMcp.uninstall.done');
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

	it('guides approval once when healthy vision changes from off to on', async () => {
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		const { manager } = makeManager(true);
		manager.initialize();
		mocks.showInformationMessage.mockClear();

		await manager.toggleVision();

		expect(mocks.configUpdate).toHaveBeenCalledWith('visionEnabled', true, 1);
		expect(getApprovalGuidanceCalls()).toEqual([
			[APPROVAL_GUIDANCE_MESSAGE, MANAGE_TOOL_APPROVAL_ACTION],
		]);
		manager.dispose();
	});

	it('opens the VS Code tool approval manager when the guidance action is selected', async () => {
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		mocks.showInformationMessage.mockImplementation(async (message: unknown) =>
			message === APPROVAL_GUIDANCE_MESSAGE ? MANAGE_TOOL_APPROVAL_ACTION : undefined,
		);
		const { manager } = makeManager(true);
		manager.initialize();

		await manager.toggleVision();
		await Promise.resolve();

		expect(mocks.executeCommand).toHaveBeenCalledWith(
			'workbench.action.chat.editToolApproval',
		);
		manager.dispose();
	});

	it('does not change approval settings when the guidance is dismissed', async () => {
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		const { manager } = makeManager(true);
		manager.initialize();

		await manager.toggleVision();
		await Promise.resolve();

		expect(mocks.executeCommand).not.toHaveBeenCalledWith(
			'workbench.action.chat.editToolApproval',
		);
		expect(mocks.configUpdate.mock.calls).toEqual([['visionEnabled', true, 1]]);
		manager.dispose();
	});

	it('guides approval after a direct visionEnabled setting transition', () => {
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		const { manager } = makeManager(true);
		manager.initialize();
		mocks.showInformationMessage.mockClear();

		visionEnabledValue = true;
		emitConfigurationChange('glm-copilot.visionEnabled');

		expect(getApprovalGuidanceCalls()).toEqual([
			[APPROVAL_GUIDANCE_MESSAGE, MANAGE_TOOL_APPROVAL_ACTION],
		]);
		manager.dispose();
	});

	it('defers approval guidance until analyze_image becomes visible', async () => {
		vi.useFakeTimers();
		const { manager } = makeManager(true);
		manager.initialize();

		visionEnabledValue = true;
		emitConfigurationChange('glm-copilot.visionEnabled');
		expect(getApprovalGuidanceCalls()).toHaveLength(0);

		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		await vi.advanceTimersByTimeAsync(VISION_HEALTH_POLL_MS);

		expect(getApprovalGuidanceCalls()).toEqual([
			[APPROVAL_GUIDANCE_MESSAGE, MANAGE_TOOL_APPROVAL_ACTION],
		]);
		manager.dispose();
	});

	it('cancels deferred approval guidance when vision is disabled before recovery', async () => {
		vi.useFakeTimers();
		const { manager } = makeManager(true);
		manager.initialize();

		visionEnabledValue = true;
		emitConfigurationChange('glm-copilot.visionEnabled');
		visionEnabledValue = false;
		emitConfigurationChange('glm-copilot.visionEnabled');
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		await vi.advanceTimersByTimeAsync(VISION_HEALTH_POLL_MS);

		expect(getApprovalGuidanceCalls()).toHaveLength(0);
		manager.dispose();
	});

	it('does not guide approval at startup or duplicate an open notice during health polls', async () => {
		vi.useFakeTimers();
		visionEnabledValue = true;
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		let dismissGuidance: (() => void) | undefined;
		mocks.showInformationMessage.mockImplementation(
			(message: unknown) =>
				message === APPROVAL_GUIDANCE_MESSAGE
					? new Promise((resolve) => {
							dismissGuidance = () => resolve(undefined);
						})
					: Promise.resolve(undefined),
		);
		const { manager } = makeManager(true);
		manager.initialize();
		expect(getApprovalGuidanceCalls()).toHaveLength(0);

		visionEnabledValue = false;
		emitConfigurationChange('glm-copilot.visionEnabled');
		visionEnabledValue = true;
		emitConfigurationChange('glm-copilot.visionEnabled');
		await vi.advanceTimersByTimeAsync(VISION_HEALTH_POLL_MS * 3);

		expect(getApprovalGuidanceCalls()).toHaveLength(1);
		dismissGuidance?.();
		await Promise.resolve();
		manager.dispose();
	});

	it('guides approval again after a later off-to-on transition', async () => {
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		const { manager } = makeManager(true);
		manager.initialize();
		mocks.showInformationMessage.mockClear();

		await manager.toggleVision();
		await Promise.resolve();
		await manager.toggleVision();
		expect(mocks.showInformationMessage).toHaveBeenCalledWith('visionMcp.toggle.off');
		await manager.toggleVision();
		await Promise.resolve();

		expect(getApprovalGuidanceCalls()).toHaveLength(2);
		manager.dispose();
	});

	it('updates visionEnabled at workspace scope when that scope defines the effective value', async () => {
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		mocks.configInspect.mockReturnValue({ globalValue: false, workspaceValue: false });
		const { manager } = makeManager(true);
		manager.initialize();

		await manager.toggleVision();

		expect(mocks.configUpdate).toHaveBeenCalledWith('visionEnabled', true, 2);
		manager.dispose();
	});

	it('prompts for a server restart when the settings fallback API key changes', () => {
		const { manager } = makeManager(true);
		manager.initialize();
		const event = {
			affectsConfiguration: (section: string) => section === 'glm-copilot.apiKey',
		};

		for (const listener of mocks.configurationListeners) {
			listener(event);
		}

		expect(mocks.showInformationMessage).toHaveBeenCalledWith(
			'visionMcp.restart.apiKey',
			'visionMcp.openServers',
		);
		manager.dispose();
	});

	it('prompts for a server restart when the dedicated Vision key changes', () => {
		const { manager } = makeManager(true);
		manager.initialize();

		emitSecretChange(VISION_API_KEY_SECRET);

		expect(mocks.showInformationMessage).toHaveBeenCalledWith(
			'visionMcp.restart.apiKey',
			'visionMcp.openServers',
		);
		manager.dispose();
	});

	it('prompts for a server restart when the custom Base URL changes', () => {
		const { manager } = makeManager(true);
		manager.initialize();

		emitConfigurationChange('glm-copilot.baseUrl');

		expect(mocks.showInformationMessage).toHaveBeenCalledWith(
			'visionMcp.restart.endpoint',
			'visionMcp.openServers',
		);
		manager.dispose();
	});

	it('enables image input when the verified package is installed and vision is enabled', () => {
		visionEnabledValue = true;
		const { manager } = makeManager(true);
		manager.initialize();

		expect(manager.isImageInputEnabled()).toBe(true);
		manager.dispose();
	});

	it('keeps image input disabled when vision is off even if the server is healthy', () => {
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		const { manager } = makeManager(true);
		manager.initialize();

		expect(manager.isImageInputEnabled()).toBe(false);
		manager.dispose();
	});

	it('keeps models text-only when vision is enabled but the package is not installed', () => {
		mocks.findVisionAnalyzeTool.mockReturnValue({ name: 'mcp_glm_vision_analyze_image' });
		visionEnabledValue = true;
		const { manager } = makeManager(false);

		manager.initialize();

		expect(manager.isImageInputEnabled()).toBe(false);
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

	it('injects the separate Vision key instead of the proxy credential', async () => {
		baseUrlOverrideValue = 'https://proxy.example/v4';
		const auth = authWithCredentials({
			chatApiKey: 'proxy.secret',
			visionApiKey: 'vision.secret',
		});
		const context = fakeContext(true);
		const manager = new VisionMcpManager(
			context,
			auth,
			async () => ({ npmOk: true, nodeMajor: 22 }),
			fakePackageInstaller(true),
		);
		manager.initialize();
		const provider = mocks.registerMcpServerDefinitionProvider.mock.calls[0][1] as {
			resolveMcpServerDefinition?: (server: {
				env: Record<string, string>;
			}) => Promise<{ env: Record<string, string> } | undefined>;
		};

		const resolved = await provider.resolveMcpServerDefinition?.({ env: { Z_AI_MODE: 'ZAI' } });

		expect(resolved?.env.Z_AI_API_KEY).toBe('vision.secret');
		expect(auth.getApiKey).not.toHaveBeenCalled();
		manager.dispose();
	});

	it('does not fall back to the proxy credential when no Vision key is configured', async () => {
		baseUrlOverrideValue = 'https://proxy.example/v4';
		const auth = authWithCredentials({ chatApiKey: 'proxy.secret' });
		const context = fakeContext(true);
		const manager = new VisionMcpManager(
			context,
			auth,
			async () => ({ npmOk: true, nodeMajor: 22 }),
			fakePackageInstaller(true),
		);
		manager.initialize();
		const provider = mocks.registerMcpServerDefinitionProvider.mock.calls[0][1] as {
			resolveMcpServerDefinition?: (server: {
				env: Record<string, string>;
			}) => Promise<{ env: Record<string, string> } | undefined>;
		};

		const resolved = await provider.resolveMcpServerDefinition?.({ env: { Z_AI_MODE: 'ZAI' } });

		expect(resolved).toBeUndefined();
		expect(auth.getApiKey).not.toHaveBeenCalled();
		expect(auth.promptForApiKey).not.toHaveBeenCalled();
		expect(auth.promptForVisionApiKey).toHaveBeenCalledOnce();
		manager.dispose();
	});

	it('does not inject the chat key if a custom Base URL appears during key lookup', async () => {
		const auth: IAuthManager & IVisionApiKeyManager = {
			...authWithCredentials(),
			getApiKey: async () => {
				baseUrlOverrideValue = 'https://proxy.example/v4';
				return 'proxy.secret';
			},
		};
		const context = fakeContext(true);
		const manager = new VisionMcpManager(
			context,
			auth,
			async () => ({ npmOk: true, nodeMajor: 22 }),
			fakePackageInstaller(true),
		);
		manager.initialize();
		const provider = mocks.registerMcpServerDefinitionProvider.mock.calls[0][1] as {
			resolveMcpServerDefinition?: (server: {
				env: Record<string, string>;
			}) => Promise<{ env: Record<string, string> } | undefined>;
		};

		const resolved = await provider.resolveMcpServerDefinition?.({ env: { Z_AI_MODE: 'ZAI' } });

		expect(resolved).toBeUndefined();
		manager.dispose();
	});

	it('re-arms the missing-key warning after the API key recovers', async () => {
		let apiKey: string | undefined;
		const auth: IAuthManager & IVisionApiKeyManager = {
			getApiKey: async () => apiKey,
			hasApiKey: async () => apiKey !== undefined,
			promptForApiKey: async () => false,
			deleteApiKey: async () => {},
			getVisionApiKey: async () => undefined,
			promptForVisionApiKey: async () => false,
			deleteVisionApiKey: async () => {},
		};
		const context = fakeContext(true);
		const manager = new VisionMcpManager(
			context,
			auth,
			async () => ({ npmOk: true, nodeMajor: 22 }),
			fakePackageInstaller(true),
		);
		manager.initialize();
		const provider = mocks.registerMcpServerDefinitionProvider.mock.calls[0][1] as {
			resolveMcpServerDefinition?: (server: {
				env: Record<string, string>;
			}) => Promise<{ env: Record<string, string> } | undefined>;
		};
		const server = { env: { Z_AI_MODE: 'ZAI' } };

		expect(await provider.resolveMcpServerDefinition?.(server)).toBeUndefined();
		expect(await provider.resolveMcpServerDefinition?.(server)).toBeUndefined();
		expect(mocks.showWarningMessage).toHaveBeenCalledTimes(1);

		apiKey = 'id.secret';
		expect(await provider.resolveMcpServerDefinition?.(server)).toBeDefined();

		apiKey = undefined;
		expect(await provider.resolveMcpServerDefinition?.(server)).toBeUndefined();
		expect(mocks.showWarningMessage).toHaveBeenCalledTimes(2);
		manager.dispose();
	});
});
