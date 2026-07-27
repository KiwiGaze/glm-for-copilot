import { createHash } from 'node:crypto';
import { VISION_CACHE_PERSIST_MAX, VISION_CACHE_STATE_KEY } from '../../consts';

/** Minimal subset of `vscode.Memento` used for persistence (injectable for tests). */
export interface VisionCacheMemento {
	get<T>(key: string): T | undefined;
	update(key: string, value: unknown): Thenable<void>;
}

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

type PersistedEntry = [key: string, description: string];

/**
 * Bounded, content-addressed store of image descriptions backed by
 * `globalState` (FIFO), so descriptions survive window reloads and historical
 * images are never silently re-described.
 */
export class VisionDescriptionCache {
	private readonly persisted = new Map<string, string>();

	constructor(private readonly memento: VisionCacheMemento) {
		const stored = memento.get<PersistedEntry[]>(VISION_CACHE_STATE_KEY) ?? [];
		for (const entry of stored) {
			if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
				this.persisted.set(entry[0], entry[1]);
			}
		}
	}

	get(key: string): string | undefined {
		return this.persisted.get(key);
	}

	async set(key: string, description: string): Promise<void> {
		remember(this.persisted, key, description, VISION_CACHE_PERSIST_MAX);
		await this.memento.update(VISION_CACHE_STATE_KEY, [...this.persisted.entries()]);
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
