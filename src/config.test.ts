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

	it('offers native GLM-5.3-FlashX only on the official Standard API', () => {
		settings.set('apiMode', 'coding-plan');
		expect(listProviderModels().map((model) => model.id)).not.toContain('glm-5.3-flashx');

		settings.set('apiMode', 'standard');
		const model = listProviderModels().find((item) => item.id === 'glm-5.3-flashx');
		expect(model?.capabilities.nativeImageInput).toBe(true);
		expect(model?.maxInputTokens).toBe(1_000_000);
		expect(model?.maxOutputTokens).toBe(128_000);

		settings.set('apiMode', 'coding-plan');
		settings.set('baseUrl', 'https://proxy.example.com/v4');
		expect(listProviderModels().map((item) => item.id)).toContain('glm-5.3-flashx');
	});

	it('lets a custom FlashX definition replace the built-in', () => {
		settings.set('apiMode', 'standard');
		settings.set('customModels', [{ id: 'glm-5.3-flashx', nativeImageInput: false }]);

		const matches = listProviderModels().filter((model) => model.id === 'glm-5.3-flashx');
		expect(matches).toHaveLength(1);
		expect(matches[0].capabilities.nativeImageInput).toBe(false);
	});

	it('defaults custom models to text-only native input', () => {
		settings.set('customModels', [{ id: 'custom-text' }, { id: 'custom-vision', nativeImageInput: true }]);

		const models = getCustomModels();

		expect(models.find((model) => model.id === 'custom-text')?.capabilities.nativeImageInput).toBe(false);
		expect(models.find((model) => model.id === 'custom-vision')?.capabilities.nativeImageInput).toBe(true);
	});
});
