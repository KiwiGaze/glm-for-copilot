import * as vscode from 'vscode';
import { getSettingsApiKey } from './config';
import { API_KEY_SECRET, VISION_API_KEY_SECRET } from './consts';
import { t } from './i18n';
import type { ApiKeyPromptOptions, IAuthManager, IVisionApiKeyManager } from './types';

/**
 * Manages the chat and dedicated Vision API keys in VS Code SecretStorage.
 * Only the chat key falls back to the extension setting for CI or automation.
 */
export class AuthManager implements IAuthManager, IVisionApiKeyManager {
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

	async getVisionApiKey(): Promise<string | undefined> {
		return this.context.secrets.get(VISION_API_KEY_SECRET);
	}

	async promptForVisionApiKey(options?: ApiKeyPromptOptions): Promise<boolean> {
		return this.promptAndStoreApiKey(
			VISION_API_KEY_SECRET,
			t('visionMcp.auth.saved'),
			options,
		);
	}

	async deleteVisionApiKey(): Promise<void> {
		await this.context.secrets.delete(VISION_API_KEY_SECRET);
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
