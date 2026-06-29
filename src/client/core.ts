import * as vscode from 'vscode';
import { safeStringify } from '../json';
import { logger } from '../logger';
import type {
	GLMChatRequest,
	GLMStreamChunk,
	GLMToolCall,
	GLMUsage,
	IGLMClient,
	StreamCallbacks,
} from '../types';
import { formatRequestError, isAbortError, normalizeRequestError } from './errors';
import { fetchChatCompletionWithRetry } from './retry';

/**
 * Lightweight SSE-streaming GLM API client.
 * No external dependencies — uses Node's built-in `fetch`.
 */
export class GLMClient implements IGLMClient {
	constructor(
		private baseUrl: string,
		private apiKey: string,
		private version: string,
	) {}

	/**
	 * Stream a chat completion from the GLM API.
	 * Parses SSE chunks and dispatches callbacks for content, thinking, and tool calls.
	 * Transient failures (HTTP 429 / 5xx) are retried with exponential backoff before
	 * any output is streamed; once streaming begins, the response is committed.
	 */
	async streamChatCompletion(
		request: GLMChatRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: vscode.CancellationToken,
	): Promise<void> {
		const controller = new AbortController();
		const cancelListener = cancellationToken?.onCancellationRequested(() => {
			controller.abort();
		});
		if (cancellationToken?.isCancellationRequested) {
			controller.abort();
		}
		try {
			const requestBody = safeStringify({
				...request,
				stream_options: { include_usage: true },
			});
			const response = await fetchChatCompletionWithRetry(
				`${this.baseUrl}/chat/completions`,
				{
					method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.apiKey}`,
					'Accept-Encoding': 'identity',
					'User-Agent': `glm-copilot/${this.version}`,
				},
					body: requestBody,
					signal: controller.signal,
				},
				{
					baseUrl: this.baseUrl,
					cancellationToken,
					onRetryBackoff: callbacks.onRetryBackoff,
				},
			);
			if (!response.body) {
				throw new Error('No response body received');
			}
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let latestUsage: GLMUsage | undefined;
			const pendingToolCalls = new Map<number, GLMToolCall>();
			while (true) {
				if (cancellationToken?.isCancellationRequested) {
					controller.abort();
					return;
				}
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith(':')) {
						continue;
					}
					if (trimmed === 'data: [DONE]') {
						flushToolCalls(pendingToolCalls, callbacks);
						reportFinalUsage(callbacks, latestUsage);
						callbacks.onDone();
						return;
					}
					if (!trimmed.startsWith('data: ')) {
						continue;
					}
					const jsonStr = trimmed.slice(6);
					try {
						const chunk = JSON.parse(jsonStr) as GLMStreamChunk;
						if (chunk.usage) {
							latestUsage = chunk.usage;
						}
						const choice = chunk.choices?.[0];
						if (!choice) {
							continue;
						}
						const delta = choice.delta;
						if (delta?.reasoning_content) {
							callbacks.onThinking(delta.reasoning_content);
						}
						if (delta?.content) {
							callbacks.onContent(delta.content);
						}
						if (delta?.tool_calls) {
							for (const tc of delta.tool_calls) {
								let pending = pendingToolCalls.get(tc.index);
								if (!pending && tc.id) {
									pending = {
										id: tc.id,
										type: 'function',
										function: { name: '', arguments: '' },
									};
									pendingToolCalls.set(tc.index, pending);
								}
								if (pending) {
									if (tc.function?.name) {
										pending.function.name += tc.function.name;
									}
									if (tc.function?.arguments) {
										pending.function.arguments += tc.function.arguments;
									}
								}
							}
						}
						if (
							choice.finish_reason === 'tool_calls' ||
							choice.finish_reason === 'stop'
						) {
							flushToolCalls(pendingToolCalls, callbacks);
						}
					} catch (parseError) {
						logger.error('Failed to parse SSE chunk:', jsonStr.slice(0, 200), parseError);
					}
				}
			}
			reportFinalUsage(callbacks, latestUsage);
			callbacks.onDone();
		} catch (error) {
			if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
				return;
			}
			const normalizedError = normalizeRequestError(error, { baseUrl: this.baseUrl });
			logger.error('GLM request failed:', formatRequestError(normalizedError));
			callbacks.onError(normalizedError);
		} finally {
			cancelListener?.dispose();
		}
	}
}

function flushToolCalls(pending: Map<number, GLMToolCall>, callbacks: StreamCallbacks): void {
	for (const toolCall of pending.values()) {
		callbacks.onToolCall(toolCall);
	}
	pending.clear();
}

function reportFinalUsage(callbacks: StreamCallbacks, usage: GLMUsage | undefined): void {
	if (!usage || !callbacks.onUsage) {
		return;
	}
	callbacks.onUsage(usage);
}
