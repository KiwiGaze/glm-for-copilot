import { BALANCE_PATHS, USAGE_PATHS, USAGE_REQUEST_TIMEOUT_MS } from '../consts';
import type { TokenPackage, UsageBalance, UsageMetric, UsageSnapshot, UsageStatus } from '../types';
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

interface BigmodelAccountReport {
	success?: boolean;
	data?: {
		balance?: number;
		rechargeAmount?: number;
		giveAmount?: number;
		totalSpendAmount?: number;
		frozenBalance?: number;
		availableBalance?: number;
	};
}

interface BigmodelTokenAccount {
	tokenBalance?: number;
	tokensMagnitude?: number;
	status?: string;
	resourcePackageName?: string;
	suitableModel?: string;
}

interface BigmodelTokenAccountsResponse {
	code?: number;
	rows?: BigmodelTokenAccount[];
}

/** Contract for the usage/balance client used by {@link UsageStatusBar}. */
export interface IUsageClient {
	/** Fetch Coding Plan quota (session/weekly/web-searches) as a {@link UsageSnapshot}. */
	fetchSnapshot(apiKey: string, signal?: AbortSignal): Promise<UsageSnapshot>;
	/** Fetch Standard API balance (cash + token packages) as a snapshot with `balance` populated. */
	fetchBalance(apiKey: string, signal?: AbortSignal): Promise<UsageSnapshot>;
}

/**
 * GLM usage + balance client. `fetchSnapshot` fetches Coding Plan quota (subscription + quota GETs);
 * `fetchBalance` fetches Standard API cash balance + token packages (two parallel GETs).
 * Subscription failure is swallowed; quota/balance failure sets status.
 *
 * Both stations (z.ai international + open.bigmodel.cn china) share the same paths and JSON
 * shapes; only the host and Authorization header differ. The China (open.bigmodel.cn) monitor
 * endpoint authenticates with the RAW API key (no `Bearer` prefix), while z.ai uses `Bearer {key}`. The scheme is detected
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

	/**
	 * Fetch Coding Plan usage quota. Resolves the host, then fires subscription + quota requests in
	 * parallel; the subscription result (plan name + renewal) is merged into the quota snapshot.
	 * Subscription failure is swallowed (best-effort); quota failure determines the final status.
	 */
	async fetchSnapshot(apiKey: string, signal?: AbortSignal): Promise<UsageSnapshot> {
		const host = this.resolveHost();
		const [subscription, snapshot] = await Promise.all([
			this.fetchSubscription(host, apiKey, signal),
			this.fetchQuota(host, apiKey, signal),
		]);
		return { ...snapshot, ...subscription };
	}

	/**
	 * Fetch Standard API balance. Two parallel GETs against the biz gateway: a cash account report
	 * and a token resource-package list. Either may fail independently — the account report is the
	 * primary signal; token packages are supplementary.
	 */
	async fetchBalance(apiKey: string, signal?: AbortSignal): Promise<UsageSnapshot> {
		const host = this.resolveHost();
		const fetchedAt = Date.now();
		const [accountResult, packagesResult] = await Promise.allSettled([
			this.fetchAccountReport(host, apiKey, signal),
			this.fetchTokenAccounts(host, apiKey, signal),
		]);

		// If the primary (account report) failed, surface its error status.
		if (accountResult.status === 'rejected') {
			if (isAbortError(accountResult.reason)) {
				throw accountResult.reason;
			}
			return this.toErrorSnapshot(accountResult.reason, host, fetchedAt);
		}
		const account = accountResult.value;

		// Token packages failure is non-fatal — we still show cash balance.
		const packages = packagesResult.status === 'fulfilled' ? packagesResult.value : [];

		const balance: UsageBalance = { ...account, tokenPackages: packages };
		// No data at all → no-data; otherwise ok even if some fields are missing.
		const hasData =
			account.availableCash !== undefined ||
			account.totalRecharged !== undefined ||
			packages.length > 0;
		return {
			status: hasData ? 'ok' : 'no-data',
			balance,
			metrics: [],
			fetchedAt,
		};
	}
	/**
	 * Fetch the cash account report (balance, recharge, spend, gift, frozen) from the biz gateway.
	 * Throws on HTTP error so the caller can map it to an error status.
	 */	private async fetchAccountReport(
		host: string,
		apiKey: string,
		signal?: AbortSignal,
	): Promise<Omit<UsageBalance, 'tokenPackages'>> {
		const response = await this.get(`${host}${BALANCE_PATHS.accountReport}`, apiKey, signal);
		if (!response.ok) {
			const error = await createHttpError(response, { baseUrl: host });
			throw error;
		}
		const parsed = (await response.json()) as BigmodelAccountReport;
		const d = parsed?.data;
		return {
			availableCash: finiteOr(d?.availableBalance ?? d?.balance),
			totalRecharged: finiteOr(d?.rechargeAmount),
			totalSpent: finiteOr(d?.totalSpendAmount),
			giftedAmount: finiteOr(d?.giveAmount),
			frozenAmount: finiteOr(d?.frozenBalance),
		};
	}

	/**
	 * Fetch the list of token resource packages. Returns `[]` on any failure (non-fatal: cash
	 * balance is still shown). Filters to EFFECTIVE packages (plus any with a non-null balance).
	 */
	private async fetchTokenAccounts(
		host: string,
		apiKey: string,
		signal?: AbortSignal,
	): Promise<TokenPackage[]> {
		const url = `${host}${BALANCE_PATHS.tokenAccounts}?pageNum=1&pageSize=100`;
		const response = await this.get(url, apiKey, signal);
		if (!response.ok) {
			return [];
		}
		const parsed = (await response.json()) as BigmodelTokenAccountsResponse;
		const rows = parsed?.rows;
		if (!Array.isArray(rows)) {
			return [];
		}
		return rows
			.filter((r) => r.status === 'EFFECTIVE' || r.tokenBalance !== undefined)
			.map((r) => ({
				name: r.resourcePackageName ?? 'Token Package',
				remainingTokens: numberOr(r.tokenBalance),
				magnitude: numberOr(r.tokensMagnitude, 1),
				status: r.status ?? 'UNKNOWN',
				model: r.suitableModel,
			}));
	}

	/**
	 * Fetch the Coding Plan subscription (plan name + renewal time). Any failure returns an empty
	 * object — the quota snapshot still renders without plan metadata.
	 */
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

	/**
	 * Fetch the Coding Plan quota limits and map them to {@link UsageMetric}s. Aborts propagate;
	 * HTTP/parse failures map to error statuses. Empty or unparseable limits map to `no-data`.
	 */
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

	/**
	 * GET a URL with the host-appropriate Authorization header, a {@link USAGE_REQUEST_TIMEOUT_MS}
	 * timeout, and caller-signal forwarding. Re-throws aborts; converts timeout aborts to a TypeError.
	 */
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

	/**
	 * Build the Authorization header for a URL. China (open.bigmodel.cn) uses the RAW key;
	 * z.ai uses `Bearer {key}`. Detected from the request URL, not the region setting, so the
	 * header always matches the actual host.
	 */
	private authHeader(url: string, apiKey: string): string {
		return url.includes('bigmodel.cn') ? apiKey : `Bearer ${apiKey}`;
	}

	/**
	 * Map a fetch error to a {@link UsageSnapshot} error status: 401/403 → `auth-error`,
	 * network → `network-error`, everything else → `server-error`.
	 */
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

/** Extract the `limits` array from a quota response, tolerating both `data.limits` and top-level array shapes. */
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

/** Coerce to a finite number, falling back to `fallback` (default 0) when not numeric. */
function numberOr(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Coerce to a finite number, returning undefined when not numeric (for optional balance fields). */
function finiteOr(value: unknown, fallback?: number): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	// Reject empty/whitespace-only strings: Number("") === Number("  ") === 0, which would
	// wrongly turn a missing balance field into a zero value. Keep valid numeric strings.
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		if (Number.isFinite(n)) {
			return n;
		}
	}
	return fallback;
}

/** Epoch-ms of the next UTC midnight on the 1st of the month (default reset for monthly web-search windows lacking a `nextResetTime`). */
function nextUtcFirstOfMonthMs(now: Date = new Date()): number {
	return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

/**
 * Map raw `TOKENS_LIMIT` / `TIME_LIMIT` entries to the ordered metric list
 * (`session` → `weekly` → `web-searches`), skipping any window that is absent.
 */
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
