import * as vscode from 'vscode';
import { GLMClient } from '../client';
import { findModelDefinition, getApiModelId, getMaxTokens, getThinking } from '../config';
import { DEFAULT_TOOLS_LIMIT } from '../consts';
import { resolveBaseUrl } from '../endpoint';
import { t } from '../i18n';
import type {
	GLMChatRequest,
	GLMTool,
	IAuthManager,
	ThinkingEffort,
	ThinkingEffortSpec,
	ThinkingMode,
} from '../types';
import { convertMessages, convertTools, countMessageChars } from './convert';

interface PrepareChatRequestArgs {
	authManager: IAuthManager;
	extensionVersion: string;
	modelInfo: vscode.LanguageModelChatInformation;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	options: vscode.ProvideLanguageModelChatResponseOptions;
	token: vscode.CancellationToken;
}

export interface PreparedChatRequest {
	client: GLMClient;
	request: GLMChatRequest;
	totalRequestChars: number;
	isThinkingModel: boolean;
}

/** Build the GLM client and request body for one Copilot Chat turn. */
export async function prepareChatRequest({
	authManager,
	extensionVersion,
	modelInfo,
	messages,
	options,
}: PrepareChatRequestArgs): Promise<PreparedChatRequest> {
	const apiKey = await authManager.getApiKey();
	if (!apiKey) {
		throw new Error(t('auth.notConfigured'));
	}
	const baseUrl = resolveBaseUrl();
	const client = new GLMClient(baseUrl, apiKey, extensionVersion);
	const modelDef = findModelDefinition(modelInfo.id);
	const isThinkingModel = modelDef?.capabilities.thinking ?? false;
	const toolCalling = modelDef?.capabilities.toolCalling ?? false;
	const toolLimit = typeof toolCalling === 'number' ? toolCalling : DEFAULT_TOOLS_LIMIT;
	const glmMessages = convertMessages(messages, isThinkingModel);
	const tools: GLMTool[] | undefined = toolCalling ? convertTools(options.tools ?? []) : undefined;
	if (tools && tools.length > toolLimit) {
		throw new Error(t('request.toolsLimitExceeded', String(toolLimit), String(tools.length)));
	}
	const hasTools = !!(tools && tools.length > 0);
	const effortSpec = modelDef?.capabilities.thinkingEffort;
	let thinkingFields: Pick<GLMChatRequest, 'thinking' | 'reasoning_effort'> = {};
	if (effortSpec) {
		const effort = resolveEffort(options as EffortOptions, effortSpec);
		thinkingFields =
			effort === 'none'
				? { thinking: { type: 'disabled' } }
				: { thinking: { type: 'enabled' }, reasoning_effort: effort };
	} else if (isThinkingModel) {
		thinkingFields = { thinking: { type: resolveThinking(options) } };
	}
	const request: GLMChatRequest = {
		model: getApiModelId(modelInfo.id),
		messages: glmMessages,
		stream: true,
		tools: hasTools ? tools : undefined,
		tool_choice: hasTools ? 'auto' : undefined,
		max_tokens: getMaxTokens(),
		...thinkingFields,
	};
	const totalRequestChars = countMessageChars(glmMessages);
	return { client, request, totalRequestChars, isThinkingModel };
}

type EffortOptions = vscode.ProvideLanguageModelChatResponseOptions & {
	readonly modelConfiguration?: { readonly reasoningEffort?: ThinkingEffort };
	readonly configuration?: { readonly reasoningEffort?: ThinkingEffort };
};

function resolveEffort(options: EffortOptions, spec: ThinkingEffortSpec): ThinkingEffort {
	const picked = options.modelConfiguration?.reasoningEffort ?? options.configuration?.reasoningEffort;
	return picked && spec.levels.includes(picked) ? picked : spec.default;
}

/** Thinking mode from a per-request override (modelOptions), else the setting. */
function resolveThinking(options: vscode.ProvideLanguageModelChatResponseOptions): ThinkingMode {
	const modelOptions = options.modelOptions as Record<string, unknown> | undefined;
	const override = modelOptions?.['thinking'];
	if (override === 'disabled') {
		return 'disabled';
	}
	if (override === 'enabled') {
		return 'enabled';
	}
	return getThinking();
}
