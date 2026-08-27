import { describe, expect, it, vi } from 'vitest';

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
	class LanguageModelToolCallPart {}
	class LanguageModelThinkingPart {}
	return {
		LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
		LanguageModelTextPart,
		LanguageModelDataPart,
		LanguageModelToolResultPart,
		LanguageModelToolCallPart,
		LanguageModelThinkingPart,
	};
});

import * as vscode from 'vscode';
import type { GLMMessage } from '../types';
import { convertMessages, countMessageChars } from './convert';

function message(
	role: vscode.LanguageModelChatMessageRole,
	content: vscode.LanguageModelInputPart[],
): vscode.LanguageModelChatRequestMessage {
	return { role, content, name: undefined };
}

describe('convertMessages', () => {
	it('preserves the order of user text and images in native multimodal content', () => {
		const messages = convertMessages(
			[
				message(vscode.LanguageModelChatMessageRole.User, [
					new vscode.LanguageModelTextPart('before'),
					new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3]), 'image/png'),
					new vscode.LanguageModelTextPart('after'),
					new vscode.LanguageModelDataPart(new Uint8Array([255]), 'IMAGE/JPEG'),
				]),
			],
			true,
			true,
		);

		expect(messages).toEqual([
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'before' },
					{ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
					{ type: 'text', text: 'after' },
					{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/w==' } },
				],
			},
		]);
	});

	it('keeps text-only content as a string', () => {
		const messages = convertMessages(
			[message(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('hello')])],
			false,
			false,
		);

		expect(messages).toEqual([{ role: 'user', content: 'hello' }]);
	});

	it('rejects user images when the selected model has no native image input', () => {
		const input = message(vscode.LanguageModelChatMessageRole.User, [
			new vscode.LanguageModelDataPart(new Uint8Array([1]), 'image/png'),
		]);

		expect(() => convertMessages([input], false, false)).toThrow(/without a supported native user-image route/);
	});

	it.each([
		['assistant', vscode.LanguageModelChatMessageRole.Assistant],
		['system', 3 as vscode.LanguageModelChatMessageRole],
	])('rejects images that remain in %s messages', (_, role) => {
		const input = message(role, [
			new vscode.LanguageModelDataPart(new Uint8Array([1]), 'image/png'),
		]);

		expect(() => convertMessages([input], false, true)).toThrow(/without a supported native user-image route/);
	});

	it('rejects images that remain inside tool results', () => {
		const input = message(vscode.LanguageModelChatMessageRole.User, [
			new vscode.LanguageModelToolResultPart('call-1', [
				new vscode.LanguageModelDataPart(new Uint8Array([1]), 'image/png'),
			]),
		]);

		expect(() => convertMessages([input], false, true)).toThrow(/inside a tool result/);
	});
});

describe('countMessageChars', () => {
	it('counts multimodal text without counting Base64 image payloads', () => {
		const messages: GLMMessage[] = [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'visible text' },
					{ type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(10_000)}` } },
				],
			},
		];

		expect(countMessageChars(messages)).toBe('visible text'.length);
	});
});
