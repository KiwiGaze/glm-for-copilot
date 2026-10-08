import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));
vi.mock('./i18n', () => ({ t: (key: string) => key }));

import { MODELS } from './consts';
import { toChatInfo } from './provider/models';

interface ExtensionManifest {
	engines?: {
		vscode?: string;
	};
	contributes?: {
		configurationDefaults?: Record<string, unknown>;
	};
}

describe('extension manifest', () => {
	it('resolves the contributed default in both native Chat and CLI model metadata', () => {
		const manifest = JSON.parse(
			readFileSync(join(__dirname, '../package.json'), 'utf8'),
		) as ExtensionManifest;

		const configured = manifest.contributes?.configurationDefaults?.['chat.defaultModel'];
		const chatModels = MODELS.map((model) => toChatInfo(model, true));
		const cliModels = chatModels.map((model) => ({
			...model, id: `glm/${model.id}`, family: `glm/${model.id}`,
		}));
		for (const models of [chatModels, cliModels]) {
			const match = models.find((model) => model.id === configured)
				?? models.find((model) => model.family === configured);
			expect(match?.name).toBe('GLM-5.3');
		}
		expect(manifest.engines?.vscode).toBe('^1.127.0');
	});
});
