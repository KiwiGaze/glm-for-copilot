import type * as vscode from 'vscode';

export type ThinkingMode = 'enabled' | 'disabled';
export type ApiMode = 'coding-plan' | 'standard';
export type Region = 'international' | 'china';

export type ThinkingEffort = 'none' | 'high' | 'max';

export interface ThinkingEffortSpec {
	/** Levels shown in the picker, in order. */
	levels: ThinkingEffort[];
	/** Level used when the user has not chosen one. */
	default: ThinkingEffort;
}

export interface GLMModelCapabilities {
	/** `true` enables tool calling with the default cap; a number sets a custom cap. */
	toolCalling: number | boolean;
	imageInput: boolean;
	thinking: boolean;
	/** Present ⇒ model supports thinking-effort selection. Absent ⇒ binary thinking only. */
	thinkingEffort?: ThinkingEffortSpec;
}

/** A GLM model exposed in the Copilot Chat picker. */
export interface GLMModel {
	id: string;
	name: string;
	family: string;
	version: string;
	detail: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	capabilities: GLMModelCapabilities;
	/** API modes that expose this model. The picker filters built-ins by the active mode. */
	availableIn: ApiMode[];
}

/** A user-defined model from the `customModels` setting (string id or object). */
export interface CustomModelConfig {
	id: string;
	name?: string;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	toolCalling?: boolean;
	vision?: boolean;
	thinking?: boolean;
}

// ---- Usage tracking (z.ai Coding Plan quota) ----

export type UsageMetricKind = 'session' | 'weekly' | 'web-searches';

export interface UsageMetric {
	kind: UsageMetricKind;
	/** Percentage (0-100) for session/weekly; count used for web-searches. */
	used: number;
	/** 100 for session/weekly; monthly total for web-searches. */
	limit: number;
	/** Epoch-ms when the window resets. */
	resetsAt?: number;
}

export type UsageStatus =
	| 'ok'
	| 'no-data'
	| 'auth-error'
	| 'network-error'
	| 'server-error'
	| 'loading';

export interface UsageSnapshot {
	status: UsageStatus;
	planName?: string;
	/** ISO date string from the subscription response. */
	renewsAt?: string;
	/** 0..3 metrics, ordered session, weekly, web-searches. */
	metrics: UsageMetric[];
	/** Epoch-ms of the fetch that produced this snapshot. */
	fetchedAt: number;
}

// ---- OpenAI-compatible wire types ----

export interface GLMToolFunction {
	name: string;
	description?: string;
	parameters?: unknown;
}

export interface GLMTool {
	type: 'function';
	function: GLMToolFunction;
}

export interface GLMToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

export interface GLMMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_calls?: GLMToolCall[];
	tool_call_id?: string;
	reasoning_content?: string;
}

export interface GLMChatRequest {
	model: string;
	messages: GLMMessage[];
	stream: boolean;
	tools?: GLMTool[];
	tool_choice?: 'auto' | 'none';
	max_tokens?: number;
	thinking?: { type: ThinkingMode };
	reasoning_effort?: Exclude<ThinkingEffort, 'none'>;
	stream_options?: { include_usage: boolean };
}

export interface GLMUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number };
}

// ---- Streaming delta shapes ----

export interface GLMDeltaToolCall {
	index: number;
	id?: string;
	type?: 'function';
	function?: { name?: string; arguments?: string };
}

export interface GLMDelta {
	content?: string;
	reasoning_content?: string;
	tool_calls?: GLMDeltaToolCall[];
}

export interface GLMChoice {
	delta?: GLMDelta;
	finish_reason?: string | null;
}

export interface GLMStreamChunk {
	choices?: GLMChoice[];
	usage?: GLMUsage;
}

// ---- Callback + collaborator contracts ----

export interface StreamCallbacks {
	onContent: (content: string) => void;
	onThinking: (text: string) => void;
	onToolCall: (toolCall: GLMToolCall) => void;
	onUsage?: (usage: GLMUsage) => void;
	onDone: () => void;
	onError: (error: unknown) => void;
}

/** Streaming GLM chat client. Implemented by `client/core.ts`. */
export interface IGLMClient {
	streamChatCompletion(
		request: GLMChatRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: vscode.CancellationToken,
	): Promise<void>;
}

/** API-key manager. Implemented by `auth.ts`. */
export interface IAuthManager {
	getApiKey(): Promise<string | undefined>;
	hasApiKey(): Promise<boolean>;
	promptForApiKey(): Promise<boolean>;
	deleteApiKey(): Promise<void>;
}
