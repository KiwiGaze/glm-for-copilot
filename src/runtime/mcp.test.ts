import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));
vi.mock('../config', () => ({ getRegion: () => 'international' }));
vi.mock('../logger', () => ({ logger: { warn: vi.fn() } }));

import { buildVisionMcpServerSpec } from './mcp';

describe('buildVisionMcpServerSpec', () => {
	it('uses plain npx and ZAI mode for the international region', () => {
		const spec = buildVisionMcpServerSpec({ region: 'international', platform: 'darwin' });
		expect(spec.label).toBe('GLM Vision');
		expect(spec.command).toBe('npx');
		expect(spec.args).toEqual(['-y', '@z_ai/mcp-server@latest']);
		expect(spec.env).toEqual({ Z_AI_MODE: 'ZAI' });
	});

	it('uses ZHIPU mode for the China region', () => {
		const spec = buildVisionMcpServerSpec({ region: 'china', platform: 'linux' });
		expect(spec.env).toEqual({ Z_AI_MODE: 'ZHIPU' });
	});

	it('wraps npx in cmd.exe /c on Windows', () => {
		const spec = buildVisionMcpServerSpec({ region: 'china', platform: 'win32' });
		expect(spec.command).toBe('cmd.exe');
		expect(spec.args).toEqual(['/c', 'npx', '-y', '@z_ai/mcp-server@latest']);
		expect(spec.env).toEqual({ Z_AI_MODE: 'ZHIPU' });
	});

	it('never embeds the API key in the base spec (injected only when the server starts)', () => {
		const spec = buildVisionMcpServerSpec({ region: 'international', platform: 'darwin' });
		expect(JSON.stringify(spec)).not.toContain('Z_AI_API_KEY');
	});
});
