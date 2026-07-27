import * as vscode from 'vscode';
import { listProviderModels } from '../config';
import { API_KEY_SECRET, VENDOR_ID } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import type { IAuthManager, IVisionMcpState } from '../types';
import { toChatInfo } from './models';
import { prepareChatRequest } from './request';
import { streamChatCompletion } from './stream';
import { estimateTokenCount } from './tokens';
import { resolveVisionMessages, VisionDescriptionCache } from './vision';

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

	private readonly visionCache: VisionDescriptionCache;

	private readonly visionStorageDir: string;

	constructor(
		context: vscode.ExtensionContext,
		private readonly authManager: IAuthManager,
		private readonly visionState: IVisionMcpState,
	) {
		this.extensionVersion = context.extension.packageJSON.version as string;
		this.visionCache = new VisionDescriptionCache(context.globalState);
		this.visionStorageDir = context.globalStorageUri.fsPath;
		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (
					e.affectsConfiguration('glm-copilot.apiKey') ||
					e.affectsConfiguration('glm-copilot.baseUrl') ||
					e.affectsConfiguration('glm-copilot.apiMode') ||
					e.affectsConfiguration('glm-copilot.region') ||
					e.affectsConfiguration('glm-copilot.customModels') ||
					e.affectsConfiguration('glm-copilot.visionEnabled')
				) {
					this.refreshModelPicker();
				}
			}),
			context.secrets.onDidChange((e) => {
				if (e.key === API_KEY_SECRET) {
					this.refreshModelPicker();
				}
			}),
			visionState.onDidChangeState(() => this.refreshModelPicker()),
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
		const visionActive = this.visionState.isVisionActive();
		return listProviderModels().map((model) => toChatInfo(model, hasKey, visionActive));
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		// Always run vision resolution: without images it is a cheap no-op, and
		// with images it degrades to an explicit marker + notice instead of
		// silently dropping them when the server is down or vision is off.
		let vision;
		try {
			vision = await resolveVisionMessages(
				{
					authManager: this.authManager,
					cache: this.visionCache,
					storageDir: this.visionStorageDir,
				},
				messages,
				progress,
				token,
			);
		} catch (error) {
			if (error instanceof vscode.CancellationError || token.isCancellationRequested) {
				return;
			}
			throw error;
		}
		if (token.isCancellationRequested) {
			return;
		}
		if (vision.failureNotice) {
			progress.report(new vscode.LanguageModelTextPart(vision.failureNotice));
		}
		const prepared = await prepareChatRequest({
			authManager: this.authManager,
			extensionVersion: this.extensionVersion,
			modelInfo: model,
			messages: vision.messages,
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
