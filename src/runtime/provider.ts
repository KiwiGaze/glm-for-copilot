import * as vscode from 'vscode';
import { AuthManager } from '../auth';
import { UsageClient } from '../client/usage';
import { VENDOR_ID } from '../consts';
import { resolveUsageHost } from '../endpoint';
import { logger } from '../logger';
import { GLMChatProvider } from '../provider';
import { VisionMcpManager } from './mcp';
import { UsageStatusBar } from './usage-bar';

export async function registerProvider(context: vscode.ExtensionContext): Promise<GLMChatProvider> {
	const authManager = new AuthManager(context);
	const visionMcp = new VisionMcpManager(context, authManager);
	const provider = new GLMChatProvider(context, authManager, visionMcp);
	const usageClient = new UsageClient(resolveUsageHost);
	const usageBar = new UsageStatusBar(context, authManager, usageClient);
	context.subscriptions.push(
		vscode.commands.registerCommand('glm-copilot.setApiKey', () => provider.configureApiKey()),
		vscode.commands.registerCommand('glm-copilot.clearApiKey', () => provider.clearApiKey()),
		vscode.commands.registerCommand('glm-copilot.installVisionMcp', () => visionMcp.install()),
		vscode.commands.registerCommand('glm-copilot.uninstallVisionMcp', () => visionMcp.uninstall()),
		vscode.commands.registerCommand('glm-copilot.toggleVision', () => visionMcp.toggleVision()),
		vscode.lm.registerLanguageModelChatProvider(VENDOR_ID, provider),
		usageBar,
		visionMcp,
	);
	visionMcp.initialize();
	await activateCopilotChat();
	provider.refreshModelPicker();
	return provider;
}

async function activateCopilotChat(): Promise<void> {
	try {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
	} catch (error) {
		logger.warn('Copilot Chat activation unavailable; model picker refresh may be delayed', error);
	}
}
