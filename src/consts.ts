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

/**
 * Host roots for the usage + balance APIs. Both stations expose the same paths
 * (USAGE_PATHS + BALANCE_PATHS) and JSON shapes; only the host differs.
 *
 * Auth scheme: the China (open.bigmodel.cn) monitor endpoint uses the RAW API key
 * (no `Bearer` prefix); z.ai and all balance endpoints use `Bearer {key}`.
 * Handled in `UsageClient.authHeader` via host detection.
 */
export const USAGE_HOSTS = {
	international: 'https://api.z.ai',
	china: 'https://open.bigmodel.cn',
} as const;

/** Paths for the Coding Plan usage API (subscription + quota). Both stations use the same paths. */
export const USAGE_PATHS = {
	subscription: '/api/biz/subscription/list',
	quota: '/api/monitor/usage/quota/limit',
} as const;

/**
 * Paths for the Standard API balance query. Both stations expose the same endpoints
 * and JSON shapes. Coding Plan uses USAGE_PATHS; Standard API uses BALANCE_PATHS.
 */
export const BALANCE_PATHS = {
	accountReport: '/api/biz/account/query-customer-account-report',
	tokenAccounts: '/api/biz/tokenAccounts/list/my',
} as const;

export const USAGE_MIN_REFRESH_MINUTES = 1;
export const USAGE_DEFAULT_REFRESH_MINUTES = 5;
export const USAGE_MAX_REFRESH_MINUTES = 1440;
export const USAGE_CACHE_STALE_MS = 60 * 60 * 1000;
export const USAGE_MANUAL_DEBOUNCE_MS = 30 * 1000;
export const USAGE_REQUEST_TIMEOUT_MS = 10_000;

// ---- Vision describer proxy ----

/** House GLM vision model used to describe image attachments for text-only models. */
export const DEFAULT_VISION_MODEL = 'glm-4.6v';

/**
 * Built-in describe prompt. English and out of i18n so the prompt shape (and the
 * resulting token estimate) does not change with the VS Code display language.
 */
export const DEFAULT_VISION_PROMPT = [
	'You are the eyes for a text-only coding assistant. It cannot see the attached image(s); your description is all it will have, so be precise and complete.',
	'',
	'If there is one image, describe it directly. If there are multiple images, describe each one in order (Image 1, Image 2, and so on), then explain how they relate to each other.',
	'',
	'Transcribe all visible text exactly as it appears — including code, terminal commands, log output, stack traces, and error messages — inside fenced code blocks, preserving line breaks and indentation. Describe UI layout and controls, diagrams, and charts in enough detail for the assistant to reason about them. Report only what is actually visible; do not guess, infer intent, or invent details that are not shown.',
].join('\n');

/** Output-token cap for a single describe call. */
export const VISION_DESCRIBE_MAX_TOKENS = 2048;

/** Image MIME types accepted by the describer (lowercase). */
export const VISION_ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Largest single image (bytes) the describer will encode and send. */
export const VISION_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Hot in-memory description cache bound (FIFO). */
export const VISION_CACHE_MEMORY_MAX = 32;

/** Persisted (globalState) description cache bound (FIFO). */
export const VISION_CACHE_PERSIST_MAX = 128;

/** globalState key holding the persisted description cache. */
export const VISION_CACHE_STATE_KEY = 'glm-copilot.visionDescriptionCache';

// ---- Vision MCP server (Part B) ----

/** Contribution id for the Z.AI Vision MCP server definition provider. */
export const VISION_MCP_PROVIDER_ID = 'glm-copilot.vision';

/** Display label for the registered MCP server. */
export const VISION_MCP_LABEL = 'GLM Vision';

/** npx target for the official Z.AI vision MCP server. */
export const VISION_MCP_PACKAGE = '@z_ai/mcp-server@latest';

/** Env var names + platform-mode values consumed by the Z.AI vision MCP server. */
export const ZAI_MODE_ENV = 'Z_AI_MODE';
export const ZAI_API_KEY_ENV = 'Z_AI_API_KEY';
export const ZAI_MODE_INTERNATIONAL = 'ZAI';
export const ZAI_MODE_CHINA = 'ZHIPU';

/** Default automatic retries (after the initial attempt) for transient GLM API failures (429 / 5xx). */
export const RETRY_DEFAULT_MAX_RETRIES = 3;
/** Highest value accepted from the `maxRetries` setting. */
export const RETRY_MAX_RETRIES_CEILING = 10;
/** Base delay (ms) for the first retry; doubles each attempt up to RETRY_MAX_DELAY_MS. */
export const RETRY_BASE_DELAY_MS = 1000;
/** Upper bound (ms) for a single backoff sleep, even when Retry-After is larger. */
export const RETRY_MAX_DELAY_MS = 10_000;

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
		detail: 'Legacy model',
		maxInputTokens: 200000,
		maxOutputTokens: 128000,
		capabilities: { toolCalling: DEFAULT_TOOLS_LIMIT, imageInput: true, thinking: true },
		availableIn: ['coding-plan', 'standard'],
	},
	{
		id: 'glm-5',
		name: 'GLM-5',
		family: 'glm',
		version: '5',
		detail: 'Legacy model',
		maxInputTokens: 200000,
		maxOutputTokens: 128000,
		capabilities: { toolCalling: DEFAULT_TOOLS_LIMIT, imageInput: true, thinking: true },
		availableIn: ['standard'],
	},
	{
		id: 'glm-5.1',
		name: 'GLM-5.1',
		family: 'glm',
		version: '5.1',
		detail: 'Legacy model',
		maxInputTokens: 200000,
		maxOutputTokens: 128000,
		capabilities: { toolCalling: DEFAULT_TOOLS_LIMIT, imageInput: true, thinking: true },
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
			imageInput: true,
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
		detail: 'Legacy model',
		maxInputTokens: 128000,
		maxOutputTokens: 96000,
		capabilities: { toolCalling: DEFAULT_TOOLS_LIMIT, imageInput: true, thinking: true },
		availableIn: ['coding-plan', 'standard'],
	},
];
