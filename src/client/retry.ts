import type * as vscode from 'vscode';
import { RETRY_BASE_DELAY_MS, RETRY_MAX_ATTEMPTS, RETRY_MAX_DELAY_MS } from '../consts';
import { logger } from '../logger';
import type { RetryBackoffInfo } from '../types';
import { createHttpError, isAbortError, normalizeRequestError } from './errors';

/** HTTP statuses that are worth retrying: rate limits and transient server errors. */
export function isRetryableStatus(status: number): boolean {
	return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Parse the `Retry-After` header (delta-seconds or HTTP-date) and `retry-after-ms`
 * into milliseconds. Returns `undefined` when no usable value is present.
 */
export function parseRetryAfterMs(headers: Headers): number | undefined {
	const msHeader = headers.get('retry-after-ms');
	if (msHeader !== null) {
		const ms = Number(msHeader);
		if (Number.isFinite(ms)) {
			return Math.max(0, ms);
		}
	}
	const retryAfter = headers.get('retry-after');
	if (retryAfter !== null) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds)) {
			return Math.max(0, seconds * 1000);
		}
		const dateMs = Date.parse(retryAfter);
		if (!Number.isNaN(dateMs)) {
			return Math.max(0, dateMs - Date.now());
		}
	}
	return undefined;
}

/**
 * Backoff delay for a given 0-based attempt. Honors the server's `Retry-After`
 * when present; otherwise uses exponential backoff with ±20% jitter, capped at
 * `RETRY_MAX_DELAY_MS`.
 */
export function computeBackoffDelay(
	attempt: number,
	retryAfterMs?: number,
): number {
	if (retryAfterMs !== undefined) {
		return Math.min(retryAfterMs, RETRY_MAX_DELAY_MS);
	}
	const base = RETRY_BASE_DELAY_MS * 2 ** attempt;
	const jittered = base * (0.8 + Math.random() * 0.4);
	return Math.min(Math.round(jittered), RETRY_MAX_DELAY_MS);
}

export interface FetchWithRetryOptions {
	baseUrl: string;
	cancellationToken?: vscode.CancellationToken;
	/** Test seam; defaults to the global `fetch`. */
	fetchImpl?: typeof fetch;
	onRetryBackoff?: (info: RetryBackoffInfo) => void;
}

/**
 * Fetch a chat-completion response, retrying transient failures (HTTP 429 / 5xx)
 * with exponential backoff and jitter before returning. Retries happen only
 * before any response body is streamed, so no partial output is ever replayed.
 *
 * Non-retryable HTTP responses and exhausted retries throw a `GLMRequestError`
 * via `createHttpError`; transport errors are normalized via `normalizeRequestError`.
 * Cancellation during a backoff sleep rejects with an `AbortError`.
 */
export async function fetchChatCompletionWithRetry(
	url: string,
	init: RequestInit,
	options: FetchWithRetryOptions,
): Promise<Response> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const maxAttempts = RETRY_MAX_ATTEMPTS;
	const token = options.cancellationToken;
	for (let attempt = 0; ; attempt++) {
		if (token?.isCancellationRequested) {
			throw abortError();
		}
		let response: Response;
		try {
			response = await fetchImpl(url, init);
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			throw normalizeRequestError(error, { baseUrl: options.baseUrl });
		}
		if (response.ok) {
			return response;
		}
		const canRetry = isRetryableStatus(response.status) && attempt < maxAttempts - 1;
		if (!canRetry) {
			throw await createHttpError(response, { baseUrl: options.baseUrl });
		}
		const retryAfterMs = parseRetryAfterMs(response.headers);
		const delay = computeBackoffDelay(attempt, retryAfterMs);
		notifyRetryBackoff(options.onRetryBackoff, {
			status: response.status,
			nextAttempt: attempt + 2,
			maxAttempts,
			delayMs: delay,
		});
		logger.warn(
			`GLM API returned HTTP ${response.status} on attempt ${attempt + 1}/${maxAttempts}; retrying in ${delay}ms`,
		);
		await response.body?.cancel().catch(() => {});
		await sleepWithCancellation(delay, token);
	}
}

function notifyRetryBackoff(
	callback: ((info: RetryBackoffInfo) => void) | undefined,
	info: RetryBackoffInfo,
): void {
	if (!callback) {
		return;
	}
	try {
		callback(info);
	} catch (error) {
		logger.warn('Retry backoff observer failed', error);
	}
}

function sleepWithCancellation(
	ms: number,
	token?: vscode.CancellationToken,
): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}
	return new Promise<void>((resolve, reject) => {
		if (!token) {
			setTimeout(resolve, ms);
			return;
		}
		if (token.isCancellationRequested) {
			reject(abortError());
			return;
		}
		const timer = setTimeout(() => {
			listener.dispose();
			resolve();
		}, ms);
		const listener = token.onCancellationRequested(() => {
			clearTimeout(timer);
			reject(abortError());
		});
	});
}

function abortError(): Error {
	const error = new Error('The operation was aborted.');
	error.name = 'AbortError';
	return error;
}
