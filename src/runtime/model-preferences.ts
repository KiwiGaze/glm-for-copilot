import * as vscode from 'vscode';
import { getRecommendedModel } from '../config';
import { CONFIG_SECTION, RECOMMENDED_MODEL_IDS, VENDOR_ID, WELCOME_SHOWN_KEY } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';

const MIGRATION_KEY = 'glm-copilot.modelPreferences.v1';
const OWNED_DEFAULT_KEY = 'glm-copilot.managedDefault.v1';

function isHostManaged(config: vscode.WorkspaceConfiguration): boolean {
	const setting = config.inspect<string>('defaultModel');
	return setting?.defaultValue !== `${VENDOR_ID}/${RECOMMENDED_MODEL_IDS['coding-plan']}` || config.get<string>('defaultModel') !== (
		setting?.workspaceFolderValue ?? setting?.workspaceValue ?? setting?.globalValue ?? setting?.defaultValue
	);
}

/** Coordinates settings only. The host owns each conversation's selected model. */
export class ModelPreferences {
	private pending = Promise.resolve();

	constructor(private readonly context: vscode.ExtensionContext) {}

	async initialize(): Promise<void> {
		this.context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('chat.defaultModel') || ['apiMode', 'baseUrl', 'customModels'].some((key) =>
					event.affectsConfiguration(`${CONFIG_SECTION}.${key}`))) {
					void this.synchronize().catch((error) => logger.warn('Could not update recommended model', error));
				}
			}),
			vscode.commands.registerCommand('glm-copilot.useRecommendedModel', () => this.useRecommended()),
		);
		if (!this.context.globalState.get<boolean>(MIGRATION_KEY)) {
			const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
			const setting = config.inspect<boolean>('showLegacyModels');
			if (this.context.globalState.get<boolean>(WELCOME_SHOWN_KEY)
				&& setting?.globalValue === undefined
				&& setting?.workspaceValue === undefined
				&& setting?.workspaceFolderValue === undefined) {
				await config.update('showLegacyModels', true, vscode.ConfigurationTarget.Global);
			}
			await this.context.globalState.update(MIGRATION_KEY, true);
		}
		await this.synchronize();
	}

	private scope() {
		return vscode.workspace.workspaceFolders?.length
			? { target: vscode.ConfigurationTarget.Workspace, state: this.context.workspaceState }
			: { target: vscode.ConfigurationTarget.Global, state: this.context.globalState };
	}

	private enqueue(action: () => Promise<void>): Promise<void> {
		const next = this.pending.then(action);
		this.pending = next.catch(() => {});
		return next;
	}

	synchronize(): Promise<void> {
		return this.enqueue(async () => {
			const model = getRecommendedModel();
			if (!model) {
				return;
			}
			const config = vscode.workspace.getConfiguration('chat');
			const setting = config.inspect<string>('defaultModel');
			if (!setting || isHostManaged(config)) {
				return;
			}
			const { target, state } = this.scope();
			const owned = state.get<string>(OWNED_DEFAULT_KEY);
			const scoped = target === vscode.ConfigurationTarget.Workspace ? setting.workspaceValue : setting.globalValue;
			const explicit = setting.workspaceFolderValue ?? setting.workspaceValue ?? setting.globalValue;
			const inheritedOwned = scoped === undefined
				&& explicit !== undefined && explicit === this.context.globalState.get<string>(OWNED_DEFAULT_KEY);
			if (explicit !== undefined && !inheritedOwned && !(owned !== undefined && scoped === owned && explicit === owned)) {
				await state.update(OWNED_DEFAULT_KEY, undefined);
				return;
			}
			const value = `${VENDOR_ID}/${model.id}`;
			if (config.get<string>('defaultModel') !== value) {
				await config.update('defaultModel', value, target);
				await state.update(OWNED_DEFAULT_KEY, value);
			}
		});
	}

	async showRecommendation(): Promise<void> {
		const model = getRecommendedModel();
		if (!model) {
			return;
		}
		const key = `glm-copilot.recommendationShown.${model.id}`;
		if (this.context.workspaceState.get<boolean>(key)) {
			return;
		}
		await this.context.workspaceState.update(key, true);
		const action = await vscode.window.showInformationMessage(
			t('models.recommendation', model.name), t('models.useRecommended'), t('models.settings'),
		);
		if (action === t('models.useRecommended')) {
			await this.useRecommended();
		} else if (action === t('models.settings')) {
			await vscode.commands.executeCommand('workbench.action.openSettings', `${CONFIG_SECTION}.showLegacyModels`);
		}
	}

	private useRecommended(): Promise<void> {
		return this.enqueue(async () => {
			const model = getRecommendedModel();
			if (!model) {
				void vscode.window.showInformationMessage(t('models.customEndpoint'));
				return;
			}
			const config = vscode.workspace.getConfiguration('chat');
			const { target, state } = this.scope();
			const value = `${VENDOR_ID}/${model.id}`;
			try {
				await config.update('defaultModel', value, target);
			} catch (error) {
				logger.warn('Could not save recommended default', error);
				void vscode.window.showInformationMessage(t('models.defaultFailed'));
				return;
			}
			await state.update(OWNED_DEFAULT_KEY, value);
			void vscode.window.showInformationMessage(t(
				config.get<string>('defaultModel') === value ? 'models.defaultSaved' : 'models.defaultOverridden',
				model.name,
			));
		});
	}
}
