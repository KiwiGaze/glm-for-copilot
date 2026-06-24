import * as vscode from 'vscode';
import { CONFIG_SECTION, DEFAULT_TOOLS_LIMIT, MODELS, USAGE_DEFAULT_REFRESH_MINUTES, USAGE_MIN_REFRESH_MINUTES } from './consts';
import { t } from './i18n';
import type { ApiMode, CustomModelConfig, GLMModel, Region, ThinkingMode } from './types';

function cfg(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

export function getApiMode(): ApiMode {
	return cfg().get<ApiMode>('apiMode', 'coding-plan');
}

export function getRegion(): Region {
	return cfg().get<Region>('region', 'international');
}

export function getBaseUrlOverride(): string {
	return (cfg().get<string>('baseUrl', '') ?? '').trim();
}

/** Output-token cap, or `undefined` when unset (use the API default). */
export function getMaxTokens(): number | undefined {
	const value = cfg().get<number>('maxTokens', 0);
	return value && value > 0 ? value : undefined;
}

export function getModelIdOverrides(): Record<string, string> {
	return cfg().get<Record<string, string>>('modelIdOverrides', {}) ?? {};
}

/** Resolve the API model id sent for a VS Code model id (override → id). */
export function getApiModelId(modelId: string): string {
	const override = getModelIdOverrides()[modelId];
	return override && override.trim() ? override.trim() : modelId;
}

export function getThinking(): ThinkingMode {
	return cfg().get<ThinkingMode>('thinking', 'enabled') === 'disabled' ? 'disabled' : 'enabled';
}

export function getDebugLogging(): boolean {
	return cfg().get<boolean>('debugLogging', false);
}

/** Settings-based fallback API key (less secure; for CI/automation). */
export function getSettingsApiKey(): string {
	return (cfg().get<string>('apiKey', '') ?? '').trim();
}

/** User-defined models from the `customModels` setting, normalized to GLMModel. */
export function getCustomModels(): GLMModel[] {
	const raw = cfg().get<Array<string | CustomModelConfig>>('customModels', []) ?? [];
	const models: GLMModel[] = [];
	for (const entry of raw) {
		const config: CustomModelConfig = typeof entry === 'string' ? { id: entry } : entry;
		const id = (config.id ?? '').trim();
		if (!id) {
			continue;
		}
		models.push({
			id,
			name: config.name?.trim() || id,
			family: 'glm',
			version: 'custom',
			detail: t('model.custom.detail'),
			maxInputTokens: config.maxInputTokens ?? 200000,
			maxOutputTokens: config.maxOutputTokens ?? 128000,
			capabilities: {
				toolCalling: config.toolCalling === false ? false : DEFAULT_TOOLS_LIMIT,
				imageInput: config.vision === true,
				thinking: config.thinking !== false,
			},
			availableIn: ['coding-plan', 'standard'],
		});
	}
	return models;
}

/**
 * Models to show in the picker: built-ins filtered by the active API mode
 * (unless a custom base URL is set), plus all custom models. Custom ids win.
 */
export function listProviderModels(): GLMModel[] {
	const customModels = getCustomModels();
	const customIds = new Set(customModels.map((model) => model.id));
	const useFilter = !getBaseUrlOverride();
	const apiMode = getApiMode();
	const builtins = MODELS.filter(
		(model) => !customIds.has(model.id) && (!useFilter || model.availableIn.includes(apiMode)),
	);
	return [...builtins, ...customModels];
}

/** Find a model definition by id, searching custom models then built-ins. */
export function findModelDefinition(id: string): GLMModel | undefined {
	return getCustomModels().find((model) => model.id === id) ?? MODELS.find((model) => model.id === id);
}

/** Status-bar usage refresh interval in minutes (clamped to the minimum). */
export function getUsageRefreshIntervalMinutes(): number {
	const value = cfg().get<number>('usageRefreshIntervalMinutes', USAGE_DEFAULT_REFRESH_MINUTES);
	return Math.max(USAGE_MIN_REFRESH_MINUTES, value);
}

/** Whether the usage status-bar item should be shown. */
export function getShowUsageStatusBar(): boolean {
	return cfg().get<boolean>('showUsageStatusBar', true);
}
