import * as vscode from 'vscode';

interface ImagePartRun {
	images: vscode.LanguageModelDataPart[];
	nextIndex: number;
}

/** Whether the part is a `LanguageModelDataPart` holding image bytes. */
export function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType.toLowerCase().startsWith('image/');
}

/** Collect one contiguous image container starting at `startIndex`. */
export function collectImagePartRun(
	parts: readonly unknown[],
	startIndex: number,
): ImagePartRun {
	const images: vscode.LanguageModelDataPart[] = [];
	let nextIndex = startIndex;
	while (nextIndex < parts.length) {
		const part = parts[nextIndex];
		if (!isImageDataPart(part)) {
			break;
		}
		images.push(part);
		nextIndex += 1;
	}
	return { images, nextIndex };
}
