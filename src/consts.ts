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
	visionMcpDocs: 'https://docs.z.ai/devpack/mcp/vision-mcp-server',
	visionMcpPackage: 'https://www.npmjs.com/package/@z_ai/mcp-server/v/0.1.4',
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

// ---- Vision (GLM Vision MCP server) ----

/**
 * Built-in analysis prompt sent as the `prompt` argument of the vision MCP
 * `analyze_image` tool (one call per image). English and out of i18n so the
 * prompt shape does not change with the VS Code display language.
 */
export const DEFAULT_VISION_PROMPT = [
	'You are the eyes for a text-only coding assistant. It cannot see the attached image; your description is all it will have, so be precise and complete.',
	'',
	'Transcribe all visible text exactly as it appears — including code, terminal commands, log output, stack traces, and error messages — inside fenced code blocks, preserving line breaks and indentation. Describe UI layout and controls, diagrams, and charts in enough detail for the assistant to reason about them. Report only what is actually visible; do not guess, infer intent, or invent details that are not shown.',
].join('\n');

/**
 * Image MIME types accepted by the vision pipeline (lowercase), mapped to the
 * file extension used for the temp files handed to the MCP tool. Limited to
 * what `@z_ai/mcp-server` accepts for local paths (`.jpg`/`.jpeg`/`.png`).
 */
export const VISION_IMAGE_MIME_EXTENSIONS: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
};

/** Largest single image (bytes) accepted — the vision MCP server rejects images over 5 MB. */
export const VISION_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Largest image count per analyzed container. Images of one container are
 * written to disk and analyzed concurrently, so this also bounds peak temp
 * disk usage and parallel `analyze_image` calls per run.
 */
export const VISION_MAX_IMAGES_PER_CONTAINER = 16;

/** Session (memory-only) description cache bound (FIFO). */
export const VISION_CACHE_MAX = 128;

/** Contribution id for the Z.AI Vision MCP server definition provider. */
export const VISION_MCP_PROVIDER_ID = 'glm-copilot.vision';

/** Display label for the registered MCP server (proper noun — intentionally not localized). */
export const VISION_MCP_LABEL = 'GLM Vision';

/** Exact official Z.AI Vision MCP package pinned by the bundled npm lockfile. */
export const VISION_MCP_PACKAGE_NAME = '@z_ai/mcp-server';
export const VISION_MCP_PACKAGE_VERSION = '0.1.4';
export const VISION_MCP_PACKAGE = `${VISION_MCP_PACKAGE_NAME}@${VISION_MCP_PACKAGE_VERSION}`;

/** Local, integrity-locked MCP installation under the extension's global storage. */
export const VISION_MCP_INSTALL_DIR_NAME = 'vision-mcp';
export const VISION_MCP_ENTRYPOINT_PARTS = [
	'node_modules',
	'@z_ai',
	'mcp-server',
	'build',
	'index.js',
] as const;

/** Env var names + platform-mode values consumed by the Z.AI vision MCP server. */
export const ZAI_MODE_ENV = 'Z_AI_MODE';
export const ZAI_API_KEY_ENV = 'Z_AI_API_KEY';
export const ZAI_MODE_INTERNATIONAL = 'ZAI';
export const ZAI_MODE_CHINA = 'ZHIPU';

/** globalState key recording that the user explicitly installed GLM Vision. */
export const VISION_MCP_INSTALLED_KEY = 'glm-copilot.visionMcp.installed';

/** `setContext` keys gating vision commands and walkthrough steps in the UI. */
export const VISION_MCP_CTX_INSTALLED = 'glmCopilot.visionMcp.installed';
export const VISION_MCP_CTX_HEALTHY = 'glmCopilot.visionMcp.healthy';

/** `setContext` key mirroring the `visionEnabled` setting, for walkthrough completion. */
export const VISION_MCP_CTX_VISION_ENABLED = 'glmCopilot.visionEnabled';

/** Name suffix of the vision analyze tool (VS Code prefixes MCP tool names). */
export const VISION_ANALYZE_TOOL_SUFFIX = 'analyze_image';

/**
 * Known GLM Vision tool names as they appear in VS Code tool names. The
 * official server reports `zai-mcp-server`; the extension definition label is
 * `GLM Vision`. The `analyze_image` suffix is anchored to the server prefix so
 * a look-alike server (`mcp_glm_vision_evil_analyze_image`) is never treated
 * as GLM Vision.
 */
export const VISION_ANALYZE_TOOL_SERVER_PATTERN =
	/^(?:(?:mcp[_-])?glm[\s_-]vision|mcp[_-]zai[_-]mcp[_-]server)[:\s_-]+analyze_image$/;

/** Minimum Node.js major version required by the vision MCP server. */
export const VISION_NODE_MIN_MAJOR = 18;

/** Interval for re-checking whether the vision analyze tool is available. */
export const VISION_HEALTH_POLL_MS = 15_000;

/** Directory (under globalStorage) holding temp image files handed to the MCP tool. */
export const VISION_TEMP_DIR_NAME = 'vision-tmp';

/** Upper bound on leftover vision temp dir entries; analysis runs delete their own files on settle. */
export const VISION_TEMP_MAX_FILES = 256;

/** Per-analysis timeout when invoking the vision MCP tool. */
export const VISION_INVOKE_TIMEOUT_MS = 120_000;

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
		capabilities: { toolCalling: DEFAULT_TOOLS_LIMIT, thinking: true },
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
		capabilities: { toolCalling: DEFAULT_TOOLS_LIMIT, thinking: true },
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
		capabilities: { toolCalling: DEFAULT_TOOLS_LIMIT, thinking: true },
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
		capabilities: { toolCalling: DEFAULT_TOOLS_LIMIT, thinking: true },
		availableIn: ['coding-plan', 'standard'],
	},
];
