import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { getRegion, getVisionEnabled } from '../config';
import {
	API_KEY_SECRET,
	CONFIG_SECTION,
	EXTERNAL_URLS,
	VISION_DESCRIPTION_MAX_TOKENS,
	VISION_HEALTH_POLL_MS,
	VISION_MCP_CTX_HEALTHY,
	VISION_MCP_CTX_INSTALLED,
	VISION_MCP_CTX_VISION_ENABLED,
	VISION_MCP_INSTALLED_KEY,
	VISION_MCP_LABEL,
	VISION_MCP_PACKAGE,
	VISION_MCP_PROVIDER_ID,
	VISION_INVOKE_TIMEOUT_MS,
	VISION_NODE_MIN_MAJOR,
	ZAI_API_KEY_ENV,
	ZAI_MODE_CHINA,
	ZAI_MODE_ENV,
	ZAI_MODE_INTERNATIONAL,
} from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import { getVisionTempDir } from '../provider/vision/resolve';
import type { IAuthManager, IVisionMcpState, Region } from '../types';
import { findVisionAnalyzeTool } from '../vision-tool';
import {
	type IVisionMcpPackageInstaller,
	VisionMcpPackageInstaller,
} from './mcp-package';

/** Stdio launch spec for the official Z.AI vision MCP server (without the API key). */
export interface VisionMcpServerSpec {
	label: string;
	command: string;
	args: string[];
	env: Record<string, string | number | null>;
}

/**
 * Build the launch spec for the integrity-locked local `@z_ai/mcp-server`.
 * The API key is injected later, only when the server is actually started.
 */
export function buildVisionMcpServerSpec(options: {
	region: Region;
	entryPoint: string;
}): VisionMcpServerSpec {
	const mode = options.region === 'china' ? ZAI_MODE_CHINA : ZAI_MODE_INTERNATIONAL;
	return {
		label: VISION_MCP_LABEL,
		command: process.execPath,
		args: [options.entryPoint],
		env: {
			[ZAI_MODE_ENV]: mode,
			PLATFORM_MODE: mode,
			Z_AI_BASE_URL: null,
			ANTHROPIC_AUTH_TOKEN: null,
			ZAI_API_KEY: null,
			SERVER_NAME: null,
			Z_AI_TIMEOUT: String(VISION_INVOKE_TIMEOUT_MS),
			Z_AI_VISION_MODEL_MAX_TOKENS: String(VISION_DESCRIPTION_MAX_TOKENS),
		},
	};
}

/** Result of the local Node.js runtime preflight for the vision MCP server. */
export interface NodeRuntimeProbe {
	/** Whether npm (the locked package installer) is runnable. */
	npmOk: boolean;
	/** Major version of `node` on PATH; undefined when it cannot be determined. */
	nodeMajor?: number;
}

/**
 * Spawn a probe command with a 10 s kill timer, capturing stdout. Resolves
 * undefined when the command cannot be spawned, errors, or times out.
 */
function runProbe(
	command: string,
	args: string[],
): Promise<{ code: number | null; stdout: string } | undefined> {
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
		} catch {
			resolve(undefined);
			return;
		}
		let stdout = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		const timer = setTimeout(() => {
			child.kill();
			resolve(undefined);
		}, 10_000);
		child.on('error', () => {
			clearTimeout(timer);
			resolve(undefined);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code, stdout });
		});
	});
}

/** Probe whether npm is runnable. */
async function probeNpm(platform: NodeJS.Platform): Promise<boolean> {
	const isWindows = platform === 'win32';
	const result = await runProbe(
		isWindows ? 'cmd.exe' : 'npm',
		isWindows ? ['/c', 'npm', '--version'] : ['--version'],
	);
	return result?.code === 0;
}

/**
 * Probe `node --version` for the major version.
 */
async function probeNodeMajor(): Promise<number | undefined> {
	const result = await runProbe('node', ['--version']);
	const major = result?.code === 0 ? /^v(\d+)\./.exec(result.stdout.trim())?.[1] : undefined;
	return major === undefined ? undefined : Number(major);
}

/** Full runtime preflight: npm presence plus the Node.js major version. */
export async function probeNodeRuntime(platform: NodeJS.Platform): Promise<NodeRuntimeProbe> {
	const [npmOk, nodeMajor] = await Promise.all([probeNpm(platform), probeNodeMajor()]);
	return { npmOk, nodeMajor };
}

/**
 * Owns the GLM Vision MCP server lifecycle: explicit install/uninstall (the
 * server is never registered silently), health tracking via VS Code's tool
 * list, the vision on/off toggle, and restart prompts when the region or API
 * key changes under a running server.
 *
 * "Healthy" means the server's `analyze_image` tool shows up in
 * `vscode.lm.tools`, i.e. VS Code has started the server and enumerated its
 * tools. VS Code auto-starts extension-provided MCP servers when a chat
 * message is submitted; there is no public tool-change event, so health is
 * re-checked on a poll interval. True liveness only shows at invokeTool time,
 * where failures degrade gracefully per request.
 */
export class VisionMcpManager implements IVisionMcpState, vscode.Disposable {
	private readonly didChangeDefinitions = new vscode.EventEmitter<void>();
	private readonly didChangeState = new vscode.EventEmitter<void>();
	readonly onDidChangeState = this.didChangeState.event;

	private registration: vscode.Disposable | undefined;
	private healthy = false;
	private installInProgress = false;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private restartPromptOpen = false;
	private resolveKeyWarningShown = false;
	private readyPromptShown = false;
	private unhealthyNoticeShown = false;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly authManager: IAuthManager,
		/** Test seam: Node.js/npm preflight probe. */
		private readonly probeRuntime: () => Promise<NodeRuntimeProbe> = () =>
			probeNodeRuntime(process.platform),
		private readonly packageInstaller: IVisionMcpPackageInstaller = new VisionMcpPackageInstaller(
			context,
		),
	) {
		this.disposables.push(
			this.didChangeDefinitions,
			this.didChangeState,
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration(`${CONFIG_SECTION}.region`)) {
					this.onServerConfigChanged('region');
				} else if (e.affectsConfiguration(`${CONFIG_SECTION}.apiKey`)) {
					this.onServerConfigChanged('apiKey');
				} else if (e.affectsConfiguration(`${CONFIG_SECTION}.visionEnabled`)) {
					this.syncVisionEnabledContext();
				}
			}),
			context.secrets.onDidChange((e) => {
				if (e.key === API_KEY_SECRET) {
					this.onServerConfigChanged('apiKey');
				}
			}),
		);
	}

	get isInstalled(): boolean {
		return this.isInstallRecorded && this.packageInstaller.isInstalled();
	}

	isVisionActive(): boolean {
		return this.isInstalled && this.healthy && getVisionEnabled();
	}

	private get isInstallRecorded(): boolean {
		return this.context.globalState.get<boolean>(VISION_MCP_INSTALLED_KEY) === true;
	}

	/** Called once at activation: restore an explicit install and start health tracking. */
	initialize(): void {
		const packageInstalled = this.packageInstaller.isInstalled();
		if (this.isInstallRecorded !== packageInstalled) {
			void this.context.globalState.update(VISION_MCP_INSTALLED_KEY, undefined);
			void this.packageInstaller
				.uninstall()
				.catch((error) => logger.warn('Failed to clean an incomplete GLM Vision installation', error));
		}
		void vscode.commands.executeCommand('setContext', VISION_MCP_CTX_INSTALLED, this.isInstalled);
		// Context keys survive an extension-host restart; clear a stale healthy flag up front.
		void vscode.commands.executeCommand('setContext', VISION_MCP_CTX_HEALTHY, false);
		this.syncVisionEnabledContext();
		if (this.isInstalled) {
			this.registerDefinitionProvider();
			this.startHealthPolling();
		}
		this.refreshHealth();
	}

	/** Mirror the visionEnabled setting into a context key for walkthrough completion. */
	private syncVisionEnabledContext(): void {
		void vscode.commands.executeCommand('setContext', VISION_MCP_CTX_VISION_ENABLED, getVisionEnabled());
	}

	/** Explicit install flow: consent → key → runtime → locked package → register. */
	async install(): Promise<void> {
		if (this.isInstalled) {
			void vscode.window.showInformationMessage(t('visionMcp.install.alreadyInstalled'));
			return;
		}
		if (this.installInProgress) {
			return;
		}
		this.installInProgress = true;
		try {
			if (!(await this.confirmInstallRisk())) {
				return;
			}
			if (!(await this.ensureApiKey())) {
				return;
			}
			if (!(await this.confirmNodeRuntime())) {
				return;
			}
			try {
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: t('visionMcp.install.progress', VISION_MCP_PACKAGE),
						cancellable: false,
					},
					() => this.packageInstaller.install(),
				);
			} catch (error) {
				logger.error('Failed to install the locked GLM Vision MCP package', error);
				const choice = await vscode.window.showErrorMessage(
					t('visionMcp.install.failed'),
					t('visionMcp.showLogs'),
				);
				if (choice === t('visionMcp.showLogs')) {
					logger.show();
				}
				return;
			}
			if (!this.registerDefinitionProvider()) {
				await this.packageInstaller.uninstall();
				return;
			}
			try {
				await this.context.globalState.update(VISION_MCP_INSTALLED_KEY, true);
				await vscode.commands.executeCommand('setContext', VISION_MCP_CTX_INSTALLED, true);
			} catch (error) {
				this.registration?.dispose();
				this.registration = undefined;
				try {
					await this.context.globalState.update(VISION_MCP_INSTALLED_KEY, undefined);
					await vscode.commands.executeCommand('setContext', VISION_MCP_CTX_INSTALLED, false);
				} catch (rollbackError) {
					logger.warn('Failed to roll back GLM Vision installation state', rollbackError);
				}
				await this.packageInstaller.uninstall();
				throw error;
			}
			this.startHealthPolling();
			this.refreshHealth();
			const choice = await vscode.window.showInformationMessage(
				t('visionMcp.install.success'),
				t('visionMcp.openServers'),
				t('visionMcp.editPrompt'),
			);
			if (choice === t('visionMcp.openServers')) {
				void vscode.commands.executeCommand('workbench.mcp.listServers');
			} else if (choice === t('visionMcp.editPrompt')) {
				void vscode.commands.executeCommand('glm-copilot.openVisionPromptSettings');
			}
		} finally {
			this.installInProgress = false;
		}
	}

	/** Explicit uninstall: drop the registration, state, vision toggle, context keys, and temp images. */
	async uninstall(): Promise<void> {
		if (!this.isInstallRecorded && !this.packageInstaller.isInstalled()) {
			return;
		}
		try {
			await this.packageInstaller.uninstall();
		} catch (error) {
			logger.error('Failed to remove the local GLM Vision MCP package', error);
			const choice = await vscode.window.showWarningMessage(
				t('visionMcp.uninstall.cleanupFailed'),
				t('visionMcp.showLogs'),
			);
			if (choice === t('visionMcp.showLogs')) {
				logger.show();
			}
			return;
		}
		this.registration?.dispose();
		this.registration = undefined;
		await this.context.globalState.update(VISION_MCP_INSTALLED_KEY, undefined);
		await vscode.commands.executeCommand('setContext', VISION_MCP_CTX_INSTALLED, false);
		const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const visionSetting = configuration.inspect<boolean>('visionEnabled');
		if (visionSetting?.workspaceValue !== undefined) {
			await configuration.update(
				'visionEnabled',
				undefined,
				vscode.ConfigurationTarget.Workspace,
			);
		}
		if (visionSetting?.globalValue !== undefined) {
			await configuration.update(
				'visionEnabled',
				undefined,
				vscode.ConfigurationTarget.Global,
			);
		}
		this.stopHealthPolling();
		await this.deleteTempImages();
		// Re-arm the install-flow latches for a future reinstall. An explicit
		// uninstall is not an outage: the "stopped" notice only fires while installed.
		this.readyPromptShown = false;
		this.resolveKeyWarningShown = false;
		this.refreshHealth();
		void vscode.window.showInformationMessage(t('visionMcp.uninstall.done'));
	}

	/** Flip the `visionEnabled` setting (only honored while the server is healthy). */
	async toggleVision(): Promise<void> {
		const enable = !getVisionEnabled();
		if (enable && !this.healthy) {
			void vscode.window.showWarningMessage(t('visionMcp.toggle.notRunning'));
			return;
		}
		const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const target =
			configuration.inspect<boolean>('visionEnabled')?.workspaceValue !== undefined
				? vscode.ConfigurationTarget.Workspace
				: vscode.ConfigurationTarget.Global;
		await configuration.update('visionEnabled', enable, target);
		void vscode.window.showInformationMessage(
			t(enable ? 'visionMcp.toggle.on' : 'visionMcp.toggle.off'),
		);
	}

	dispose(): void {
		this.stopHealthPolling();
		this.registration?.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	private startHealthPolling(): void {
		this.pollTimer ??= setInterval(() => this.refreshHealth(), VISION_HEALTH_POLL_MS);
	}

	private stopHealthPolling(): void {
		clearInterval(this.pollTimer);
		this.pollTimer = undefined;
	}

	private registerDefinitionProvider(): boolean {
		const register = (
			vscode.lm as {
				registerMcpServerDefinitionProvider?: typeof vscode.lm.registerMcpServerDefinitionProvider;
			}
		).registerMcpServerDefinitionProvider;
		if (typeof register !== 'function') {
			logger.warn('MCP server definition provider API unavailable; cannot start GLM Vision');
			void vscode.window.showWarningMessage(t('visionMcp.install.unsupported'));
			return false;
		}

		const provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> = {
			onDidChangeMcpServerDefinitions: this.didChangeDefinitions.event,
			provideMcpServerDefinitions: () => {
				const region = getRegion();
				const spec = buildVisionMcpServerSpec({
					region,
					entryPoint: this.packageInstaller.entryPoint,
				});
				// The version field lets VS Code flag tools as changed when the region flips.
				return [new vscode.McpStdioServerDefinition(spec.label, spec.command, spec.args, spec.env, region)];
			},
			resolveMcpServerDefinition: (server) => this.resolveServer(server),
		};
		this.registration = register(VISION_MCP_PROVIDER_ID, provider);
		return true;
	}

	/** Inject the API key at server start; on failure, point the user at the fix. */
	private async resolveServer(
		server: vscode.McpStdioServerDefinition,
	): Promise<vscode.McpStdioServerDefinition | undefined> {
		const apiKey = (await this.authManager.getApiKey()) ?? (await this.promptForVisionApiKey());
		if (!apiKey) {
			if (!this.resolveKeyWarningShown) {
				this.resolveKeyWarningShown = true;
				const choice = await vscode.window.showWarningMessage(
					t('visionMcp.resolveKeyRequired'),
					t('error.action.setApiKey'),
					t('visionMcp.notNow'),
				);
				if (choice === t('error.action.setApiKey')) {
					await vscode.commands.executeCommand('glm-copilot.setApiKey');
				}
			}
			return undefined;
		}
		this.resolveKeyWarningShown = false;
		server.env = { ...server.env, [ZAI_API_KEY_ENV]: apiKey };
		return server;
	}

	/** Prompt with the vision setup wording, then return the (maybe) stored key. */
	private async promptForVisionApiKey(): Promise<string | undefined> {
		await this.authManager.promptForApiKey({
			title: t('visionMcp.auth.title'),
			prompt: t('visionMcp.auth.prompt'),
		});
		return this.authManager.getApiKey();
	}

	private async ensureApiKey(): Promise<boolean> {
		let apiKey = await this.authManager.getApiKey();
		while (!apiKey) {
			apiKey = await this.promptForVisionApiKey();
			if (!apiKey) {
				const choice = await vscode.window.showWarningMessage(
					t('visionMcp.auth.required'),
					t('visionMcp.auth.enterKey'),
					t('visionMcp.notNow'),
				);
				if (choice !== t('visionMcp.auth.enterKey')) {
					return false;
				}
			}
		}
		return true;
	}

	private async confirmInstallRisk(): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(
			t('visionMcp.install.consent'),
			{
				modal: true,
				detail: t('visionMcp.install.consentDetail', VISION_MCP_PACKAGE),
			},
			t('visionMcp.install.confirm'),
			t('visionMcp.install.viewPackage'),
		);
		if (choice === t('visionMcp.install.viewPackage')) {
			void vscode.env.openExternal(vscode.Uri.parse(EXTERNAL_URLS.visionMcpPackage));
			return false;
		}
		return choice === t('visionMcp.install.confirm');
	}

	private async confirmNodeRuntime(): Promise<boolean> {
		const probe = await this.probeRuntime();
		const tooOld = probe.nodeMajor !== undefined && probe.nodeMajor < VISION_NODE_MIN_MAJOR;
		if (probe.npmOk && !tooOld) {
			return true;
		}
		const message = probe.npmOk
			? t('visionMcp.runtime.tooOld', String(probe.nodeMajor), String(VISION_NODE_MIN_MAJOR))
			: t('visionMcp.runtime.missing');
		const choice = await vscode.window.showWarningMessage(
			message,
			t('visionMcp.runtime.requirements'),
			t('visionMcp.cancel'),
		);
		if (choice === t('visionMcp.runtime.requirements')) {
			void vscode.env.openExternal(vscode.Uri.parse(EXTERNAL_URLS.visionMcpDocs));
		}
		return false;
	}

	private refreshHealth(): void {
		const found = this.isInstalled && findVisionAnalyzeTool() !== undefined;
		if (found === this.healthy) {
			return;
		}
		this.healthy = found;
		void vscode.commands.executeCommand('setContext', VISION_MCP_CTX_HEALTHY, found);
		if (found) {
			this.unhealthyNoticeShown = false;
			if (!this.readyPromptShown) {
				this.readyPromptShown = true;
				void this.promptEnableVision();
			}
		} else if (this.isInstalled && getVisionEnabled() && !this.unhealthyNoticeShown) {
			this.unhealthyNoticeShown = true;
			void vscode.window.showWarningMessage(t('visionMcp.unhealthy'));
		}
		this.didChangeState.fire();
	}

	private async promptEnableVision(): Promise<void> {
		if (getVisionEnabled()) {
			return;
		}
		const choice = await vscode.window.showInformationMessage(
			t('visionMcp.ready'),
			t('visionMcp.ready.enable'),
			t('visionMcp.notNow'),
		);
		if (choice === t('visionMcp.ready.enable')) {
			await this.toggleVision();
		}
	}

	/** Region/key changes only take effect on server (re)start — re-publish and nudge. */
	private onServerConfigChanged(kind: 'region' | 'apiKey'): void {
		if (!this.isInstalled) {
			return;
		}
		this.didChangeDefinitions.fire();
		if (this.restartPromptOpen) {
			return;
		}
		this.restartPromptOpen = true;
		const message = t(kind === 'region' ? 'visionMcp.restart.region' : 'visionMcp.restart.apiKey');
		void vscode.window
			.showInformationMessage(message, t('visionMcp.openServers'))
			.then((choice) => {
				this.restartPromptOpen = false;
				if (choice === t('visionMcp.openServers')) {
					void vscode.commands.executeCommand('workbench.mcp.listServers');
				}
			});
	}

	private async deleteTempImages(): Promise<void> {
		const dir = vscode.Uri.file(getVisionTempDir(this.context.globalStorageUri.fsPath));
		try {
			await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
		} catch (error) {
			logger.warn('Failed to delete GLM Vision temp images', error);
		}
	}
}
