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
 * Content-addressed cache key for the effective Flash target, prompt, and each
 * ordered MIME/hash pair. Every field is length-prefixed to avoid boundary
 * collisions and to make endpoint, model mapping, or prompt changes invalidate
 * prior descriptions without configuration listeners.
 */
export interface VisionDescriptionCacheKeyInput {
	baseUrl: string;
	modelId: string;
	prompt: string;
	images: readonly {
		mimeType: string;
		contentHash: string;
	}[];
}

export function computeDescriptionCacheKey(input: VisionDescriptionCacheKeyInput): string {
	const hash = createHash('sha256');
	updateLengthPrefixed(hash, input.baseUrl);
	updateLengthPrefixed(hash, input.modelId);
	updateLengthPrefixed(hash, input.prompt);
	for (const image of input.images) {
		updateLengthPrefixed(hash, image.mimeType.toLowerCase());
		updateLengthPrefixed(hash, image.contentHash);
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
