import { describe, expect, it } from 'vitest';
import { fakeMemento } from '../../test-helpers';
import { computeDescriptionCacheKey, hashImageContent, VisionDescriptionCache } from './cache';

function imageHash(bytes: number[]): string {
	return hashImageContent(new Uint8Array(bytes));
}

describe('computeDescriptionCacheKey', () => {
	it('is stable for identical prompt and image content', () => {
		const a = computeDescriptionCacheKey('prompt', [imageHash([1, 2, 3])]);
		const b = computeDescriptionCacheKey('prompt', [imageHash([1, 2, 3])]);
		expect(a).toBe(b);
	});

	it('matches the pinned persisted format, so stored descriptions stay valid across upgrades', () => {
		expect(computeDescriptionCacheKey('prompt', [imageHash([1, 2, 3])])).toBe(
			'0bbbe1413dec4f7e336823c82e0f68315b16db8226323efe2c150f86f0ea0d7b',
		);
	});

	it('changes when the prompt changes', () => {
		const base = computeDescriptionCacheKey('prompt', [imageHash([1, 2, 3])]);
		expect(computeDescriptionCacheKey('other', [imageHash([1, 2, 3])])).not.toBe(base);
	});

	it('changes when image bytes or order change', () => {
		const a = imageHash([1, 2, 3]);
		const b = imageHash([9, 8, 7]);
		expect(computeDescriptionCacheKey('p', [a, b])).not.toBe(computeDescriptionCacheKey('p', [b, a]));
		expect(computeDescriptionCacheKey('p', [imageHash([1, 2, 3])])).not.toBe(
			computeDescriptionCacheKey('p', [imageHash([1, 2, 4])]),
		);
	});
});

describe('VisionDescriptionCache', () => {
	it('returns undefined before a value is stored (miss) and the value after (hit)', async () => {
		const cache = new VisionDescriptionCache(fakeMemento());
		const key = computeDescriptionCacheKey('p', [imageHash([1])]);
		expect(cache.get(key)).toBeUndefined();
		await cache.set(key, 'a description');
		expect(cache.get(key)).toBe('a description');
	});

	it('persists descriptions across instances (survives a window reload)', async () => {
		const memento = fakeMemento();
		const key = computeDescriptionCacheKey('p', [imageHash([1])]);
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
