import { createHash, type Hash } from 'node:crypto';
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
 * `hashImageContent`), in order, each length-prefixed so no prompt content
 * can collide with a hash sequence. Because the prompt is part of the key,
 * changing it invalidates stale descriptions with no config listeners.
 */
export function computeDescriptionCacheKey(
	prompt: string,
	imageHashes: readonly string[],
): string {
	const hash = createHash('sha256');
	updateLengthPrefixed(hash, prompt);
	for (const imageHash of imageHashes) {
		updateLengthPrefixed(hash, imageHash);
	}
	return hash.digest('hex');
}

function updateLengthPrefixed(hash: Hash, value: string): void {
	hash.update(`${Buffer.byteLength(value)}:`);
	hash.update(value);
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

function remember(map: Map<string, string>, key: string, value: string, max: number): void {
	map.delete(key);
	map.set(key, value);
	while (map.size > max) {
		map.delete(map.keys().next().value!);
	}
}
