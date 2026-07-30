import * as vscode from 'vscode';

/** Detect a proposed VS Code thinking part without importing its unavailable type. */
export function isThinkingPart(part: unknown): part is { value: string | string[] } {
	const ctor = (vscode as { LanguageModelThinkingPart?: unknown }).LanguageModelThinkingPart;
	return typeof ctor === 'function' && part instanceof (ctor as new (...args: never[]) => object);
}

/**
 * Report transient status text into the reasoning/thinking block. The thinking
 * part is a proposed VS Code API, so it is feature-detected before use; when it
 * is unavailable the status is dropped rather than leaking into the reply text.
 */
export function reportThinking(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	text: string,
): void {
	const ctor = (vscode as { LanguageModelThinkingPart?: new (value: string) => unknown })
		.LanguageModelThinkingPart;
	if (typeof ctor === 'function') {
		progress.report(new ctor(text) as vscode.LanguageModelResponsePart);
	}
}
