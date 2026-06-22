import * as vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import { GLMChatProvider } from '../provider';
import { registerActionUrls } from './actions';
import { registerCommands } from './commands';
import { registerProvider } from './provider';
import { showWelcomeIfNeeded } from './welcome';

let activeProvider: GLMChatProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	try {
		logger.info('Activating GLM Models for GitHub Copilot Chat');
		registerCommands(context);
		registerActionUrls(context);
		activeProvider = await registerProvider(context);
		void showWelcomeIfNeeded(context, activeProvider).catch((err) =>
			logger.warn('Failed to show welcome', err),
		);
		logger.info('Extension activated');
	} catch (err) {
		logger.error('Activation failed', err);
		vscode.window.showErrorMessage(t('extension.activateFailed'));
	}
}

export async function deactivate(): Promise<void> {
	try {
		await activeProvider?.prepareForDeactivate();
	} catch (err) {
		logger.warn('Failed to prepare for deactivate', err);
	}
	activeProvider = undefined;
	logger.dispose();
}
