import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ExtensionManifest {
	engines?: {
		vscode?: string;
	};
	contributes?: {
		configurationDefaults?: Record<string, unknown>;
	};
}

describe('extension manifest', () => {
	it('contributes GLM-5.3 as the host default', () => {
		const manifest = JSON.parse(
			readFileSync(join(__dirname, '../package.json'), 'utf8'),
		) as ExtensionManifest;

		expect(manifest.contributes?.configurationDefaults?.['chat.defaultModel']).toBe('glm-5.3');
		expect(manifest.engines?.vscode).toBe('^1.127.0');
	});
});
