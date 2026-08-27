import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => new Map<string, unknown>());

vi.mock('vscode', () => ({
	workspace: {
		getConfiguration: () => ({
			get<TValue>(key: string, fallback: TValue): TValue {
				return (settings.has(key) ? settings.get(key) : fallback) as TValue;
			},
		}),
	},
}));

vi.mock('./i18n', () => ({
	t: (key: string) => key,
}));

import { getCustomModels, listProviderModels } from './config';

describe('listProviderModels', () => {
	beforeEach(() => {
		settings.clear();
	});

	it('offers GLM-5.3 on the Coding Plan', () => {
		settings.set('apiMode', 'coding-plan');

		expect(listProviderModels().map((model) => model.id)).toContain('glm-5.3');
	});

	it('does not offer GLM-5.3 on the Standard API', () => {
		settings.set('apiMode', 'standard');

		expect(listProviderModels().map((model) => model.id)).not.toContain('glm-5.3');
	});

	it('offers GLM-5.3 through a custom endpoint in Standard API mode', () => {
		settings.set('apiMode', 'standard');
		settings.set('baseUrl', 'https://proxy.example.com/v4');

		expect(listProviderModels().map((model) => model.id)).toContain('glm-5.3');
	});

	it.each(['coding-plan', 'standard'])('offers GLM-5.3-Flash in %s mode', (apiMode) => {
		settings.set('apiMode', apiMode);

		expect(listProviderModels().map((model) => model.id)).toContain('glm-5.3-flash');
	});

	it('defaults custom models to text-only native input', () => {
		settings.set('customModels', [{ id: 'custom-text' }, { id: 'custom-vision', nativeImageInput: true }]);

		const models = getCustomModels();

		expect(models.find((model) => model.id === 'custom-text')?.capabilities.nativeImageInput).toBe(false);
		expect(models.find((model) => model.id === 'custom-vision')?.capabilities.nativeImageInput).toBe(true);
	});
});
