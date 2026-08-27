import * as vscode from 'vscode';
import { getSettingsApiKey } from './config';
import { API_KEY_SECRET } from './consts';
import { t } from './i18n';
import type { ApiKeyPromptOptions, IAuthManager } from './types';

/**
 * Manages the chat API key in VS Code SecretStorage, with a settings fallback
 * for CI and automation.
 */
export class AuthManager implements IAuthManager {
	constructor(private context: vscode.ExtensionContext) {}

	async getApiKey(): Promise<string | undefined> {
		return (await this.context.secrets.get(API_KEY_SECRET)) || (getSettingsApiKey() || undefined);
	}

	async hasApiKey(): Promise<boolean> {
		return !!(await this.getApiKey());
	}

	async promptForApiKey(options?: ApiKeyPromptOptions): Promise<boolean> {
		return this.promptAndStoreApiKey(API_KEY_SECRET, t('auth.saved'), options);
	}

	async deleteApiKey(): Promise<void> {
		await this.context.secrets.delete(API_KEY_SECRET);
	}

	private async promptAndStoreApiKey(
		secretKey: string,
		savedMessage: string,
		options?: ApiKeyPromptOptions,
	): Promise<boolean> {
		const value = await vscode.window.showInputBox({
			title: options?.title,
			prompt: options?.prompt ?? t('auth.prompt'),
			placeHolder: t('auth.placeholder'),
			password: true,
			ignoreFocusOut: true,
			validateInput: (v) => (v?.trim() ? undefined : t('auth.emptyValidation')),
		});
		if (value) {
			await this.context.secrets.store(secretKey, value.trim());
			vscode.window.showInformationMessage(savedMessage);
			return true;
		}
		return false;
	}
}
