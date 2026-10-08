import * as vscode from 'vscode';
import { AuthManager } from '../auth';
import { UsageClient } from '../client/usage';
import { CONFIG_SECTION, VENDOR_ID } from '../consts';
import { resolveUsageHost } from '../endpoint';
import { logger } from '../logger';
import { GLMChatProvider } from '../provider';
import { UsageStatusBar } from './usage-bar';
import { ModelPreferences } from './model-preferences';

export async function registerProvider(context: vscode.ExtensionContext): Promise<GLMChatProvider> {
	const preferences = new ModelPreferences(context);
	try {
		await preferences.initialize();
	} catch (error) {
		logger.warn('Could not initialize model preferences', error);
	}
	const authManager = new AuthManager(context);
	const provider = new GLMChatProvider(context, authManager);
	const usageClient = new UsageClient(resolveUsageHost);
	const usageBar = new UsageStatusBar(context, authManager, usageClient);
	context.subscriptions.push(
		vscode.commands.registerCommand('glm-copilot.setApiKey', async () => {
			if (await provider.configureApiKey()) {
				await preferences.showRecommendation();
			}
		}),
		vscode.commands.registerCommand('glm-copilot.clearApiKey', () => provider.clearApiKey()),
		vscode.commands.registerCommand('glm-copilot.openVisionPromptSettings', () =>
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				`${CONFIG_SECTION}.visionPrompt`,
			),
		),
		vscode.lm.registerLanguageModelChatProvider(VENDOR_ID, provider),
		usageBar,
	);
	await activateCopilotChat();
	provider.refreshModelPicker();
	if (await authManager.hasApiKey()) {
		void preferences.showRecommendation().catch((error) => logger.warn('Could not show model recommendation', error));
	}
	return provider;
}

async function activateCopilotChat(): Promise<void> {
	try {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
	} catch (error) {
		logger.warn('Copilot Chat activation unavailable; model picker refresh may be delayed', error);
	}
}
