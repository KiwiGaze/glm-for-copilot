import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VISION_MAX_IMAGE_BYTES, VISION_MAX_IMAGES_PER_REQUEST } from '../../consts';
import { FlashAnalysisTimeoutError, type FlashAnalysisTarget } from './analyze';
import { VisionDescriptionCache, type VisionImage } from './cache';
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
		LanguageModelThinkingPart,
		CancellationError,
		LanguageModelChatMessageRole: { User: 1, Assistant: 2, System: 3 },
	};
});

vi.mock('../../config', () => ({ getVisionPrompt: () => 'DEFAULT PROMPT' }));
vi.mock('../../i18n', () => ({
	t: (key: string, ...args: string[]) => (args.length ? `${key}(${args.join('|')})` : key),
}));
vi.mock('../../logger', () => ({ logger: { warn: vi.fn() } }));

import * as vscodeApi from 'vscode';
import { resolveVisionMessages, type VisionResolveDeps } from './resolve';

type TestPart =
	| vscode.LanguageModelTextPart
	| vscode.LanguageModelDataPart
	| vscode.LanguageModelToolResultPart;

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose: () => {} }),
} as vscode.CancellationToken;

const cancelledToken = {
	isCancellationRequested: true,
	onCancellationRequested: () => ({ dispose: () => {} }),
} as vscode.CancellationToken;

function text(value: string): vscode.LanguageModelTextPart {
	return new vscodeApi.LanguageModelTextPart(value);
}

function image(bytes: number[] | Uint8Array, mimeType = 'image/png'): vscode.LanguageModelDataPart {
	return new vscodeApi.LanguageModelDataPart(
		bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
		mimeType,
	);
}

function message(
	content: TestPart[],
	role = vscodeApi.LanguageModelChatMessageRole.User,
): vscode.LanguageModelChatRequestMessage {
	return { role, content } as vscode.LanguageModelChatRequestMessage;
}

function contentOf(result: readonly vscode.LanguageModelChatRequestMessage[], index = 0): unknown[] {
	return result[index].content as unknown[];
}

function progress(): vscode.Progress<vscode.LanguageModelResponsePart> & { report: ReturnType<typeof vi.fn> } {
	return { report: vi.fn() };
}

interface AnalyzerCall {
	target: FlashAnalysisTarget;
	images: readonly VisionImage[];
	prompt: string;
	token: vscode.CancellationToken;
}

function analyzer(
	result: (call: AnalyzerCall, index: number) => Promise<string> | string = (_call, index) =>
		`description ${index + 1}`,
) {
	let target: FlashAnalysisTarget = {
		baseUrl: 'https://proxy.example/v4',
		modelId: 'mapped-flash',
	};
	const calls: AnalyzerCall[] = [];
	return {
		calls,
		setTarget(next: FlashAnalysisTarget) {
			target = next;
		},
		getTarget: () => target,
		analyze: vi.fn(async (
			callTarget: FlashAnalysisTarget,
			images: readonly VisionImage[],
			prompt: string,
			requestToken: vscode.CancellationToken,
		) => {
			const call = { target: callTarget, images, prompt, token: requestToken };
			calls.push(call);
			return result(call, calls.length - 1);
		}),
	};
}

function deps(
	imageAnalyzer: ReturnType<typeof analyzer>,
	nativeImageInput: boolean,
	cache = new VisionDescriptionCache(),
	promptValue = 'PROMPT',
): VisionResolveDeps {
	return {
		analyzer: imageAnalyzer,
		cache,
		nativeImageInput,
		prompt: promptValue,
	};
}

describe('image routing', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('leaves text-only messages untouched without resolving a Flash target', async () => {
		const imageAnalyzer = analyzer();
		const getTarget = vi.spyOn(imageAnalyzer, 'getTarget');
		const source = message([text('hello')]);

		const result = await resolveVisionMessages(deps(imageAnalyzer, false), [source], progress(), token);

		expect(result.messages[0]).toBe(source);
		expect(getTarget).not.toHaveBeenCalled();
		expect(imageAnalyzer.analyze).not.toHaveBeenCalled();
	});

	it('preserves ordered text and valid user images for a native model', async () => {
		const imageAnalyzer = analyzer();
		const first = image([1], 'image/png');
		const second = image([2], 'image/jpeg');
		const source = message([text('before'), first, text('between'), second, text('after')]);

		const result = await resolveVisionMessages(deps(imageAnalyzer, true), [source], progress(), token);

		expect(contentOf(result.messages)).toEqual([
			expect.objectContaining({ value: 'before' }),
			first,
			expect.objectContaining({ value: 'between' }),
			second,
			expect.objectContaining({ value: 'after' }),
		]);
		expect(imageAnalyzer.analyze).not.toHaveBeenCalled();
	});

	it('describes each contiguous image container once for a text model', async () => {
		const imageAnalyzer = analyzer();
		const status = progress();
		const source = message([
			text('before'),
			image([1]),
			image([2], 'image/jpeg'),
			text('between'),
			image([3]),
		]);

		const result = await resolveVisionMessages(
			deps(imageAnalyzer, false),
			[source],
			status,
			token,
		);

		expect(imageAnalyzer.calls).toHaveLength(2);
		expect(imageAnalyzer.calls[0].images.map((item) => item.data[0])).toEqual([1, 2]);
		expect(imageAnalyzer.calls[0].target).toEqual({
			baseUrl: 'https://proxy.example/v4',
			modelId: 'mapped-flash',
		});
		expect(imageAnalyzer.calls[0].prompt).toBe('PROMPT');
		expect(contentOf(result.messages).every((part) => !(part instanceof vscodeApi.LanguageModelDataPart))).toBe(true);
		expect((contentOf(result.messages)[1] as vscode.LanguageModelTextPart).value).toContain(
			'described by GLM-5.3-Flash',
		);
		expect((contentOf(result.messages)[1] as vscode.LanguageModelTextPart).value).toContain(
			'untrusted visual data',
		);
		expect(status.report).toHaveBeenCalledTimes(2);
	});

	it('always describes tool-result and non-user images, even for a native model', async () => {
		const imageAnalyzer = analyzer();
		const tool = new vscodeApi.LanguageModelToolResultPart('call-1', [
			text('tool text'),
			image([7]),
		]);
		const messages = [
			message([image([6])], vscodeApi.LanguageModelChatMessageRole.Assistant),
			message([tool]),
		];

		const result = await resolveVisionMessages(deps(imageAnalyzer, true), messages, progress(), token);

		expect(imageAnalyzer.calls).toHaveLength(2);
		expect(contentOf(result.messages, 0)[0]).toBeInstanceOf(vscodeApi.LanguageModelTextPart);
		const resolvedTool = contentOf(result.messages, 1)[0] as vscode.LanguageModelToolResultPart;
		expect(resolvedTool.content.some((part) => part instanceof vscodeApi.LanguageModelDataPart)).toBe(false);
		expect(
			(resolvedTool.content[1] as vscode.LanguageModelTextPart).value,
		).toContain('description 2');
	});

	it('reuses cache only when target, prompt, ordered MIME, and bytes match', async () => {
		const cache = new VisionDescriptionCache();
		const imageAnalyzer = analyzer();
		const source = message([image([1, 2], 'image/png')]);

		await resolveVisionMessages(deps(imageAnalyzer, false, cache, 'PROMPT'), [source], progress(), token);
		await resolveVisionMessages(deps(imageAnalyzer, false, cache, 'PROMPT'), [source], progress(), token);
		expect(imageAnalyzer.calls).toHaveLength(1);

		imageAnalyzer.setTarget({ baseUrl: 'https://other.example/v4', modelId: 'mapped-flash' });
		await resolveVisionMessages(deps(imageAnalyzer, false, cache, 'PROMPT'), [source], progress(), token);
		await resolveVisionMessages(deps(imageAnalyzer, false, cache, 'OTHER'), [source], progress(), token);
		await resolveVisionMessages(
			deps(imageAnalyzer, false, cache, 'OTHER'),
			[message([image([1, 2], 'image/jpeg')])],
			progress(),
			token,
		);
		expect(imageAnalyzer.calls).toHaveLength(4);
	});

	it('keeps valid containers usable when a later container has an unsupported image', async () => {
		const imageAnalyzer = analyzer();
		const result = await resolveVisionMessages(
			deps(imageAnalyzer, false),
			[message([image([0])]), message([image([1], 'image/gif')])],
			progress(),
			token,
		);

		expect(imageAnalyzer.calls).toHaveLength(1);
		expect((contentOf(result.messages, 0)[0] as vscode.LanguageModelTextPart).value).toContain(
			'description 1',
		);
		expect(contentOf(result.messages, 1)[0]).toEqual(
			expect.objectContaining({ value: IMAGE_DESCRIPTION_UNAVAILABLE }),
		);
		expect(result.failureNotice).toContain('vision.notice.failed');
	});

	it.each([
		['oversized image', [message([image(new Uint8Array(VISION_MAX_IMAGE_BYTES + 1))])]],
		[
			'too many images across the request',
			Array.from({ length: VISION_MAX_IMAGES_PER_REQUEST + 1 }, (_, index) =>
				message([image([index])]),
			),
		],
	])('rejects %s before native forwarding or Flash analysis', async (_name, messages) => {
		const imageAnalyzer = analyzer();
		const result = await resolveVisionMessages(
			deps(imageAnalyzer, false),
			messages,
			progress(),
			token,
		);

		expect(imageAnalyzer.analyze).not.toHaveBeenCalled();
		expect(result.failureNotice).toContain('vision.notice.failed');
		expect(contentOf(result.messages)[0]).toEqual(
			expect.objectContaining({ value: IMAGE_DESCRIPTION_UNAVAILABLE }),
		);
	});

	it('does not forward an invalid image through a native model', async () => {
		const imageAnalyzer = analyzer();
		const result = await resolveVisionMessages(
			deps(imageAnalyzer, true),
			[message([image([1], 'image/gif')])],
			progress(),
			token,
		);

		expect(contentOf(result.messages)[0]).toEqual(
			expect.objectContaining({ value: IMAGE_DESCRIPTION_UNAVAILABLE }),
		);
		expect(imageAnalyzer.analyze).not.toHaveBeenCalled();
	});

	it.each([
		['empty output', async () => ''],
		['missing chat key', async () => Promise.reject(new Error('vision.error.noKey'))],
		['unknown model 1211', async () => Promise.reject(new Error('1211 unknown model'))],
		['plan permission 1311', async () => Promise.reject(new Error('1311 permission denied'))],
		['rate limit exhausted', async () => Promise.reject(new Error('HTTP 429'))],
		['server retries exhausted', async () => Promise.reject(new Error('HTTP 503'))],
		['timeout', async () => Promise.reject(new FlashAnalysisTimeoutError())],
	])('continues with an unavailable marker after %s', async (_name, analyzeResult) => {
		const imageAnalyzer = analyzer(analyzeResult);
		const result = await resolveVisionMessages(
			deps(imageAnalyzer, false),
			[message([image([1])])],
			progress(),
			token,
		);

		expect(result.failureNotice).toContain('vision.notice.failed');
		expect(contentOf(result.messages)[0]).toEqual(
			expect.objectContaining({ value: IMAGE_DESCRIPTION_UNAVAILABLE }),
		);
	});

	it('propagates user cancellation instead of returning messages for the main model', async () => {
		const imageAnalyzer = analyzer();

		await expect(
			resolveVisionMessages(
				deps(imageAnalyzer, false),
				[message([image([1])])],
				progress(),
				cancelledToken,
			),
		).rejects.toBeInstanceOf(vscodeApi.CancellationError);
		expect(imageAnalyzer.analyze).not.toHaveBeenCalled();
	});
});
