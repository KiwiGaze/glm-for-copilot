import type { GLMModel, ThinkingEffortSpec } from './types';

/**
 * Compile-time constants shared across the extension. These do not depend on
 * the VS Code runtime. For run-time settings reads see `config.ts`.
 */

/** VS Code configuration section prefix for all extension settings. */
export const CONFIG_SECTION = 'glm-copilot';

/** Provider vendor id, must match `contributes.languageModelChatProviders`. */
export const VENDOR_ID = 'glm';

/** SecretStorage key for the GLM API key. */
export const API_KEY_SECRET = 'glm-copilot.apiKey';

/** Memento key tracking whether the welcome walkthrough has been shown. */
export const WELCOME_SHOWN_KEY = 'glm-copilot.welcomeShown';

/** Walkthrough contribution id (without the publisher.extension prefix). */
export const WALKTHROUGH_ID = 'glmGettingStarted';

/** VS Code's internal LanguageModelChatMessageRole.System (not in @types/vscode). */
export const LANGUAGE_MODEL_CHAT_SYSTEM_ROLE = 3;

/** Default maximum number of tools accepted in one request. */
export const DEFAULT_TOOLS_LIMIT = 128;

/** Base hostnames + endpoint paths for each API mode × region. */
export const ENDPOINTS = {
	codingPlanInternational: 'https://api.z.ai/api/coding/paas/v4',
	codingPlanChina: 'https://open.bigmodel.cn/api/coding/paas/v4',
	standardInternational: 'https://api.z.ai/api/paas/v4',
	standardChina: 'https://open.bigmodel.cn/api/paas/v4',
} as const;

/** External URLs the extension links to. */
export const EXTERNAL_URLS = {
	codingPlanKeysInternational: 'https://z.ai/manage-apikey/subscription',
	codingPlanKeysChina: 'https://bigmodel.cn/coding-plan/personal/overview',
	standardKeysInternational: 'https://z.ai/manage-apikey/apikey-list',
	standardKeysChina: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
	docs: 'https://docs.z.ai',
} as const;

/** URI paths handled by this extension (onUri activation). */
export const URI_PATHS = {
	setApiKey: '/setApiKey',
	showLogs: '/showLogs',
} as const;

const GLM_5_2_EFFORT: ThinkingEffortSpec = { levels: ['none', 'high', 'max'], default: 'high' };

/** Built-in GLM models exposed through the language model provider. */
export const MODELS: GLMModel[] = [
	{
		id: 'glm-4.7',
		name: 'GLM-4.7',
		family: 'glm',
		version: '4.7',
		detail: 'Flagship model for coding and agentic tasks',
		maxInputTokens: 200000,
		maxOutputTokens: 128000,
		capabilities: { toolCalling: DEFAULT_TOOLS_LIMIT, imageInput: false, thinking: true },
		availableIn: ['coding-plan', 'standard'],
	},
	{
		id: 'glm-5',
		name: 'GLM-5',
		family: 'glm',
		version: '5',
		detail: 'Next-generation flagship',
		maxInputTokens: 200000,
		maxOutputTokens: 128000,
		capabilities: { toolCalling: DEFAULT_TOOLS_LIMIT, imageInput: false, thinking: true },
		availableIn: ['standard'],
	},
	{
		id: 'glm-5.1',
		name: 'GLM-5.1',
		family: 'glm',
		version: '5.1',
		detail: 'Latest GLM-5 series flagship',
		maxInputTokens: 200000,
		maxOutputTokens: 128000,
		capabilities: { toolCalling: DEFAULT_TOOLS_LIMIT, imageInput: false, thinking: true },
		availableIn: ['standard'],
	},
	{
		id: 'glm-5.2',
		name: 'GLM-5.2',
		family: 'glm',
		version: '5.2',
		detail: 'Flagship coding model, 1M context',
		maxInputTokens: 1000000,
		maxOutputTokens: 128000,
		capabilities: {
			toolCalling: DEFAULT_TOOLS_LIMIT,
			imageInput: false,
			thinking: true,
			thinkingEffort: GLM_5_2_EFFORT,
		},
		availableIn: ['coding-plan', 'standard'],
	},
	{
		id: 'glm-4.5-air',
		name: 'GLM-4.5 Air',
		family: 'glm',
		version: '4.5',
		detail: 'Fast and economical',
		maxInputTokens: 128000,
		maxOutputTokens: 96000,
		capabilities: { toolCalling: DEFAULT_TOOLS_LIMIT, imageInput: false, thinking: true },
		availableIn: ['coding-plan', 'standard'],
	},
];
