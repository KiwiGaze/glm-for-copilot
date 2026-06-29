import * as vscode from 'vscode';
import { createUserFacingError } from '../client';
import { t } from '../i18n';
import { logger } from '../logger';
import type { GLMToolCall, GLMUsage, RetryBackoffInfo, StreamCallbacks } from '../types';
import type { PreparedChatRequest } from './request';

const USAGE_DATA_PART_MIME = 'usage';

interface StreamChatCompletionArgs {
	prepared: PreparedChatRequest;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	token: vscode.CancellationToken;
	getCharsPerToken: () => number;
	setCharsPerToken: (value: number) => void;
}

/** Drive the GLM stream and forward parts to Copilot Chat. */
export async function streamChatCompletion({
	prepared,
	progress,
	token,
	getCharsPerToken,
	setCharsPerToken,
}: StreamChatCompletionArgs): Promise<void> {
	const callbacks: StreamCallbacks = {
		onContent: (content) => {
			progress.report(new vscode.LanguageModelTextPart(content));
		},
		onThinking: (text) => {
			reportThinking(progress, text);
		},
		onToolCall: (toolCall) => {
			reportToolCall(progress, toolCall);
		},
		onUsage: (usage) => {
			updateCharsPerToken(prepared.totalRequestChars, usage, getCharsPerToken, setCharsPerToken);
			reportUsage(progress, usage);
		},
		onRetryBackoff: (info) => {
			reportRetryBackoff(progress, info);
		},
		onDone: () => {
			/* Resolution is handled by the client's returned promise. */
		},
		onError: (error) => {
			throw createUserFacingError(error);
		},
	};
	await prepared.client.streamChatCompletion(prepared.request, callbacks, token);
}

function reportRetryBackoff(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	info: RetryBackoffInfo,
): void {
	const seconds = Math.ceil(info.delayMs / 1000);
	const key = info.status === 429 ? 'request.retry.rateLimited' : 'request.retry.busy';
	reportThinking(progress, t(
		key,
		String(seconds),
		String(info.nextAttempt),
		String(info.maxAttempts),
	));
}

function reportThinking(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	text: string,
): void {
	const ctor = (vscode as { LanguageModelThinkingPart?: new (value: string) => unknown })
		.LanguageModelThinkingPart;
	if (typeof ctor === 'function') {
		progress.report(new ctor(text) as vscode.LanguageModelResponsePart);
	}
}

function reportToolCall(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	toolCall: GLMToolCall,
): void {
	let args: object;
	try {
		args = JSON.parse(toolCall.function.arguments) as object;
	} catch {
		args = {};
	}
	progress.report(
		new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, args),
	);
}

function updateCharsPerToken(
	totalRequestChars: number,
	usage: GLMUsage,
	getCharsPerToken: () => number,
	setCharsPerToken: (value: number) => void,
): void {
	const promptTokens = usage.prompt_tokens ?? 0;
	if (totalRequestChars > 0 && promptTokens > 0) {
		const observedRatio = totalRequestChars / promptTokens;
		setCharsPerToken(getCharsPerToken() * 0.7 + observedRatio * 0.3);
	}
}

function reportUsage(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	usage: GLMUsage,
): void {
	const data = {
		prompt_tokens: usage.prompt_tokens,
		completion_tokens: usage.completion_tokens,
		total_tokens: usage.total_tokens,
		prompt_tokens_details: {
			cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
		},
	};
	const ctor = (
		vscode as {
			LanguageModelDataPart?: new (data: Uint8Array, mimeType: string) => unknown;
		}
	).LanguageModelDataPart;
	if (typeof ctor !== 'function') {
		return;
	}
	try {
		const encoded = new TextEncoder().encode(JSON.stringify(data));
		progress.report(new ctor(encoded, USAGE_DATA_PART_MIME) as vscode.LanguageModelResponsePart);
	} catch (error) {
		logger.warn('Failed to report usage data', error);
	}
}
