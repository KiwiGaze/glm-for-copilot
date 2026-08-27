import * as vscode from 'vscode';
import { GLMClient } from '../../client';
import { getApiModelId, getMaxRetries } from '../../config';
import { VISION_DESCRIPTION_MAX_TOKENS, VISION_INVOKE_TIMEOUT_MS } from '../../consts';
import { resolveBaseUrl } from '../../endpoint';
import { t } from '../../i18n';
import type {
	GLMChatRequest,
	GLMImageUrlContentPart,
	GLMTextContentPart,
	IAuthManager,
	IGLMClient,
} from '../../types';
import type { VisionImage } from './cache';

export const FLASH_IMAGE_MODEL_ID = 'glm-5.3-flash';

export interface FlashAnalysisTarget {
	baseUrl: string;
	modelId: string;
}

type ClientFactory = (
	baseUrl: string,
	apiKey: string,
	version: string,
	maxRetries: number,
) => IGLMClient;

export class FlashAnalysisTimeoutError extends Error {
	constructor() {
		super('GLM-5.3-Flash image analysis timed out');
		this.name = 'FlashAnalysisTimeoutError';
	}
}

/** Sends one image container to GLM-5.3-Flash without re-entering the VS Code provider. */
export class FlashImageAnalyzer {
	constructor(
		private readonly authManager: IAuthManager,
		private readonly extensionVersion: string,
		private readonly createClient: ClientFactory = (baseUrl, apiKey, version, maxRetries) =>
			new GLMClient(baseUrl, apiKey, version, maxRetries),
		private readonly timeoutMs = VISION_INVOKE_TIMEOUT_MS,
	) {}

	getTarget(): FlashAnalysisTarget {
		return {
			baseUrl: resolveBaseUrl(),
			modelId: getApiModelId(FLASH_IMAGE_MODEL_ID),
		};
	}

	async analyze(
		target: FlashAnalysisTarget,
		images: readonly VisionImage[],
		prompt: string,
		token: vscode.CancellationToken,
	): Promise<string> {
		if (token.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		const apiKey = await this.authManager.getApiKey();
		if (!apiKey) {
			throw new Error(t('vision.error.noKey'));
		}
		if (token.isCancellationRequested) {
			throw new vscode.CancellationError();
		}

		const client = this.createClient(
			target.baseUrl,
			apiKey,
			this.extensionVersion,
			getMaxRetries(),
		);
		const request = createFlashRequest(target.modelId, prompt, images);
		return collectFinalContent(client, request, token, this.timeoutMs);
	}
}

export function createFlashRequest(
	modelId: string,
	prompt: string,
	images: readonly VisionImage[],
): GLMChatRequest {
	const content: Array<GLMTextContentPart | GLMImageUrlContentPart> = [
		{ type: 'text', text: prompt },
		...images.map((image) => ({
			type: 'image_url' as const,
			image_url: {
				url: `data:${image.mimeType.toLowerCase()};base64,${Buffer.from(image.data).toString('base64')}`,
			},
		})),
	];
	return {
		model: modelId,
		messages: [{ role: 'user', content }],
		stream: true,
		max_tokens: VISION_DESCRIPTION_MAX_TOKENS,
		thinking: { type: 'enabled' },
		reasoning_effort: 'max',
		clear_thinking: false,
		temperature: 1,
		top_p: 0.95,
	};
}

async function collectFinalContent(
	client: IGLMClient,
	request: GLMChatRequest,
	requestToken: vscode.CancellationToken,
	timeoutMs: number,
): Promise<string> {
	const cancellation = new vscode.CancellationTokenSource();
	let timedOut = false;
	let requestError: unknown;
	let content = '';
	const subscription = requestToken.onCancellationRequested(() => cancellation.cancel());
	if (requestToken.isCancellationRequested) {
		cancellation.cancel();
	}
	const timer = setTimeout(() => {
		timedOut = true;
		cancellation.cancel();
	}, timeoutMs);

	try {
		await client.streamChatCompletion(
			request,
			{
				onContent: (chunk) => {
					content += chunk;
				},
				onThinking: () => {},
				onToolCall: () => {},
				onDone: () => {},
				onError: (error) => {
					requestError = error;
				},
			},
			cancellation.token,
		);
	} finally {
		clearTimeout(timer);
		subscription.dispose();
		cancellation.dispose();
	}

	if (requestToken.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
	if (timedOut) {
		throw new FlashAnalysisTimeoutError();
	}
	if (requestError !== undefined) {
		throw requestError;
	}
	return content.trim();
}
