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
	},
	availableIn: ['coding-plan'],
} satisfies GLMModel;

describe('toChatInfo', () => {
	it('advertises image input when GLM Vision is installed and enabled', () => {
		const information = toChatInfo(MODEL, true, true);

		expect(information.capabilities?.imageInput).toBe(true);
	});

	it('does not advertise image input when GLM Vision is not enabled', () => {
		const information = toChatInfo(MODEL, true, false);

		expect(information.capabilities?.imageInput).toBe(false);
	});

	it('advertises GLM-5.3 with its token limits and effort choices', () => {
		const model = MODELS.find((candidate) => candidate.id === 'glm-5.3');

		expect(model).toBeDefined();
		if (!model) {
			return;
		}

		const information = toChatInfo(model, true, false);

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
});
