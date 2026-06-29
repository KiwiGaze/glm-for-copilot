import * as vscode from 'vscode';
import { listProviderModels } from '../config';
import { API_KEY_SECRET, VENDOR_ID } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import type { IAuthManager } from '../types';
import { toChatInfo } from './models';
import { prepareChatRequest } from './request';
import { streamChatCompletion } from './stream';
import { estimateTokenCount } from './tokens';

/**
 * GLM Chat Provider — implements `vscode.LanguageModelChatProvider` so GLM
 * models appear directly in the Copilot Chat model picker.
 */
export class GLMChatProvider implements vscode.LanguageModelChatProvider {
	private readonly onDidChangeLanguageModelChatInformationEmitter =
		new vscode.EventEmitter<void>();

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	/**
	 * Adaptive chars-per-token ratio, calibrated from real usage data via an
	 * exponential moving average each time the API reports token counts.
	 */
	private charsPerToken = 4.0;

	private isActive = true;

	private readonly extensionVersion: string;

	constructor(
		context: vscode.ExtensionContext,
		private readonly authManager: IAuthManager,
	) {
		this.extensionVersion = context.extension.packageJSON.version as string;
		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (
					e.affectsConfiguration('glm-copilot.apiKey') ||
					e.affectsConfiguration('glm-copilot.baseUrl') ||
					e.affectsConfiguration('glm-copilot.apiMode') ||
					e.affectsConfiguration('glm-copilot.region') ||
					e.affectsConfiguration('glm-copilot.customModels')
				) {
					this.refreshModelPicker();
				}
			}),
			context.secrets.onDidChange((e) => {
				if (e.key === API_KEY_SECRET) {
					this.refreshModelPicker();
				}
			}),
		);
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		if (!this.isActive) {
			return [];
		}
		const hasKey = await this.authManager.hasApiKey();
		return listProviderModels().map((model) => toChatInfo(model, hasKey));
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const prepared = await prepareChatRequest({
			authManager: this.authManager,
			extensionVersion: this.extensionVersion,
			modelInfo: model,
			messages,
			options,
			token,
		});
		await streamChatCompletion({
			prepared,
			progress,
			token,
			getCharsPerToken: () => this.charsPerToken,
			setCharsPerToken: (value) => {
				this.charsPerToken = value;
			},
		});
	}

	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		return estimateTokenCount(text, this.charsPerToken);
	}

	async hasApiKey(): Promise<boolean> {
		return this.authManager.hasApiKey();
	}

	async configureApiKey(): Promise<void> {
		const saved = await this.authManager.promptForApiKey();
		if (saved) {
			this.refreshModelPicker();
		}
	}

	async clearApiKey(): Promise<void> {
		await this.authManager.deleteApiKey();
		this.refreshModelPicker();
		vscode.window.showInformationMessage(t('auth.removed'));
	}

	/** Force Copilot Chat to re-query model information. */
	refreshModelPicker(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	async prepareForDeactivate(): Promise<void> {
		this.isActive = false;
		this.refreshModelPicker();
		try {
			await vscode.lm.selectChatModels({ vendor: VENDOR_ID });
		} catch (error) {
			logger.warn('Failed to refresh GLM models during deactivate', error);
		}
	}
}
