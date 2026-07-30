import * as vscode from 'vscode';
import { VISION_ANALYZE_TOOL_SERVER_PATTERN } from './consts';

/**
 * Whether a tool from `vscode.lm.tools` is OUR vision server's `analyze_image`
 * tool. `vscode.lm.tools` is global across all servers and extensions, so the
 * name must carry either the official server name or the GLM Vision definition
 * label in addition to the `analyze_image` suffix and expected input shape —
 * otherwise another server's look-alike tool could receive the user's images.
 */
export function isVisionAnalyzeTool(tool: vscode.LanguageModelToolInformation): boolean {
	const name = tool.name.toLowerCase();
	if (!VISION_ANALYZE_TOOL_SERVER_PATTERN.test(name)) {
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
