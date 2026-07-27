import * as vscode from 'vscode';
import { getRegion } from '../config';
import {
	CONFIG_SECTION,
	VISION_MCP_LABEL,
	VISION_MCP_PACKAGE,
	VISION_MCP_PROVIDER_ID,
	ZAI_API_KEY_ENV,
	ZAI_MODE_CHINA,
	ZAI_MODE_ENV,
	ZAI_MODE_INTERNATIONAL,
} from '../consts';
import { logger } from '../logger';
import type { IAuthManager, Region } from '../types';

/** Stdio launch spec for the official Z.AI vision MCP server (without the API key). */
export interface VisionMcpServerSpec {
	label: string;
	command: string;
	args: string[];
	env: Record<string, string>;
}

/**
 * Build the launch spec for `@z_ai/mcp-server`. `Z_AI_MODE` selects the platform
 * (`ZHIPU` for the China/BigModel region, `ZAI` otherwise). On Windows `npx` is a
 * `.cmd` shim, so it must be run through `cmd.exe /c`. Pure and testable — the
 * API key is injected later, only when the server is actually started.
 */
export function buildVisionMcpServerSpec(options: {
	region: Region;
	platform: NodeJS.Platform;
}): VisionMcpServerSpec {
	const mode = options.region === 'china' ? ZAI_MODE_CHINA : ZAI_MODE_INTERNATIONAL;
	const npxArgs = ['-y', VISION_MCP_PACKAGE];
	const isWindows = options.platform === 'win32';
	return {
		label: VISION_MCP_LABEL,
		command: isWindows ? 'cmd.exe' : 'npx',
		args: isWindows ? ['/c', 'npx', ...npxArgs] : npxArgs,
		env: { [ZAI_MODE_ENV]: mode },
	};
}

/**
 * Register the "GLM Vision" MCP server so it appears in VS Code's MCP list with
 * zero configuration. Definitions are re-fired when the region changes so
 * `Z_AI_MODE` stays correct. The API key is injected from SecretStorage only
 * when VS Code starts the server (in `resolveMcpServerDefinition`).
 */
export function registerVisionMcpServer(
	context: vscode.ExtensionContext,
	authManager: IAuthManager,
): void {
	const register = (
		vscode.lm as {
			registerMcpServerDefinitionProvider?: typeof vscode.lm.registerMcpServerDefinitionProvider;
		}
	).registerMcpServerDefinitionProvider;
	if (typeof register !== 'function') {
		logger.warn('MCP server definition provider API unavailable; skipping GLM Vision registration');
		return;
	}

	const didChange = new vscode.EventEmitter<void>();
	const provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> = {
		onDidChangeMcpServerDefinitions: didChange.event,
		provideMcpServerDefinitions: () => {
			const spec = buildVisionMcpServerSpec({ region: getRegion(), platform: process.platform });
			return [new vscode.McpStdioServerDefinition(spec.label, spec.command, spec.args, spec.env)];
		},
		resolveMcpServerDefinition: async (server) => {
			const apiKey = (await authManager.getApiKey()) ?? (await promptForApiKey(authManager));
			if (!apiKey) {
				return undefined;
			}
			server.env = { ...server.env, [ZAI_API_KEY_ENV]: apiKey };
			return server;
		},
	};

	context.subscriptions.push(
		didChange,
		register(VISION_MCP_PROVIDER_ID, provider),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(`${CONFIG_SECTION}.region`)) {
				didChange.fire();
			}
		}),
	);
}

async function promptForApiKey(authManager: IAuthManager): Promise<string | undefined> {
	const saved = await authManager.promptForApiKey();
	return saved ? authManager.getApiKey() : undefined;
}
