import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { isVisionAnalyzeTool } from './vision-tool';
import type * as vscode from 'vscode';

function tool(name: string, properties?: Record<string, unknown>): vscode.LanguageModelToolInformation {
	return {
		name,
		description: '',
		inputSchema: properties ? { properties } : undefined,
		tags: [],
	} as vscode.LanguageModelToolInformation;
}

const VISION_SCHEMA = { image_source: {}, prompt: {} };

describe('isVisionAnalyzeTool', () => {
	it('matches the VS Code-prefixed MCP tool name with the expected schema', () => {
		expect(isVisionAnalyzeTool(tool('mcp_glm_vision_analyze_image', VISION_SCHEMA))).toBe(true);
		expect(isVisionAnalyzeTool(tool('mcp_zai_mcp_server_analyze_image', VISION_SCHEMA))).toBe(true);
	});

	it('matches label-slug separator variants', () => {
		expect(isVisionAnalyzeTool(tool('mcp_glm-vision_analyze_image', VISION_SCHEMA))).toBe(true);
		expect(isVisionAnalyzeTool(tool('GLM Vision: analyze_image', VISION_SCHEMA))).toBe(true);
	});

	it('rejects tools without the expected input shape', () => {
		expect(isVisionAnalyzeTool(tool('mcp_glm_vision_analyze_image', { file: {} }))).toBe(false);
		expect(isVisionAnalyzeTool(tool('mcp_glm_vision_analyze_image'))).toBe(false);
	});

	it('rejects another server\'s analyze_image tool even with an identical schema', () => {
		expect(isVisionAnalyzeTool(tool('analyze_image', VISION_SCHEMA))).toBe(false);
		expect(isVisionAnalyzeTool(tool('mcp_other_vision_ext_analyze_image', VISION_SCHEMA))).toBe(false);
		expect(isVisionAnalyzeTool(tool('mcp_other_glm_vision_analyze_image', VISION_SCHEMA))).toBe(false);
		expect(isVisionAnalyzeTool(tool('mcp_other_zai_mcp_server_analyze_image', VISION_SCHEMA))).toBe(false);
	});

	it('rejects look-alike servers that only start with the GLM Vision name', () => {
		expect(isVisionAnalyzeTool(tool('mcp_glm_vision_evil_analyze_image', VISION_SCHEMA))).toBe(false);
		expect(isVisionAnalyzeTool(tool('mcp_glm_visionary_analyze_image', VISION_SCHEMA))).toBe(false);
	});

	it('rejects other tools, including similarly named ones', () => {
		expect(isVisionAnalyzeTool(tool('mcp_glm_vision_analyze_video', VISION_SCHEMA))).toBe(false);
		expect(isVisionAnalyzeTool(tool('analyze_images', VISION_SCHEMA))).toBe(false);
		expect(isVisionAnalyzeTool(tool('mcp_github_get_issue', VISION_SCHEMA))).toBe(false);
	});
});
