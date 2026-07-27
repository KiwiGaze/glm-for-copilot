import { describe, expect, it } from 'vitest';
import { computeDescriptionCacheKey, VisionDescriptionCache, type VisionCacheMemento } from './cache';

function fakeMemento(): VisionCacheMemento & { store: Map<string, unknown> } {
	const store = new Map<string, unknown>();
	return {
		store,
		get<T>(key: string): T | undefined {
			return store.get(key) as T | undefined;
		},
		update(key: string, value: unknown): Thenable<void> {
			store.set(key, value);
			return Promise.resolve();
		},
	};
}

function image(bytes: number[], mimeType = 'image/png'): { mimeType: string; data: Uint8Array } {
	return { mimeType, data: new Uint8Array(bytes) };
}

describe('computeDescriptionCacheKey', () => {
	it('is stable for identical model, prompt, and image content', () => {
		const a = computeDescriptionCacheKey('glm-4.6v', 'prompt', [image([1, 2, 3])]);
		const b = computeDescriptionCacheKey('glm-4.6v', 'prompt', [image([1, 2, 3])]);
		expect(a).toBe(b);
	});

	it('changes when the describer model changes', () => {
		const base = computeDescriptionCacheKey('glm-4.6v', 'prompt', [image([1, 2, 3])]);
		expect(computeDescriptionCacheKey('glm-4.6v-flash', 'prompt', [image([1, 2, 3])])).not.toBe(base);
	});

	it('changes when the prompt changes', () => {
		const base = computeDescriptionCacheKey('glm-4.6v', 'prompt', [image([1, 2, 3])]);
		expect(computeDescriptionCacheKey('glm-4.6v', 'other', [image([1, 2, 3])])).not.toBe(base);
	});

	it('changes when image bytes or order change', () => {
		const a = image([1, 2, 3]);
		const b = image([9, 8, 7]);
		expect(computeDescriptionCacheKey('m', 'p', [a, b])).not.toBe(
			computeDescriptionCacheKey('m', 'p', [b, a]),
		);
		expect(computeDescriptionCacheKey('m', 'p', [image([1, 2, 3])])).not.toBe(
			computeDescriptionCacheKey('m', 'p', [image([1, 2, 4])]),
		);
	});
});

describe('VisionDescriptionCache', () => {
	it('returns undefined before a value is stored (miss) and the value after (hit)', async () => {
		const cache = new VisionDescriptionCache(fakeMemento());
		const key = computeDescriptionCacheKey('m', 'p', [image([1])]);
		expect(cache.get(key)).toBeUndefined();
		await cache.set(key, 'a description');
		expect(cache.get(key)).toBe('a description');
	});

	it('persists descriptions across instances (survives a window reload)', async () => {
		const memento = fakeMemento();
		const key = computeDescriptionCacheKey('m', 'p', [image([1])]);
		await new VisionDescriptionCache(memento).set(key, 'persisted description');

		const reloaded = new VisionDescriptionCache(memento);
		expect(reloaded.get(key)).toBe('persisted description');
	});

	it('ignores malformed persisted state', () => {
		const memento = fakeMemento();
		memento.store.set('glm-copilot.visionDescriptionCache', [42, ['ok', 'value'], null]);
		const cache = new VisionDescriptionCache(memento);
		expect(cache.get('ok')).toBe('value');
	});
});
