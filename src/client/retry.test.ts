import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// retry.ts → ./errors → ../endpoint → ../config → 'vscode', and ../logger → ../config + vscode.window.
// Stub the vscode surface so module resolution + logger calls succeed under vitest.
vi.mock('vscode', () => ({
	workspace: { getConfiguration: () => ({ get: () => undefined }) },
	env: { language: 'en' },
	window: {
		createOutputChannel: () => ({
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {},
			show: () => {},
			dispose: () => {},
		}),
	},
}));

import {
	fetchChatCompletionWithRetry,
	isRetryableStatus,
	parseRetryAfterMs,
	computeBackoffDelay,
} from './retry';
import { GLMRequestError } from './errors';
import { RETRY_BASE_DELAY_MS, RETRY_MAX_ATTEMPTS, RETRY_MAX_DELAY_MS } from '../consts';

const URL = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const INIT: RequestInit = { method: 'POST', headers: {}, body: '{}' };
const BASE_URL = 'https://api.z.ai/api/coding/paas/v4';

function response(status: number, body = '', headers: Record<string, string> = {}): Response {
	return new Response(body, { status, headers });
}

/** Mock fetch that returns `responses` in order, throwing if exhausted. */
function seqFetch(responses: Response[]): typeof fetch {
	let i = 0;
	return vi.fn(async () => {
		if (i >= responses.length) {
			throw new Error(`mock fetch exhausted (requested attempt ${i + 1})`);
		}
		return responses[i++];
	}) as unknown as typeof fetch;
}

function fakeCancellationToken(): {
	token: import('vscode').CancellationToken;
	cancel: () => void;
} {
	const listeners: Array<() => void> = [];
	let cancelled = false;
	const token = {
		get isCancellationRequested(): boolean {
			return cancelled;
		},
		onCancellationRequested(listener: () => void) {
			listeners.push(listener);
			return { dispose: () => {
				const idx = listeners.indexOf(listener);
				if (idx >= 0) {
					listeners.splice(idx, 1);
				}
			} };
		},
	};
	return {
		token: token as unknown as import('vscode').CancellationToken,
		cancel: () => {
			if (cancelled) {
				return;
			}
			cancelled = true;
			listeners.slice().forEach((listener) => listener());
		},
	};
}

describe('isRetryableStatus', () => {
	it('retries 429 and the 5xx range', () => {
		expect(isRetryableStatus(429)).toBe(true);
		expect(isRetryableStatus(500)).toBe(true);
		expect(isRetryableStatus(502)).toBe(true);
		expect(isRetryableStatus(503)).toBe(true);
		expect(isRetryableStatus(504)).toBe(true);
		expect(isRetryableStatus(529)).toBe(true);
	});

	it('does not retry 4xx client errors or 2xx', () => {
		expect(isRetryableStatus(200)).toBe(false);
		expect(isRetryableStatus(400)).toBe(false);
		expect(isRetryableStatus(401)).toBe(false);
		expect(isRetryableStatus(402)).toBe(false);
		expect(isRetryableStatus(404)).toBe(false);
		expect(isRetryableStatus(422)).toBe(false);
	});
});

describe('parseRetryAfterMs', () => {
	it('reads retry-after-ms (milliseconds) first', () => {
		expect(parseRetryAfterMs(new Headers({ 'retry-after-ms': '750' }))).toBe(750);
	});

	it('falls back to Retry-After delta-seconds', () => {
		expect(parseRetryAfterMs(new Headers({ 'retry-after': '2' }))).toBe(2000);
	});

	it('parses Retry-After as an HTTP date', () => {
		// toUTCString() has 1-second resolution, so up to ~999ms is lost to truncation;
		// use a 5s window and a band that tolerates that loss.
		const date = new Date(Date.now() + 5000).toUTCString();
		const ms = parseRetryAfterMs(new Headers({ 'retry-after': date }));
		expect(ms).not.toBeUndefined();
		expect(ms!).toBeGreaterThanOrEqual(3500);
		expect(ms!).toBeLessThanOrEqual(5000);
	});

	it('clamps negative values to 0', () => {
		expect(parseRetryAfterMs(new Headers({ 'retry-after': '-5' }))).toBe(0);
	});

	it('returns undefined when no usable header is present', () => {
		expect(parseRetryAfterMs(new Headers())).toBeUndefined();
		expect(parseRetryAfterMs(new Headers({ 'retry-after': 'not-a-date-or-number' }))).toBeUndefined();
	});
});

describe('computeBackoffDelay', () => {
	it('starts exponential backoff at 1s', () => {
		expect(RETRY_BASE_DELAY_MS).toBe(1000);
	});

	it('honors the server Retry-After, capped at the max', () => {
		expect(computeBackoffDelay(0, 200)).toBe(200);
		expect(computeBackoffDelay(0, RETRY_MAX_DELAY_MS + 5000)).toBe(RETRY_MAX_DELAY_MS);
	});

	it('grows exponentially with attempt and stays within the jitter band', () => {
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		try {
			// factor = 0.8 + 0.5 * 0.4 = 1.0 → no jitter at midpoint
			expect(computeBackoffDelay(0)).toBe(RETRY_BASE_DELAY_MS * 2 ** 0);
			expect(computeBackoffDelay(1)).toBe(RETRY_BASE_DELAY_MS * 2 ** 1);
			expect(computeBackoffDelay(2)).toBe(RETRY_BASE_DELAY_MS * 2 ** 2);
		} finally {
			randomSpy.mockRestore();
		}
	});

	it('caps the exponential growth at RETRY_MAX_DELAY_MS', () => {
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		try {
			expect(computeBackoffDelay(20)).toBe(RETRY_MAX_DELAY_MS);
		} finally {
			randomSpy.mockRestore();
		}
	});

	it('keeps delays within [0.8×, 1.2×] of the base for the attempt', () => {
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
		try {
			expect(computeBackoffDelay(1)).toBe(Math.round(RETRY_BASE_DELAY_MS * 2 * 0.8));
		} finally {
			randomSpy.mockRestore();
		}
		const randomSpyHigh = vi.spyOn(Math, 'random').mockReturnValue(1);
		try {
			expect(computeBackoffDelay(1)).toBe(Math.round(RETRY_BASE_DELAY_MS * 2 * 1.2));
		} finally {
			randomSpyHigh.mockRestore();
		}
	});
});

describe('fetchChatCompletionWithRetry', () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('returns the response immediately on HTTP 200', async () => {
		const onRetryBackoff = vi.fn();
		const fetchImpl = seqFetch([response(200, 'ok')]);
		const res = await fetchChatCompletionWithRetry(URL, INIT, {
			baseUrl: BASE_URL,
			fetchImpl,
			onRetryBackoff,
		});
		expect(res.status).toBe(200);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(onRetryBackoff).not.toHaveBeenCalled();
	});

	it('retries HTTP 429 then succeeds', async () => {
		vi.useFakeTimers();
		const onRetryBackoff = vi.fn();
		const fetchImpl = seqFetch([response(429, 'rate limited'), response(200, 'ok')]);
		const promise = fetchChatCompletionWithRetry(URL, INIT, {
			baseUrl: BASE_URL,
			fetchImpl,
			onRetryBackoff,
		});
		await vi.runAllTimersAsync();
		const res = await promise;
		expect(res.status).toBe(200);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(onRetryBackoff).toHaveBeenCalledTimes(1);
		expect(onRetryBackoff).toHaveBeenCalledWith({
			status: 429,
			nextAttempt: 2,
			maxAttempts: RETRY_MAX_ATTEMPTS,
			delayMs: expect.any(Number),
		});
	});

	it('retries HTTP 503 then succeeds', async () => {
		vi.useFakeTimers();
		const onRetryBackoff = vi.fn();
		const fetchImpl = seqFetch([response(503, 'busy'), response(200, 'ok')]);
		const promise = fetchChatCompletionWithRetry(URL, INIT, {
			baseUrl: BASE_URL,
			fetchImpl,
			onRetryBackoff,
		});
		await vi.runAllTimersAsync();
		const res = await promise;
		expect(res.status).toBe(200);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(onRetryBackoff).toHaveBeenCalledWith(expect.objectContaining({
			status: 503,
			nextAttempt: 2,
		}));
	});

	it('does not retry HTTP 400 and throws a GLMRequestError', async () => {
		const onRetryBackoff = vi.fn();
		const fetchImpl = seqFetch([response(400, 'bad request')]);
		await expect(
			fetchChatCompletionWithRetry(URL, INIT, { baseUrl: BASE_URL, fetchImpl, onRetryBackoff }),
		).rejects.toMatchObject({ name: 'GLMRequestError', status: 400 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(onRetryBackoff).not.toHaveBeenCalled();
	});

	it('does not retry HTTP 401', async () => {
		const fetchImpl = seqFetch([response(401, 'unauthorized')]);
		await expect(
			fetchChatCompletionWithRetry(URL, INIT, { baseUrl: BASE_URL, fetchImpl }),
		).rejects.toMatchObject({ name: 'GLMRequestError', status: 401 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('throws a GLMRequestError with status 429 after exhausting all attempts', async () => {
		vi.useFakeTimers();
		expect(RETRY_MAX_ATTEMPTS).toBe(10);
		const fetchImpl = seqFetch(
			Array.from({ length: RETRY_MAX_ATTEMPTS }, () => response(429, 'rate limited')),
		);
		const promise = fetchChatCompletionWithRetry(URL, INIT, { baseUrl: BASE_URL, fetchImpl });
		// Attach a handler before flushing timers so the rejection isn't reported as unhandled.
		promise.catch(() => {});
		await vi.runAllTimersAsync();
		await expect(promise).rejects.toMatchObject({ name: 'GLMRequestError', status: 429 });
		expect(fetchImpl).toHaveBeenCalledTimes(RETRY_MAX_ATTEMPTS);
	});

	it('throws a GLMRequestError instance (not a plain Error)', async () => {
		const fetchImpl = seqFetch([response(400, 'bad request')]);
		try {
			await fetchChatCompletionWithRetry(URL, INIT, { baseUrl: BASE_URL, fetchImpl });
			throw new Error('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(GLMRequestError);
		}
	});

	it('honors the Retry-After delta-seconds header before retrying', async () => {
		vi.useFakeTimers();
		const fetchImpl = seqFetch([
			response(429, 'rate limited', { 'retry-after': '2' }),
			response(200, 'ok'),
		]);
		const promise = fetchChatCompletionWithRetry(URL, INIT, { baseUrl: BASE_URL, fetchImpl });
		// 2s must elapse before the second attempt fires.
		await vi.advanceTimersByTimeAsync(1999);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(10);
		const res = await promise;
		expect(res.status).toBe(200);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('honors retry-after-ms before retrying', async () => {
		vi.useFakeTimers();
		const onRetryBackoff = vi.fn();
		const fetchImpl = seqFetch([
			response(429, 'rate limited', { 'retry-after-ms': '750' }),
			response(200, 'ok'),
		]);
		const promise = fetchChatCompletionWithRetry(URL, INIT, {
			baseUrl: BASE_URL,
			fetchImpl,
			onRetryBackoff,
		});
		await vi.advanceTimersByTimeAsync(749);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(10);
		const res = await promise;
		expect(res.status).toBe(200);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(onRetryBackoff).toHaveBeenCalledWith(expect.objectContaining({
			delayMs: 750,
		}));
	});

	it('keeps retrying when the retry callback throws', async () => {
		vi.useFakeTimers();
		const onRetryBackoff = vi.fn(() => {
			throw new Error('observer failed');
		});
		const fetchImpl = seqFetch([response(429, 'rate limited'), response(200, 'ok')]);
		const promise = fetchChatCompletionWithRetry(URL, INIT, {
			baseUrl: BASE_URL,
			fetchImpl,
			onRetryBackoff,
		});
		await vi.runAllTimersAsync();
		const res = await promise;
		expect(res.status).toBe(200);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(onRetryBackoff).toHaveBeenCalledTimes(1);
	});

	it('uses exponential backoff with jitter when no Retry-After is present', async () => {
		vi.useFakeTimers();
		// Midpoint random → factor 1.0 → delays = base * 2^attempt (1000ms, then 2000ms).
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		try {
			const fetchImpl = seqFetch([
				response(429, 'rate limited'),
				response(429, 'rate limited'),
				response(200, 'ok'),
			]);
			const promise = fetchChatCompletionWithRetry(URL, INIT, { baseUrl: BASE_URL, fetchImpl });
			// First retry scheduled at 1000ms (base * 2^0).
			await vi.advanceTimersByTimeAsync(999);
			expect(fetchImpl).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(2);
			expect(fetchImpl).toHaveBeenCalledTimes(2);
			// Second retry scheduled 2000ms after the first (absolute 3000ms).
			await vi.advanceTimersByTimeAsync(1998);
			expect(fetchImpl).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(2);
			const res = await promise;
			expect(res.status).toBe(200);
			expect(fetchImpl).toHaveBeenCalledTimes(3);
		} finally {
			randomSpy.mockRestore();
		}
	});

	it('rejects with AbortError when the cancellation token fires during backoff sleep', async () => {
		vi.useFakeTimers();
		const { token, cancel } = fakeCancellationToken();
		const fetchImpl = seqFetch([response(429, 'rate limited'), response(200, 'ok')]);
		const promise = fetchChatCompletionWithRetry(URL, INIT, {
			baseUrl: BASE_URL,
			cancellationToken: token,
			fetchImpl,
		});
		// Let the first fetch resolve and the backoff sleep be scheduled, but don't fire it.
		await vi.advanceTimersByTimeAsync(1);
		cancel();
		await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('rejects with AbortError without fetching when already cancelled', async () => {
		const { token, cancel } = fakeCancellationToken();
		const fetchImpl = seqFetch([response(200, 'ok')]);
		cancel();
		await expect(
			fetchChatCompletionWithRetry(URL, INIT, {
				baseUrl: BASE_URL,
				cancellationToken: token,
				fetchImpl,
			}),
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
