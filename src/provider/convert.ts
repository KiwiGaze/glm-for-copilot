import * as vscode from 'vscode';
import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../consts';
import { safeStringify } from '../json';
import type { GLMMessage, GLMTool, GLMToolCall } from '../types';

/**
 * A `LanguageModelThinkingPart`-shaped value. The thinking part is a proposed
 * VS Code API, so it is feature-detected and read through this narrow shape
 * instead of importing the type directly.
 */
interface ThinkingPartLike {
	value: string | string[];
}

interface PendingToolResult {
	callId: string;
	content: string;
}

/** Convert VS Code chat messages to GLM (OpenAI-compatible) wire messages. */
export function convertMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	isThinkingModel: boolean,
): GLMMessage[] {
	const result: GLMMessage[] = [];
	for (const message of messages) {
		const role = mapRole(message.role);
		let content = '';
		let thinkingContent = '';
		const toolCalls: GLMToolCall[] = [];
		const toolResults: PendingToolResult[] = [];
		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				content += part.value;
			} else if (isThinkingPart(part)) {
				thinkingContent += normalizeThinkingText(part.value);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId,
					type: 'function',
					function: {
						name: part.name,
						arguments: safeStringify(part.input),
					},
				});
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				let toolContent = '';
				for (const item of part.content) {
					if (item instanceof vscode.LanguageModelTextPart) {
						toolContent += item.value;
					}
				}
				toolResults.push({
					callId: part.callId,
					content: toolContent || safeStringify(part.content),
				});
			}
		}
		if (role === 'assistant') {
			if (content || toolCalls.length > 0) {
				const msg: GLMMessage = {
					role: 'assistant',
					content: content || '',
				};
				if (toolCalls.length > 0) {
					msg.tool_calls = toolCalls;
				}
				if (isThinkingModel && thinkingContent) {
					msg.reasoning_content = thinkingContent;
				}
				result.push(msg);
			}
		} else if (content) {
			result.push({
				role,
				content,
			});
		}
		for (const toolResult of toolResults) {
			result.push({
				role: 'tool',
				content: toolResult.content,
				tool_call_id: toolResult.callId,
			});
		}
	}
	return result;
}

/** Map a VS Code message role to a GLM role. GLM is OpenAI-compatible, so
 * the system role maps to `'system'`. */
export function mapRole(role: vscode.LanguageModelChatMessageRole): 'system' | 'user' | 'assistant' {
	const value = role as number;
	if (value === vscode.LanguageModelChatMessageRole.Assistant) {
		return 'assistant';
	}
	if (value === LANGUAGE_MODEL_CHAT_SYSTEM_ROLE) {
		return 'system';
	}
	return 'user';
}

/** Convert VS Code tool definitions to GLM tool definitions. */
export function convertTools(tools: readonly vscode.LanguageModelChatTool[]): GLMTool[] {
	return tools.map((tool) => ({
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
		},
	}));
}

/** Sum content, reasoning, and tool-call chars to calibrate chars-per-token. */
export function countMessageChars(messages: GLMMessage[]): number {
	let total = 0;
	for (const message of messages) {
		total += message.content?.length ?? 0;
		total += message.reasoning_content?.length ?? 0;
		if (message.tool_calls) {
			for (const toolCall of message.tool_calls) {
				total += toolCall.function?.name?.length ?? 0;
				total += toolCall.function?.arguments?.length ?? 0;
			}
		}
	}
	return total;
}

function isThinkingPart(part: unknown): part is ThinkingPartLike {
	const ctor = (vscode as { LanguageModelThinkingPart?: unknown }).LanguageModelThinkingPart;
	return typeof ctor === 'function' && part instanceof (ctor as new (...args: never[]) => object);
}

function normalizeThinkingText(value: string | string[]): string {
	return Array.isArray(value) ? value.join('') : value;
}
