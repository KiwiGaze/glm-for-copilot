import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { VISION_MAX_IMAGE_BYTES, VISION_TEMP_MAX_FILES } from '../../consts';
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
	class CancellationTokenSource {
		private readonly listeners: Array<() => void> = [];
		readonly token = {
			isCancellationRequested: false,
			onCancellationRequested: (cb: () => void) => {
				this.listeners.push(cb);
				return { dispose: () => {} };
			},
		};
		cancel(): void {
			this.token.isCancellationRequested = true;
			for (const cb of this.listeners) {
				cb();
			}
		}
		dispose(): void {}
	}
	return {
		LanguageModelTextPart,
		LanguageModelDataPart,
		LanguageModelToolResultPart,
		LanguageModelToolCallPart,
		LanguageModelThinkingPart,
		CancellationError,
		CancellationTokenSource,
		LanguageModelChatMessageRole: { User: 1, Assistant: 2, System: 3 },
	};
});

vi.mock('../../config', () => ({
	getVisionPrompt: vi.fn(() => 'PROMPT'),
	getVisionEnabled: vi.fn(() => true),
}));

vi.mock('../../i18n', () => ({
	t: (key: string, ...args: string[]) => (args.length ? `${key}(${args.join('|')})` : key),
}));

vi.mock('../../logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import * as vscode from 'vscode';
import { getVisionEnabled, getVisionPrompt } from '../../config';
import { resolveVisionMessages, type VisionResolveDeps } from './resolve';

type Part =
	| InstanceType<typeof vscode.LanguageModelTextPart>
	| InstanceType<typeof vscode.LanguageModelDataPart>
	| InstanceType<typeof vscode.LanguageModelToolResultPart>;

type InvokeTool = NonNullable<VisionResolveDeps['invokeTool']>;

const FAKE_TOOL = {
	name: 'mcp_glm_vision_analyze_image',
	description: '',
	inputSchema: { properties: { image_source: {}, prompt: {} } },
	tags: [],
} as vscode.LanguageModelToolInformation;

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

function toolResult(text: string): vscode.LanguageModelToolResult {
	return { content: [new vscode.LanguageModelTextPart(text)] } as vscode.LanguageModelToolResult;
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

interface InvokeRecorder {
	calls: Array<{ name: string; input: { image_source: string; prompt: string } }>;
	invoke: InvokeTool;
}

function recordingInvoke(result: (call: number) => string): InvokeRecorder {
	const calls: InvokeRecorder['calls'] = [];
	const invoke: InvokeTool = async (name, input) => {
		calls.push({ name, input: input as { image_source: string; prompt: string } });
		return toolResult(result(calls.length));
	};
	return { calls, invoke };
}

function makeDeps(storageDir: string, invoke: InvokeTool, extra?: Partial<VisionResolveDeps>): VisionResolveDeps {
	return {
		authManager: {
			getApiKey: async () => 'id.secret',
			hasApiKey: async () => true,
			promptForApiKey: async () => true,
			deleteApiKey: async () => {},
		},
		cache: new VisionDescriptionCache(fakeMemento()),
		storageDir,
		findTool: () => FAKE_TOOL,
		invokeTool: invoke,
		...extra,
	};
}

const progress = () => ({ report: vi.fn() });
const token: vscode.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose: () => {} }),
} as unknown as vscode.CancellationToken;

const cancelledToken: vscode.CancellationToken = {
	isCancellationRequested: true,
	onCancellationRequested: () => ({ dispose: () => {} }),
} as unknown as vscode.CancellationToken;

function contentOf(message: vscode.LanguageModelChatRequestMessage): unknown[] {
	return message.content as unknown[];
}

let storageDir: string;

beforeEach(() => {
	storageDir = mkdtempSync(join(tmpdir(), 'glm-vision-test-'));
});

afterEach(() => {
	rmSync(storageDir, { recursive: true, force: true });
	vi.clearAllMocks();
	(getVisionPrompt as unknown as Mock).mockReturnValue('PROMPT');
	(getVisionEnabled as unknown as Mock).mockReturnValue(true);
});

describe('resolveVisionMessages', () => {
	it('returns text-only messages unchanged and makes no tool call', async () => {
		const { calls, invoke } = recordingInvoke(() => 'unused');
		const message = userMessage([textPart('hello world')]);

		const result = await resolveVisionMessages(makeDeps(storageDir, invoke), [message], progress(), token);

		expect(result.messages[0]).toBe(message);
		expect(result.failureNotice).toBeUndefined();
		expect(calls).toHaveLength(0);
	});

	it('writes the image to a temp file and invokes the vision tool with path and prompt', async () => {
		const { calls, invoke } = recordingInvoke(() => 'a description');
		const message = userMessage([imagePart([1, 2, 3], 'image/png')]);

		const result = await resolveVisionMessages(makeDeps(storageDir, invoke), [message], progress(), token);

		const tempFiles = readdirSync(join(storageDir, 'vision-tmp'));
		expect(tempFiles).toHaveLength(1);
		expect(tempFiles[0]).toMatch(/\.png$/);
		expect(calls).toHaveLength(1);
		expect(calls[0].name).toBe(FAKE_TOOL.name);
		expect(calls[0].input).toEqual({
			image_source: join(storageDir, 'vision-tmp', tempFiles[0]),
			prompt: 'PROMPT',
		});

		const out = contentOf(result.messages[0]);
		expect(out).toHaveLength(1);
		expect((out[0] as { value: string }).value).toContain('a description');
		expect((out[0] as { value: string }).value).toContain('described by GLM Vision');
	});

	it('analyzes each image of a multi-image message and joins the results in order', async () => {
		const calls: string[] = [];
		const invoke: InvokeTool = async (_name, input) => {
			const imageSource = (input as { image_source: string }).image_source;
			calls.push(imageSource);
			const data = await readFile(imageSource);
			return toolResult(`description ${data[0]}`);
		};
		const message = userMessage([
			imagePart([1], 'image/png'),
			imagePart([2], 'image/jpeg'),
			imagePart([3], 'image/webp'),
		]);

		const result = await resolveVisionMessages(makeDeps(storageDir, invoke), [message], progress(), token);

		expect(calls).toHaveLength(3);
		const text = (contentOf(result.messages[0])[0] as { value: string }).value;
		expect(text).toContain('Image 1:\ndescription 1');
		expect(text).toContain('Image 2:\ndescription 2');
		expect(text).toContain('Image 3:\ndescription 3');
		expect(readdirSync(join(storageDir, 'vision-tmp'))).toHaveLength(3);
	});

	it('analyzes images nested in a tool result and re-injects text inside that tool result', async () => {
		const { invoke } = recordingInvoke(() => 'tool image description');
		const nested = new vscode.LanguageModelToolResultPart('call-1', [
			textPart('log output'),
			imagePart([7], 'image/png'),
		]);

		const result = await resolveVisionMessages(makeDeps(storageDir, invoke), [userMessage([nested])], progress(), token);

		const out = contentOf(result.messages[0]);
		const resolved = out[0] as InstanceType<typeof vscode.LanguageModelToolResultPart>;
		expect(resolved.callId).toBe('call-1');
		expect(resolved.content.some((p) => p instanceof vscode.LanguageModelDataPart)).toBe(false);
		const texts = resolved.content
			.filter((p): p is InstanceType<typeof vscode.LanguageModelTextPart> => p instanceof vscode.LanguageModelTextPart)
			.map((p) => p.value);
		expect(texts).toContain('log output');
		expect(texts.some((v) => v.includes('tool image description'))).toBe(true);
	});

	it('serves identical image content from cache without a second tool call', async () => {
		const { calls, invoke } = recordingInvoke(() => 'cached description');
		const cache = new VisionDescriptionCache(fakeMemento());
		const message = userMessage([imagePart([5, 5, 5], 'image/png')]);

		await resolveVisionMessages(makeDeps(storageDir, invoke, { cache }), [message], progress(), token);
		await resolveVisionMessages(makeDeps(storageDir, invoke, { cache }), [message], progress(), token);

		expect(calls).toHaveLength(1);
	});

	it('re-analyzes (cache miss) when the prompt changes', async () => {
		const { calls, invoke } = recordingInvoke(() => 'description');
		const cache = new VisionDescriptionCache(fakeMemento());
		const message = userMessage([imagePart([5, 5, 5], 'image/png')]);
		(getVisionPrompt as unknown as Mock).mockReturnValueOnce('PROMPT-A').mockReturnValueOnce('PROMPT-B');

		await resolveVisionMessages(makeDeps(storageDir, invoke, { cache }), [message], progress(), token);
		await resolveVisionMessages(makeDeps(storageDir, invoke, { cache }), [message], progress(), token);

		expect(calls).toHaveLength(2);
	});

	it('streams an analysis status into thinking on cache miss, and stays silent on cache hit', async () => {
		const { invoke } = recordingInvoke(() => 'description');
		const cache = new VisionDescriptionCache(fakeMemento());
		const message = userMessage([imagePart([1], 'image/png')]);

		const p1 = progress();
		await resolveVisionMessages(makeDeps(storageDir, invoke, { cache }), [message], p1, token);
		const thinking1 = p1.report.mock.calls
			.map((c) => c[0])
			.filter((p) => p instanceof vscode.LanguageModelThinkingPart);
		expect(thinking1).toHaveLength(1);
		expect((thinking1[0] as { value: string }).value).toBe('vision.progress.one');

		const p2 = progress();
		await resolveVisionMessages(makeDeps(storageDir, invoke, { cache }), [message], p2, token);
		const thinking2 = p2.report.mock.calls
			.map((c) => c[0])
			.filter((p) => p instanceof vscode.LanguageModelThinkingPart);
		expect(thinking2).toHaveLength(0);
	});

	it('fails with the unavailable marker when the vision tool is not registered', async () => {
		const { calls, invoke } = recordingInvoke(() => 'unused');

		const result = await resolveVisionMessages(
			makeDeps(storageDir, invoke, { findTool: () => undefined }),
			[userMessage([imagePart([1], 'image/png')])],
			progress(),
			token,
		);

		expect(calls).toHaveLength(0);
		expect((contentOf(result.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.failureNotice).toContain('vision.error.toolUnavailable');
	});

	it('fails with the unavailable marker when no API key is configured', async () => {
		const { calls, invoke } = recordingInvoke(() => 'unused');
		const noKeyAuth = {
			getApiKey: async () => undefined,
			hasApiKey: async () => false,
			promptForApiKey: async () => false,
			deleteApiKey: async () => {},
		};

		const result = await resolveVisionMessages(
			makeDeps(storageDir, invoke, { authManager: noKeyAuth }),
			[userMessage([imagePart([1], 'image/png')])],
			progress(),
			token,
		);

		expect(calls).toHaveLength(0);
		expect((contentOf(result.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.failureNotice).toContain('vision.error.noKey');
	});

	it('does not analyze or write files when vision is turned off', async () => {
		(getVisionEnabled as unknown as Mock).mockReturnValue(false);
		const { calls, invoke } = recordingInvoke(() => 'unused');

		const result = await resolveVisionMessages(
			makeDeps(storageDir, invoke),
			[userMessage([imagePart([1], 'image/png')])],
			progress(),
			token,
		);

		expect(calls).toHaveLength(0);
		expect(existsSync(join(storageDir, 'vision-tmp'))).toBe(false);
		expect((contentOf(result.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.failureNotice).toContain('vision.error.disabled');
	});

	it('still serves cached descriptions while vision is turned off', async () => {
		const { calls, invoke } = recordingInvoke(() => 'cached description');
		const cache = new VisionDescriptionCache(fakeMemento());
		const message = userMessage([imagePart([5, 5, 5], 'image/png')]);

		await resolveVisionMessages(makeDeps(storageDir, invoke, { cache }), [message], progress(), token);
		(getVisionEnabled as unknown as Mock).mockReturnValue(false);
		const result = await resolveVisionMessages(makeDeps(storageDir, invoke, { cache }), [message], progress(), token);

		expect(calls).toHaveLength(1);
		expect(result.failureNotice).toBeUndefined();
		expect((contentOf(result.messages[0])[0] as { value: string }).value).toContain('cached description');
	});

	it('bounds the temp dir on every analysis call, evicting the oldest files first', async () => {
		const { invoke } = recordingInvoke(() => 'a description');
		const dir = join(storageDir, 'vision-tmp');
		mkdirSync(dir, { recursive: true });
		const seeded = Array.from(
			{ length: VISION_TEMP_MAX_FILES + 2 },
			(_, index) => `seed-${String(index).padStart(3, '0')}.png`,
		);
		seeded.forEach((name, index) => {
			writeFileSync(join(dir, name), 'x');
			const past = new Date(Date.now() - (seeded.length - index) * 60_000);
			utimesSync(join(dir, name), past, past);
		});

		await resolveVisionMessages(
			makeDeps(storageDir, invoke),
			[userMessage([imagePart([1], 'image/png')])],
			progress(),
			token,
		);
		expect(readdirSync(dir)).toHaveLength(VISION_TEMP_MAX_FILES + 1);
		expect(existsSync(join(dir, 'seed-000.png'))).toBe(false);
		expect(existsSync(join(dir, 'seed-001.png'))).toBe(false);

		await resolveVisionMessages(
			makeDeps(storageDir, invoke),
			[userMessage([imagePart([2], 'image/png')])],
			progress(),
			token,
		);
		expect(readdirSync(dir)).toHaveLength(VISION_TEMP_MAX_FILES + 1);
		expect(existsSync(join(dir, 'seed-002.png'))).toBe(false);
	});

	it('treats an MCP error-envelope result as a failure with the server reason', async () => {
		const { invoke } = recordingInvoke(() => 'Error: API error: invalid API key');

		const result = await resolveVisionMessages(
			makeDeps(storageDir, invoke),
			[userMessage([imagePart([1], 'image/png')])],
			progress(),
			token,
		);

		expect((contentOf(result.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.failureNotice).toContain('invalid API key');
	});

	it('on an invocation error, injects the continue-without-images marker and one leading notice', async () => {
		const invoke: InvokeTool = async () => {
			throw new Error('analysis boom');
		};

		const result = await resolveVisionMessages(
			makeDeps(storageDir, invoke),
			[userMessage([imagePart([1], 'image/png')])],
			progress(),
			token,
		);

		expect((contentOf(result.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.failureNotice).toContain('vision.notice.failed');
		expect(result.failureNotice).toContain('analysis boom');
	});

	it('treats an empty analysis response as a failure', async () => {
		const { invoke } = recordingInvoke(() => '   ');

		const result = await resolveVisionMessages(
			makeDeps(storageDir, invoke),
			[userMessage([imagePart([1], 'image/png')])],
			progress(),
			token,
		);

		expect((contentOf(result.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.failureNotice).toContain('vision.error.empty');
	});

	it('surfaces only the first failure notice across multiple failing containers', async () => {
		const invoke: InvokeTool = async () => {
			throw new Error('boom');
		};
		const messages = [
			userMessage([imagePart([1], 'image/png')]),
			userMessage([imagePart([2], 'image/png')]),
		];

		const result = await resolveVisionMessages(makeDeps(storageDir, invoke), messages, progress(), token);

		expect(result.failureNotice).toBeDefined();
		expect((contentOf(result.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect((contentOf(result.messages[1])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
	});

	it('fails with a timeout reason when the invocation outlives the timeout', async () => {
		const invoke: InvokeTool = (_name, _input, callToken) =>
			new Promise((_resolve, reject) => {
				callToken.onCancellationRequested(() => reject(new vscode.CancellationError()));
			});

		const result = await resolveVisionMessages(
			makeDeps(storageDir, invoke, { timeoutMs: 10 }),
			[userMessage([imagePart([1], 'image/png')])],
			progress(),
			token,
		);

		expect((contentOf(result.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.failureNotice).toContain('vision.error.timeout');
	});

	it('propagates request cancellation as cancellation, not as an analysis failure', async () => {
		const invoke: InvokeTool = async () => {
			throw new vscode.CancellationError();
		};

		await expect(
			resolveVisionMessages(
				makeDeps(storageDir, invoke),
				[userMessage([imagePart([1], 'image/png')])],
				progress(),
				cancelledToken,
			),
		).rejects.toBeInstanceOf(vscode.CancellationError);
	});

	it('serves cached descriptions while the vision server is unavailable', async () => {
		const { calls, invoke } = recordingInvoke(() => 'cached description');
		const cache = new VisionDescriptionCache(fakeMemento());
		const message = userMessage([imagePart([5, 5, 5], 'image/png')]);

		await resolveVisionMessages(makeDeps(storageDir, invoke, { cache }), [message], progress(), token);

		const result = await resolveVisionMessages(
			makeDeps(storageDir, invoke, { cache, findTool: () => undefined }),
			[message],
			progress(),
			token,
		);

		expect(calls).toHaveLength(1);
		expect(result.failureNotice).toBeUndefined();
		expect((contentOf(result.messages[0])[0] as { value: string }).value).toContain('cached description');
	});

	it('treats an all-empty multi-image result as a failure and does not cache it', async () => {
		const { calls, invoke } = recordingInvoke(() => '   ');
		const cache = new VisionDescriptionCache(fakeMemento());
		const message = userMessage([imagePart([1], 'image/png'), imagePart([2], 'image/jpeg')]);

		const first = await resolveVisionMessages(makeDeps(storageDir, invoke, { cache }), [message], progress(), token);
		expect((contentOf(first.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(first.failureNotice).toContain('vision.error.empty');

		await resolveVisionMessages(makeDeps(storageDir, invoke, { cache }), [message], progress(), token);
		expect(calls).toHaveLength(4);
	});

	it('treats a multi-line result that starts with "Error:" as a successful analysis', async () => {
		const { invoke } = recordingInvoke(() => 'Error: ECONNREFUSED is visible in the terminal\nThe stack trace below shows…');

		const result = await resolveVisionMessages(
			makeDeps(storageDir, invoke),
			[userMessage([imagePart([1], 'image/png')])],
			progress(),
			token,
		);

		expect(result.failureNotice).toBeUndefined();
		expect((contentOf(result.messages[0])[0] as { value: string }).value).toContain('Error: ECONNREFUSED');
	});

	it('rejects an unsupported image type before any tool call', async () => {
		const { calls, invoke } = recordingInvoke(() => 'unused');

		const result = await resolveVisionMessages(
			makeDeps(storageDir, invoke),
			[userMessage([imagePart([1], 'image/svg+xml')])],
			progress(),
			token,
		);

		expect(calls).toHaveLength(0);
		expect((contentOf(result.messages[0])[0] as { value: string }).value).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.failureNotice).toContain('vision.error.unsupportedType');
	});

	it('rejects an oversized image before any tool call', async () => {
		const { calls, invoke } = recordingInvoke(() => 'unused');
		const message = userMessage([imagePart(new Uint8Array(VISION_MAX_IMAGE_BYTES + 1), 'image/png')]);

		const result = await resolveVisionMessages(makeDeps(storageDir, invoke), [message], progress(), token);

		expect(calls).toHaveLength(0);
		expect(result.failureNotice).toContain('vision.error.tooLarge');
	});
});
