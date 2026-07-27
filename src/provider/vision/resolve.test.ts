import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { VISION_MAX_IMAGE_BYTES } from '../../consts';
import type { IGLMClient, StreamCallbacks } from '../../types';
import { VisionDescriptionCache, type VisionCacheMemento } from './cache';
import { IMAGE_DESCRIPTION_UNAVAILABLE } from './consts';

vi.mock('vscode', () => {
	class LanguageModelTextPart {
		constructor(public value: string) {}
	}
	class LanguageModelDataPart {
		constructor(
			public data: Uint8Array,
			public mimeType: string,
		) {}
	}
	class LanguageModelToolResultPart {
		constructor(
			public callId: string,
			public content: unknown[],
		) {}
	}
	class LanguageModelToolCallPart {
		constructor(
			public callId: string,
			public name: string,
			public input: object,
		) {}
	}
	class LanguageModelThinkingPart {
		constructor(public value: string) {}
	}
	class CancellationError extends Error {
		constructor() {
			super('Canceled');
			this.name = 'Canceled';
		}
	}
	return {
		LanguageModelTextPart,
		LanguageModelDataPart,
		LanguageModelToolResultPart,
		LanguageModelToolCallPart,
		LanguageModelThinkingPart,
		CancellationError,
		LanguageModelChatMessageRole: { User: 1, Assistant: 2, System: 3 },
	};
});

vi.mock('../../client', () => ({
	GLMClient: class {},
	GLMRequestError: class GLMRequestError extends Error {
		userSummary: string;
		constructor(summary: string) {
			super(summary);
			this.userSummary = summary;
		}
	},
}));

vi.mock('../../endpoint', () => ({ resolveBaseUrl: () => 'https://example.test' }));

vi.mock('../../config', () => ({
	getMaxRetries: () => 0,
	getVisionModel: vi.fn(() => 'glm-4.6v'),
	getVisionPrompt: vi.fn(() => 'PROMPT'),
}));

vi.mock('../../i18n', () => ({
	t: (key: string, ...args: string[]) => (args.length ? `${key}(${args.join('|')})` : key),
}));

vi.mock('../../logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import * as vscode from 'vscode';
import { getVisionModel, getVisionPrompt } from '../../config';
import { resolveVisionMessages, type VisionResolveDeps } from './resolve';

type Part =
	| InstanceType<typeof vscode.LanguageModelTextPart>
	| InstanceType<typeof vscode.LanguageModelDataPart>
	| InstanceType<typeof vscode.LanguageModelToolResultPart>;

function textPart(value: string) {
	return new vscode.LanguageModelTextPart(value);
}

function imagePart(bytes: number[] | Uint8Array, mimeType = 'image/png') {
	const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	return new vscode.LanguageModelDataPart(data, mimeType);
}

function userMessage(content: Part[]): vscode.LanguageModelChatRequestMessage {
	return { role: 1, content, name: undefined } as unknown as vscode.LanguageModelChatRequestMessage;
}

interface FakeClient extends IGLMClient {
	requests: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }>;
	streamChatCompletion: Mock;
}

function fakeClient(behavior: (callbacks: StreamCallbacks, token: vscode.CancellationToken) => void): FakeClient {
	const requests: FakeClient['requests'] = [];
	const streamChatCompletion = vi.fn(
		async (request: unknown, callbacks: StreamCallbacks, token: vscode.CancellationToken) => {
			requests.push(request as FakeClient['requests'][number]);
			behavior(callbacks, token);
		},
	);
	return { requests, streamChatCompletion } as FakeClient;
}

function describes(text: string): FakeClient {
	return fakeClient((cb) => {
		if (text) {
			cb.onContent(text);
		}
		cb.onDone();
	});
}

function fakeMemento(): VisionCacheMemento {
	const store = new Map<string, unknown>();
	return {
		get: <T>(key: string) => store.get(key) as T | undefined,
		update: (key: string, value: unknown) => {
			store.set(key, value);
			return Promise.resolve();
		},
	};
}

function deps(client: IGLMClient, cache = new VisionDescriptionCache(fakeMemento())): VisionResolveDeps {
	return {
		authManager: {
			getApiKey: async () => 'id.secret',
			hasApiKey: async () => true,
			promptForApiKey: async () => true,
			deleteApiKey: async () => {},
		},
		extensionVersion: '0.3.0',
		cache,
		createClient: () => client,
	};
}

const progress = () => ({ report: vi.fn() });
const token: vscode.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: vi.fn(),
} as unknown as vscode.CancellationToken;

function contentOf(message: vscode.LanguageModelChatRequestMessage): unknown[] {
	return message.content as unknown[];
}

beforeEach(() => {
	vi.clearAllMocks();
	(getVisionModel as unknown as Mock).mockReturnValue('glm-4.6v');
	(getVisionPrompt as unknown as Mock).mockReturnValue('PROMPT');
});

describe('resolveVisionMessages', () => {
	it('returns text-only messages unchanged and makes no describe call', async () => {
		const client = describes('unused');
		const message = userMessage([textPart('hello world')]);

		const result = await resolveVisionMessages(deps(client), [message], progress(), token);

		expect(result.messages[0]).toBe(message);
		expect(result.failureNotice).toBeUndefined();
		expect(client.streamChatCompletion).not.toHaveBeenCalled();
	});

	it('encodes an image as a base64 data URL with its MIME type', async () => {
		const bytes = new Uint8Array([1, 2, 3, 4, 250]);
		const client = describes('a description');

		await resolveVisionMessages(deps(client), [userMessage([imagePart(bytes, 'image/jpeg')])], progress(), token);

		const content = client.requests[0].messages[0].content as Array<Record<string, unknown>>;
		expect(content[0]).toEqual({
			type: 'image_url',
			image_url: { url: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}` },
		});
		expect(content[1]).toEqual({ type: 'text', text: 'PROMPT' });
	});

	it('batches all images in one message into a single describe request, in order', async () => {
		const client = describes('combined description');
		const message = userMessage([
			imagePart([1], 'image/png'),
			imagePart([2], 'image/jpeg'),
			imagePart([3], 'image/webp'),
		]);

		const result = await resolveVisionMessages(deps(client), [message], progress(), token);

		expect(client.streamChatCompletion).toHaveBeenCalledTimes(1);
		const content = client.requests[0].messages[0].content as Array<Record<string, { url: string }>>;
		const urls = content.filter((p) => p.type === 'image_url').map((p) => p.image_url.url);
		expect(urls).toHaveLength(3);
		expect(urls[0]).toContain(Buffer.from(new Uint8Array([1])).toString('base64'));
		expect(urls[2]).toContain(Buffer.from(new Uint8Array([3])).toString('base64'));

		const out = contentOf(result.messages[0]);
		expect(out).toHaveLength(1);
		expect(out[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
		expect((out[0] as { value: string }).value).toContain('combined description');
	});

	it('describes images nested in a tool result and re-injects text inside that tool result', async () => {
		const client = describes('tool image description');
		const toolResult = new vscode.LanguageModelToolResultPart('call-1', [
			textPart('log output'),
			imagePart([7], 'image/png'),
		]);

		const result = await resolveVisionMessages(deps(client), [userMessage([toolResult])], progress(), token);

		expect(client.streamChatCompletion).toHaveBeenCalledTimes(1);
		const out = contentOf(result.messages[0]);
		expect(out[0]).toBeInstanceOf(vscode.LanguageModelToolResultPart);
		const resolvedResult = out[0] as InstanceType<typeof vscode.LanguageModelToolResultPart>;
		expect(resolvedResult.callId).toBe('call-1');
		expect(resolvedResult.content.some((p) => p instanceof vscode.LanguageModelDataPart)).toBe(false);
		const texts = resolvedResult.content
			.filter((p): p is InstanceType<typeof vscode.LanguageModelTextPart> => p instanceof vscode.LanguageModelTextPart)
			.map((p) => p.value);
		expect(texts).toContain('log output');
		expect(texts.some((v) => v.includes('tool image description'))).toBe(true);
	});

	it('serves identical image content from cache without a second describe call', async () => {
		const client = describes('cached description');
		const cache = new VisionDescriptionCache(fakeMemento());
		const message = userMessage([imagePart([5, 5, 5], 'image/png')]);

		await resolveVisionMessages(deps(client, cache), [message], progress(), token);
		await resolveVisionMessages(deps(client, cache), [message], progress(), token);

		expect(client.streamChatCompletion).toHaveBeenCalledTimes(1);
	});

	it('re-describes (cache miss) when the prompt changes', async () => {
		const client = describes('description');
		const cache = new VisionDescriptionCache(fakeMemento());
		const message = userMessage([imagePart([5, 5, 5], 'image/png')]);
		(getVisionPrompt as unknown as Mock).mockReturnValueOnce('PROMPT-A').mockReturnValueOnce('PROMPT-B');

		await resolveVisionMessages(deps(client, cache), [message], progress(), token);
		await resolveVisionMessages(deps(client, cache), [message], progress(), token);

		expect(client.streamChatCompletion).toHaveBeenCalledTimes(2);
	});

	it('streams a describe status into thinking on cache miss, and stays silent on cache hit', async () => {
		const client = describes('description');
		const cache = new VisionDescriptionCache(fakeMemento());
		const message = userMessage([imagePart([1], 'image/png')]);

		const p1 = progress();
		await resolveVisionMessages(deps(client, cache), [message], p1, token);
		const thinking1 = p1.report.mock.calls
			.map((c) => c[0])
			.filter((p) => p instanceof vscode.LanguageModelThinkingPart);
		expect(thinking1).toHaveLength(1);
		expect((thinking1[0] as { value: string }).value).toContain('glm-4.6v');

		const p2 = progress();
		await resolveVisionMessages(deps(client, cache), [message], p2, token);
		const thinking2 = p2.report.mock.calls
			.map((c) => c[0])
			.filter((p) => p instanceof vscode.LanguageModelThinkingPart);
		expect(thinking2).toHaveLength(0);
	});

	it('on a describe error, injects the continue-without-images marker and one leading notice', async () => {
		const client = fakeClient((cb) => cb.onError(new Error('describe boom')));
		const message = userMessage([imagePart([1], 'image/png')]);

		const result = await resolveVisionMessages(deps(client), [message], progress(), token);

		const injected = (contentOf(result.messages[0])[0] as { value: string }).value;
		expect(injected).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.failureNotice).toContain('vision.notice.failed');
		expect(result.failureNotice).toContain('describe boom');
	});

	it('treats an empty describe response as a failure', async () => {
		const client = describes('');
		const message = userMessage([imagePart([1], 'image/png')]);

		const result = await resolveVisionMessages(deps(client), [message], progress(), token);

		expect((contentOf(result.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.failureNotice).toContain('vision.error.empty');
	});

	it('surfaces only the first failure notice across multiple failing containers', async () => {
		const client = fakeClient((cb) => cb.onError(new Error('boom')));
		const messages = [
			userMessage([imagePart([1], 'image/png')]),
			userMessage([imagePart([2], 'image/png')]),
		];

		const result = await resolveVisionMessages(deps(client), messages, progress(), token);

		expect(result.failureNotice).toBeDefined();
		expect((contentOf(result.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect((contentOf(result.messages[1])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
	});

	it('propagates cancellation as cancellation, not as a describe failure', async () => {
		const cancelled: vscode.CancellationToken = {
			isCancellationRequested: true,
			onCancellationRequested: vi.fn(),
		} as unknown as vscode.CancellationToken;
		const client = fakeClient((cb) => cb.onError(new Error('aborted')));
		const message = userMessage([imagePart([1], 'image/png')]);

		await expect(
			resolveVisionMessages(deps(client), [message], progress(), cancelled),
		).rejects.toBeInstanceOf(vscode.CancellationError);
	});

	it('rejects an unsupported image type before any network call', async () => {
		const client = describes('unused');
		const message = userMessage([imagePart([1], 'image/svg+xml')]);

		const result = await resolveVisionMessages(deps(client), [message], progress(), token);

		expect(client.streamChatCompletion).not.toHaveBeenCalled();
		expect((contentOf(result.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.failureNotice).toContain('vision.error.unsupportedType');
	});

	it('rejects an oversized image before any network call', async () => {
		const client = describes('unused');
		const message = userMessage([imagePart(new Uint8Array(VISION_MAX_IMAGE_BYTES + 1), 'image/png')]);

		const result = await resolveVisionMessages(deps(client), [message], progress(), token);

		expect(client.streamChatCompletion).not.toHaveBeenCalled();
		expect(result.failureNotice).toContain('vision.error.tooLarge');
	});
});
