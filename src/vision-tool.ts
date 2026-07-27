import * as vscode from 'vscode';
import { VISION_ANALYZE_TOOL_LABEL_PATTERN, VISION_ANALYZE_TOOL_SUFFIX } from './consts';

/**
 * Whether a tool from `vscode.lm.tools` is OUR vision server's `analyze_image`
 * tool. `vscode.lm.tools` is global across all servers and extensions, so the
 * name must carry the GLM Vision label slug (VS Code builds MCP tool names from
 * the server label, e.g. `mcp_glm_vision_analyze_image`) in addition to the
 * `analyze_image` suffix and the expected input shape — otherwise another
 * server's look-alike tool could receive the user's image files.
 */
export function isVisionAnalyzeTool(tool: vscode.LanguageModelToolInformation): boolean {
	const name = tool.name.toLowerCase();
	if (!name.endsWith(VISION_ANALYZE_TOOL_SUFFIX) || !VISION_ANALYZE_TOOL_LABEL_PATTERN.test(name)) {
		return false;
	}
	const properties = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)
		?.properties;
	return properties !== undefined && 'image_source' in properties && 'prompt' in properties;
}

/** Live lookup of the vision `analyze_image` tool among VS Code's current tools. */
export function findVisionAnalyzeTool(): vscode.LanguageModelToolInformation | undefined {
	return vscode.lm.tools.find(isVisionAnalyzeTool);
}
