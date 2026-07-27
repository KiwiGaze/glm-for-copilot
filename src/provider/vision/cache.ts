import { createHash } from 'node:crypto';
import { VISION_CACHE_MAX } from '../../consts';

/** An image accepted by the vision pipeline: MIME type plus raw bytes. */
export interface VisionImage {
	mimeType: string;
	data: Uint8Array;
}

/**
 * SHA-256 hex digest of an image's bytes — the content-addressing convention
 * for cache keys and temp file names.
 */
export function hashImageContent(data: Uint8Array): string {
	return createHash('sha256').update(data).digest('hex');
}

/**
 * Content-addressed cache key: prompt + each image's content hash (from
 * `hashImageContent`), in order. Because the prompt is part of the key,
 * changing it invalidates stale descriptions with no config listeners.
 */
export function computeDescriptionCacheKey(
	prompt: string,
	imageHashes: readonly string[],
): string {
	const hash = createHash('sha256');
	hash.update(prompt);
	for (const imageHash of imageHashes) {
		hash.update('\0');
		hash.update(imageHash);
	}
	return hash.digest('hex');
}

/**
 * Bounded, content-addressed store of image descriptions (FIFO), kept in
 * memory only: transcripts may contain credentials or PII, so they are never
 * written to globalState. Session scope still avoids re-describing images
 * that repeat within the chat history.
 */
export class VisionDescriptionCache {
	private readonly entries = new Map<string, string>();

	get(key: string): string | undefined {
		return this.entries.get(key);
	}

	set(key: string, description: string): void {
		remember(this.entries, key, description, VISION_CACHE_MAX);
	}
}

/** Insert (or refresh) `key`, then evict oldest entries until `map` fits `max`. */
function remember(map: Map<string, string>, key: string, value: string, max: number): void {
	map.delete(key);
	map.set(key, value);
	while (map.size > max) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		map.delete(oldest);
	}
}
