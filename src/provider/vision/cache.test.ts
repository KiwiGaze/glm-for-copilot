import { describe, expect, it } from 'vitest';
import { VISION_CACHE_MAX } from '../../consts';
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

	it('changes when the prompt changes', () => {
		const base = computeDescriptionCacheKey('prompt', [imageHash([1, 2, 3])]);
		expect(computeDescriptionCacheKey('other', [imageHash([1, 2, 3])])).not.toBe(base);
	});

	it('does not collide when the prompt embeds a delimiter and an image hash', () => {
		const first = imageHash([1, 2, 3]);
		const second = imageHash([4, 5, 6]);
		expect(computeDescriptionCacheKey(`p\0${first}`, [second])).not.toBe(
			computeDescriptionCacheKey('p', [first, second]),
		);
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
	it('returns undefined before a value is stored (miss) and the value after (hit)', () => {
		const cache = new VisionDescriptionCache();
		const key = computeDescriptionCacheKey('p', [imageHash([1])]);
		expect(cache.get(key)).toBeUndefined();
		cache.set(key, 'a description');
		expect(cache.get(key)).toBe('a description');
	});

	it('evicts the oldest entries once the bound is exceeded', () => {
		const cache = new VisionDescriptionCache();
		for (let index = 0; index < VISION_CACHE_MAX + 1; index += 1) {
			cache.set(`key-${index}`, `description ${index}`);
		}
		expect(cache.get('key-0')).toBeUndefined();
		expect(cache.get(`key-${VISION_CACHE_MAX}`)).toBe(`description ${VISION_CACHE_MAX}`);
	});
});
