import { describe, expect, it } from 'vitest';
import { VISION_CACHE_MAX } from '../../consts';
import { computeDescriptionCacheKey, hashImageContent, VisionDescriptionCache } from './cache';

function imageHash(bytes: number[]): string {
	return hashImageContent(new Uint8Array(bytes));
}

function key(
	prompt: string,
	images: Array<{ mimeType: string; contentHash: string }>,
	baseUrl = 'https://proxy.example/v4',
	modelId = 'mapped-flash',
): string {
	return computeDescriptionCacheKey({ baseUrl, modelId, prompt, images });
}

describe('computeDescriptionCacheKey', () => {
	it('is stable for identical prompt and image content', () => {
		const images = [{ mimeType: 'image/png', contentHash: imageHash([1, 2, 3]) }];
		const a = key('prompt', images);
		const b = key('prompt', images);
		expect(a).toBe(b);
	});

	it('changes when the prompt changes', () => {
		const images = [{ mimeType: 'image/png', contentHash: imageHash([1, 2, 3]) }];
		const base = key('prompt', images);
		expect(key('other', images)).not.toBe(base);
	});

	it('changes when the endpoint, mapped model, or MIME type changes', () => {
		const image = { mimeType: 'image/png', contentHash: imageHash([1, 2, 3]) };
		const base = key('prompt', [image]);

		expect(key('prompt', [image], 'https://other.example/v4')).not.toBe(base);
		expect(key('prompt', [image], undefined, 'other-flash')).not.toBe(base);
		expect(key('prompt', [{ ...image, mimeType: 'image/jpeg' }])).not.toBe(base);
	});

	it('does not collide when the prompt embeds a delimiter and an image hash', () => {
		const first = imageHash([1, 2, 3]);
		const second = imageHash([4, 5, 6]);
		expect(key(`p\0${first}`, [{ mimeType: 'image/png', contentHash: second }])).not.toBe(
			key('p', [
				{ mimeType: 'image/png', contentHash: first },
				{ mimeType: 'image/png', contentHash: second },
			]),
		);
	});

	it('changes when image bytes or order change', () => {
		const a = imageHash([1, 2, 3]);
		const b = imageHash([9, 8, 7]);
		expect(key('p', [
			{ mimeType: 'image/png', contentHash: a },
			{ mimeType: 'image/png', contentHash: b },
		])).not.toBe(key('p', [
			{ mimeType: 'image/png', contentHash: b },
			{ mimeType: 'image/png', contentHash: a },
		]));
		expect(key('p', [{ mimeType: 'image/png', contentHash: imageHash([1, 2, 3]) }])).not.toBe(
			key('p', [{ mimeType: 'image/png', contentHash: imageHash([1, 2, 4]) }]),
		);
	});
});

describe('VisionDescriptionCache', () => {
	it('returns undefined before a value is stored (miss) and the value after (hit)', () => {
		const cache = new VisionDescriptionCache();
		const cacheKey = key('p', [{ mimeType: 'image/png', contentHash: imageHash([1]) }]);
		expect(cache.get(cacheKey)).toBeUndefined();
		cache.set(cacheKey, 'a description');
		expect(cache.get(cacheKey)).toBe('a description');
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
