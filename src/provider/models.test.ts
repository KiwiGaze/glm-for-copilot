import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));
vi.mock('../i18n', () => ({
	t: (key: string) => key,
}));

import type { GLMModel } from '../types';
import { MODELS } from '../consts';
import { toChatInfo } from './models';

const MODEL = {
	id: 'glm-test',
	name: 'GLM Test',
	family: 'glm',
	version: '1',
	detail: 'Test model',
	maxInputTokens: 128_000,
	maxOutputTokens: 16_000,
	capabilities: {
		toolCalling: true,
		thinking: true,
		nativeImageInput: false,
	},
	availableIn: ['coding-plan'],
} satisfies GLMModel;

describe('toChatInfo', () => {
	it('advertises image input for models handled by the provider fallback', () => {
		const information = toChatInfo(MODEL, true);

		expect(information.capabilities?.imageInput).toBe(true);
	});

	it('advertises GLM-5.3 with its token limits and effort choices', () => {
		const model = MODELS.find((candidate) => candidate.id === 'glm-5.3');

		expect(model).toBeDefined();
		if (!model) {
			return;
		}

		const information = toChatInfo(model, true);

		expect(information).toMatchObject({
			id: 'glm-5.3',
			maxInputTokens: 1_000_000,
			maxOutputTokens: 128_000,
		});
		expect(information.configurationSchema?.properties.reasoningEffort).toMatchObject({
			enum: ['low', 'high', 'max'],
			default: 'max',
		});
	});

	it.each(['glm-5.3-flash', 'glm-5.4'])('advertises %s as a native multimodal model', (id) => {
		const model = MODELS.find((candidate) => candidate.id === id);

		expect(model).toMatchObject({
			maxInputTokens: 1_000_000,
			maxOutputTokens: 128_000,
			capabilities: {
				nativeImageInput: true,
				thinking: true,
				thinkingEffort: {
					levels: ['low', 'high', 'max'],
					default: 'max',
				},
			},
		});
	});
});
