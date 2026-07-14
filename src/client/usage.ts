import { USAGE_PATHS, USAGE_REQUEST_TIMEOUT_MS } from '../consts';
import type { UsageMetric, UsageSnapshot, UsageStatus } from '../types';
import { createHttpError, isAbortError, normalizeRequestError } from './errors';

interface ZaiLimit {
	type?: string;
	name?: string;
	unit?: number;
	usage?: number;
	currentValue?: number;
	percentage?: number;
	nextResetTime?: number;
	remaining?: number;
}

interface ZaiQuotaResponse {
	code?: number;
	data?: { limits?: ZaiLimit[] } | ZaiLimit[];
}

interface ZaiSubscriptionResponse {
	data?: Array<{ productName?: string; nextRenewTime?: string }>;
}

export interface IUsageClient {
	fetchSnapshot(apiKey: string, signal?: AbortSignal): Promise<UsageSnapshot>;
}

/**
 * z.ai Coding Plan usage client. Two sequential GETs against the (reverse-engineered,
 * undocumented) usage endpoints. Subscription failure is swallowed; quota failure sets status.
 *
 * Both stations (z.ai international + open.bigmodel.cn china) share the same paths and JSON
 * shape; only the host and Authorization header differ. The China monitor endpoint authenticates
 * with the RAW API key (no `Bearer` prefix), while z.ai uses `Bearer {key}`. The scheme is detected
 * from the request URL (which carries the region host).
 *
 * The host is resolved on EVERY `fetchSnapshot` call (via `resolveHost`) rather than captured at
 * construction, so the bar follows `glm-copilot.region` changes without recreating the client. A
 * static string is still accepted (normalized to a constant resolver) for convenience in tests. The
 * region is resolved once per snapshot so the subscription + quota sub-requests always hit one host.
 */
export class UsageClient implements IUsageClient {
	private readonly resolveHost: () => string;

	constructor(
		hostOrResolver: string | (() => string),
		private readonly fetchImpl: typeof fetch = fetch,
	) {
		this.resolveHost = typeof hostOrResolver === 'string' ? () => hostOrResolver : hostOrResolver;
	}

	async fetchSnapshot(apiKey: string, signal?: AbortSignal): Promise<UsageSnapshot> {
		const host = this.resolveHost();
		const [subscription, snapshot] = await Promise.all([
			this.fetchSubscription(host, apiKey, signal),
			this.fetchQuota(host, apiKey, signal),
		]);
		return { ...snapshot, ...subscription };
	}

	private async fetchSubscription(
		host: string,
		apiKey: string,
		signal?: AbortSignal,
	): Promise<{ planName?: string; renewsAt?: string }> {
		try {
			const response = await this.get(`${host}${USAGE_PATHS.subscription}`, apiKey, signal);
			if (!response.ok) {
				return {};
			}
			const data = (await response.json()) as ZaiSubscriptionResponse;
			const first = data?.data?.[0];
			if (!first) {
				return {};
			}
			return {
				planName: first.productName,
				renewsAt: first.nextRenewTime,
			};
		} catch {
			return {};
		}
	}

	private async fetchQuota(host: string, apiKey: string, signal?: AbortSignal): Promise<UsageSnapshot> {
		const fetchedAt = Date.now();
		let response: Response;
		try {
			response = await this.get(`${host}${USAGE_PATHS.quota}`, apiKey, signal);
		} catch (error) {
			// Re-throw aborts so the caller (UsageStatusBar) can swallow+log them per spec §7.2
			// instead of rendering a server-error snapshot for a cancellation it caused.
			if (isAbortError(error)) {
				throw error;
			}
			return this.toErrorSnapshot(error, host, fetchedAt);
		}
		if (!response.ok) {
			const error = await createHttpError(response, { baseUrl: host });
			return this.toErrorSnapshot(error, host, fetchedAt);
		}
		let parsed: ZaiQuotaResponse;
		try {
			parsed = (await response.json()) as ZaiQuotaResponse;
		} catch {
			return { status: 'server-error', metrics: [], fetchedAt };
		}
		const limits = extractLimits(parsed);
		if (!Array.isArray(limits) || limits.length === 0) {
			return { status: 'no-data', metrics: [], fetchedAt };
		}
		const metrics = buildMetrics(limits);
		if (metrics.length === 0) {
			return { status: 'no-data', metrics: [], fetchedAt };
		}
		return { status: 'ok', metrics, fetchedAt };
	}

	private async get(url: string, apiKey: string, signal?: AbortSignal): Promise<Response> {
		const controller = new AbortController();
		let didTimeout = false;
		if (signal?.aborted) {
			controller.abort();
		}
		const timer = setTimeout(() => {
			didTimeout = true;
			controller.abort();
		}, USAGE_REQUEST_TIMEOUT_MS);
		timer.unref?.();
		const onCallerAbort = () => controller.abort();
		signal?.addEventListener('abort', onCallerAbort, { once: true });
		try {
			return await this.fetchImpl(url, {
				method: 'GET',
				headers: {
					Authorization: this.authHeader(url, apiKey),
					Accept: 'application/json',
				},
				signal: controller.signal,
			});
		} catch (error) {
			if (didTimeout && isAbortError(error)) {
				throw Object.assign(new TypeError('fetch timed out'), {
					cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
				});
			}
			throw error;
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onCallerAbort);
		}
	}

	private authHeader(url: string, apiKey: string): string {
		return url.includes('bigmodel.cn') ? apiKey : `Bearer ${apiKey}`;
	}

	private toErrorSnapshot(error: unknown, host: string, fetchedAt: number): UsageSnapshot {
		const normalized = normalizeRequestError(error, { baseUrl: host });
		let status: UsageStatus;
		if (normalized instanceof Error && 'kind' in normalized) {
			const kind = (normalized as { kind: string }).kind;
			const httpStatus = (normalized as { status?: number }).status;
			if (kind === 'http' && (httpStatus === 401 || httpStatus === 403)) {
				status = 'auth-error';
			} else if (kind === 'http') {
				status = 'server-error';
			} else if (kind === 'network') {
				status = 'network-error';
			} else {
				status = 'server-error';
			}
		} else {
			status = 'server-error';
		}
		return { status, metrics: [], fetchedAt };
	}
}

function extractLimits(response: ZaiQuotaResponse): ZaiLimit[] | undefined {
	const container = response.data ?? response;
	if (Array.isArray(container)) {
		return container;
	}
	return (container as { limits?: ZaiLimit[] }).limits;
}

/**
 * Ported verbatim from openusage plugins/zai/plugin.js findLimit. Matches by `type || name`;
 * filters by `unit` when supplied; the first matching entry whose `unit` is undefined is the
 * fallback.
 */
function findLimit(limits: ZaiLimit[], type: string, unit?: number): ZaiLimit | null {
	let fallback: ZaiLimit | null = null;
	for (const item of limits) {
		if (item.type === type || item.name === type) {
			if (unit === undefined) {
				return item;
			}
			if (item.unit === unit) {
				return item;
			}
			if (fallback === null && item.unit === undefined) {
				fallback = item;
			}
		}
	}
	return fallback;
}

function numberOr(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nextUtcFirstOfMonthMs(now: Date = new Date()): number {
	return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

function buildMetrics(limits: ZaiLimit[]): UsageMetric[] {
	const metrics: UsageMetric[] = [];
	const session = findLimit(limits, 'TOKENS_LIMIT', 3);
	if (session) {
		metrics.push({
			kind: 'session',
			used: numberOr(session.percentage),
			limit: 100,
			resetsAt: session.nextResetTime,
		});
	}
	const weekly = findLimit(limits, 'TOKENS_LIMIT', 6);
	if (weekly) {
		metrics.push({
			kind: 'weekly',
			used: weekly.percentage !== undefined && Number.isFinite(weekly.percentage) ? weekly.percentage : 0,
			limit: 100,
			resetsAt: weekly.nextResetTime,
		});
	}
	const time = findLimit(limits, 'TIME_LIMIT');
	if (time) {
		metrics.push({
			kind: 'web-searches',
			used: numberOr(time.currentValue),
			limit: numberOr(time.usage),
			resetsAt: time.nextResetTime ?? nextUtcFirstOfMonthMs(),
		});
	}
	return metrics;
}
