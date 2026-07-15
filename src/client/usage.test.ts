import { describe, it, expect, beforeEach, vi } from 'vitest';

// usage.ts imports errors.ts, which transitively imports endpoint.ts → config.ts → 'vscode'.
// Stub the vscode surface so module resolution succeeds under vitest.
vi.mock('vscode', () => ({
	workspace: { getConfiguration: () => ({ get: () => undefined }) },
	env: { language: 'en' },
}));

import { UsageClient } from './usage';
import { USAGE_REQUEST_TIMEOUT_MS } from '../consts';

const SUBSCRIPTION_OK = JSON.stringify({
	data: [{ productName: 'GLM Coding Max', nextRenewTime: '2026-03-12' }],
});
const SUBSCRIPTION_EMPTY = JSON.stringify({ data: [] });

const QUOTA_FULL = JSON.stringify({
	code: 200,
	data: {
		limits: [
			{ type: 'TOKENS_LIMIT', usage: 800000000, currentValue: 1900000, percentage: 10, nextResetTime: 1738368000000, unit: 3, number: 5 },
			{ type: 'TOKENS_LIMIT', usage: 1600000000, currentValue: 4800000, percentage: 10, nextResetTime: 1738972800000, unit: 6, number: 7 },
			{ type: 'TIME_LIMIT', usage: 4000, currentValue: 1095, percentage: 27, remaining: 2905, nextResetTime: 1738368000000, unit: 5, number: 1 },
		],
	},
});
const QUOTA_SESSION_ONLY = JSON.stringify({
	code: 200,
	data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 10, nextResetTime: 1738368000000, unit: 3 }] },
});
const QUOTA_NON_NUMERIC = JSON.stringify({
	code: 200,
	data: { limits: [
		{ type: 'TOKENS_LIMIT', percentage: '10', unit: 3 },
		{ type: 'TIME_LIMIT', currentValue: '1095', usage: '4000' },
	] },
});
const QUOTA_EMPTY = JSON.stringify({ data: { limits: [] } });

function mockFetch(responses: Record<string, { status: number; body: string }>): typeof fetch {
	return vi.fn(async (url: URL | string) => {
		const path = typeof url === 'string' ? url : url.pathname;
		const key = Object.keys(responses).find((k) => path.includes(k));
		if (!key) throw new Error(`unexpected fetch: ${path}`);
		const { status, body } = responses[key];
		return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
	}) as unknown as typeof fetch;
}

describe('UsageClient.fetchSnapshot', () => {
	beforeEach(() => vi.useRealTimers());

	it('maps full quota to ok with session, weekly, web-searches', async () => {
		const client = new UsageClient('https://api.z.ai', mockFetch({
			'subscription/list': { status: 200, body: SUBSCRIPTION_OK },
			'quota/limit': { status: 200, body: QUOTA_FULL },
		}));
		const snap = await client.fetchSnapshot('k');
		expect(snap.status).toBe('ok');
		expect(snap.planName).toBe('GLM Coding Max');
		expect(snap.renewsAt).toBe('2026-03-12');
		expect(snap.metrics.map((m) => m.kind)).toEqual(['session', 'weekly', 'web-searches']);
		expect(snap.metrics[0]).toMatchObject({ used: 10, limit: 100, resetsAt: 1738368000000 });
		expect(snap.metrics[1]).toMatchObject({ used: 10, limit: 100, resetsAt: 1738972800000 });
		expect(snap.metrics[2]).toMatchObject({ used: 1095, limit: 4000, resetsAt: 1738368000000 });
		expect(snap.fetchedAt).toBeGreaterThan(0);
	});

	it('coerces non-numeric fields to 0', async () => {
		const client = new UsageClient('https://api.z.ai', mockFetch({
			'subscription/list': { status: 200, body: SUBSCRIPTION_EMPTY },
			'quota/limit': { status: 200, body: QUOTA_NON_NUMERIC },
		}));
		const snap = await client.fetchSnapshot('k');
		const session = snap.metrics.find((m) => m.kind === 'session')!;
		expect(session.used).toBe(0);
		const web = snap.metrics.find((m) => m.kind === 'web-searches')!;
		expect(web.used).toBe(0);
		expect(web.limit).toBe(0);
	});

	it('returns no-data when limits array is empty', async () => {
		const client = new UsageClient('https://api.z.ai', mockFetch({
			'subscription/list': { status: 200, body: SUBSCRIPTION_OK },
			'quota/limit': { status: 200, body: QUOTA_EMPTY },
		}));
		const snap = await client.fetchSnapshot('k');
		expect(snap.status).toBe('no-data');
		expect(snap.metrics).toEqual([]);
	});

	it('skips weekly and web-searches when absent (session only)', async () => {
		const client = new UsageClient('https://api.z.ai', mockFetch({
			'subscription/list': { status: 200, body: SUBSCRIPTION_OK },
			'quota/limit': { status: 200, body: QUOTA_SESSION_ONLY },
		}));
		const snap = await client.fetchSnapshot('k');
		expect(snap.metrics.map((m) => m.kind)).toEqual(['session']);
	});

	it('swallows subscription failure and still renders quota', async () => {
		const client = new UsageClient('https://api.z.ai', mockFetch({
			'subscription/list': { status: 500, body: '' },
			'quota/limit': { status: 200, body: QUOTA_SESSION_ONLY },
		}));
		const snap = await client.fetchSnapshot('k');
		expect(snap.status).toBe('ok');
		expect(snap.planName).toBeUndefined();
	});

	it('maps HTTP 401 to auth-error', async () => {
		const client = new UsageClient('https://api.z.ai', mockFetch({
			'subscription/list': { status: 200, body: SUBSCRIPTION_OK },
			'quota/limit': { status: 401, body: '' },
		}));
		const snap = await client.fetchSnapshot('k');
		expect(snap.status).toBe('auth-error');
	});

	it('maps HTTP 500 to server-error', async () => {
		const client = new UsageClient('https://api.z.ai', mockFetch({
			'subscription/list': { status: 200, body: SUBSCRIPTION_OK },
			'quota/limit': { status: 500, body: '' },
		}));
		const snap = await client.fetchSnapshot('k');
		expect(snap.status).toBe('server-error');
	});

	it('maps network exception to network-error', async () => {
		// Real undici fetch failures carry a `.cause` with a recognized `code` (ENOTFOUND, ECONNRESET, …).
		// normalizeRequestError returns the original Error UNCHANGED when there is no cause, which our
		// toErrorSnapshot would map to server-error. So the mock must mirror the real shape.
		const networkError = Object.assign(new TypeError('fetch failed'), {
			cause: { code: 'ENOTFOUND', name: 'Error', message: 'getaddrinfo ENOTFOUND api.z.ai' },
		});
		const failing = vi.fn(async () => { throw networkError; }) as unknown as typeof fetch;
		const client = new UsageClient('https://api.z.ai', failing);
		const snap = await client.fetchSnapshot('k');
		// subscription failure is swallowed; quota failure determines status
		expect(snap.status).toBe('network-error');
	});

	it('maps internal request timeout to network-error', async () => {
		vi.useFakeTimers();
		try {
			const abortingFetch = vi.fn((_url: URL | string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => {
					reject(new DOMException('The operation was aborted.', 'AbortError'));
				}, { once: true });
			})) as unknown as typeof fetch;
			const client = new UsageClient('https://api.z.ai', abortingFetch);
			const snapshot = client.fetchSnapshot('k');
			await vi.advanceTimersByTimeAsync(USAGE_REQUEST_TIMEOUT_MS);
			await expect(snapshot).resolves.toMatchObject({ status: 'network-error' });
		} finally {
			vi.useRealTimers();
		}
	});

	it('maps unparsable 2xx body to server-error', async () => {
		const client = new UsageClient('https://api.z.ai', mockFetch({
			'subscription/list': { status: 200, body: SUBSCRIPTION_OK },
			'quota/limit': { status: 200, body: 'not-json' },
		}));
		const snap = await client.fetchSnapshot('k');
		expect(snap.status).toBe('server-error');
	});

	it('web-searches resetsAt falls back to next UTC 1st-of-month when nextResetTime absent', async () => {
		const quota = JSON.stringify({
			code: 200,
			data: { limits: [{ type: 'TIME_LIMIT', currentValue: 5, usage: 100 }] },
		});
		const client = new UsageClient('https://api.z.ai', mockFetch({
			'subscription/list': { status: 200, body: SUBSCRIPTION_OK },
			'quota/limit': { status: 200, body: quota },
		}));
		const snap = await client.fetchSnapshot('k');
		const web = snap.metrics.find((m) => m.kind === 'web-searches')!;
		const now = new Date();
		const expected = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
		expect(web.resetsAt).toBe(expected);
	});
});

describe('UsageClient auth scheme by station', () => {
	beforeEach(() => vi.useRealTimers());

	it('sends Bearer prefix for the international host (api.z.ai)', async () => {
		const calls: { authorization?: string }[] = [];
		const fetchImpl = vi.fn(async (url: URL | string, init?: RequestInit) => {
			calls.push({ authorization: (init?.headers as Record<string, string>)?.Authorization });
			return new Response(QUOTA_SESSION_ONLY, { status: 200, headers: { 'Content-Type': 'application/json' } });
		}) as unknown as typeof fetch;
		const client = new UsageClient('https://api.z.ai', fetchImpl);
		await client.fetchSnapshot('my.key');
		expect(calls.length).toBe(2);
		for (const call of calls) {
			expect(call.authorization).toBe('Bearer my.key');
		}
	});

	it('sends the RAW key (no Bearer) for the china host (open.bigmodel.cn)', async () => {
		const calls: { authorization?: string }[] = [];
		const fetchImpl = vi.fn(async (url: URL | string, init?: RequestInit) => {
			calls.push({ authorization: (init?.headers as Record<string, string>)?.Authorization });
			return new Response(QUOTA_SESSION_ONLY, { status: 200, headers: { 'Content-Type': 'application/json' } });
		}) as unknown as typeof fetch;
		const client = new UsageClient('https://open.bigmodel.cn', fetchImpl);
		await client.fetchSnapshot('my.key');
		expect(calls.length).toBe(2);
		for (const call of calls) {
			expect(call.authorization).toBe('my.key');
			expect(call.authorization).not.toContain('Bearer');
		}
	});
});

describe('UsageClient china station quota', () => {
	beforeEach(() => vi.useRealTimers());

	it('parses the china quota response identically (session + weekly + web-searches)', async () => {
		const client = new UsageClient('https://open.bigmodel.cn', mockFetch({
			'subscription/list': { status: 200, body: SUBSCRIPTION_OK },
			'quota/limit': { status: 200, body: QUOTA_FULL },
		}));
		const snap = await client.fetchSnapshot('k');
		expect(snap.status).toBe('ok');
		expect(snap.metrics.map((m) => m.kind)).toEqual(['session', 'weekly', 'web-searches']);
		expect(snap.metrics[0]).toMatchObject({ used: 10, limit: 100, resetsAt: 1738368000000 });
		expect(snap.metrics[1]).toMatchObject({ used: 10, limit: 100, resetsAt: 1738972800000 });
		expect(snap.metrics[2]).toMatchObject({ used: 1095, limit: 4000 });
	});
});

describe('UsageClient region resolution', () => {
	beforeEach(() => vi.useRealTimers());

	it('re-resolves the host per fetch so region changes are followed', async () => {
		let currentHost = 'https://api.z.ai';
		const seenUrls: string[] = [];
		const fetchImpl = vi.fn(async (url: URL | string) => {
			seenUrls.push(typeof url === 'string' ? url : url.toString());
			return new Response(QUOTA_SESSION_ONLY, { status: 200, headers: { 'Content-Type': 'application/json' } });
		}) as unknown as typeof fetch;
		const client = new UsageClient(() => currentHost, fetchImpl);
		await client.fetchSnapshot('k');
		currentHost = 'https://open.bigmodel.cn';
		await client.fetchSnapshot('k');
		expect(seenUrls.some((u) => u.startsWith('https://api.z.ai'))).toBe(true);
		expect(seenUrls.some((u) => u.startsWith('https://open.bigmodel.cn'))).toBe(true);
	});

	it('auth scheme follows the currently resolved host within one snapshot', async () => {
		const authHeaders: string[] = [];
		const fetchImpl = vi.fn(async (_url: URL | string, init?: RequestInit) => {
			authHeaders.push((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');
			return new Response(QUOTA_SESSION_ONLY, { status: 200, headers: { 'Content-Type': 'application/json' } });
		}) as unknown as typeof fetch;
		const client = new UsageClient(() => 'https://open.bigmodel.cn', fetchImpl);
		await client.fetchSnapshot('raw-key');
		expect(authHeaders.length).toBe(2);
		for (const header of authHeaders) {
			expect(header).toBe('raw-key');
		}
	});
});

describe('UsageClient.fetchBalance (Standard API balance)', () => {
	beforeEach(() => vi.useRealTimers());

	const ACCOUNT_OK = JSON.stringify({
		success: true,
		data: {
			balance: 42.5,
			rechargeAmount: 100,
			giveAmount: 10,
			totalSpendAmount: 67.5,
			frozenBalance: 0,
			availableBalance: 42.5,
		},
	});
	const ACCOUNT_EMPTY = JSON.stringify({ success: true, data: {} });
	const TOKEN_PACKAGES_OK = JSON.stringify({
		code: 200,
		rows: [
			{ tokenBalance: 800, tokensMagnitude: 10000, status: 'EFFECTIVE', resourcePackageName: 'GLM-5.2 Pack', suitableModel: 'glm-5.2' },
			{ tokenBalance: 500, tokensMagnitude: 1000, status: 'EXPIRED', resourcePackageName: 'Old Pack', suitableModel: 'glm-4.6' },
		],
	});
	const TOKEN_PACKAGES_EMPTY = JSON.stringify({ code: 200, rows: [] });

	it('parses cash balance and effective token packages', async () => {
		const client = new UsageClient(() => 'https://open.bigmodel.cn', mockFetch({
			'query-customer-account-report': { status: 200, body: ACCOUNT_OK },
			'tokenAccounts/list/my': { status: 200, body: TOKEN_PACKAGES_OK },
		}));
		const snap = await client.fetchBalance('k');
		expect(snap.status).toBe('ok');
		expect(snap.balance).toBeDefined();
		expect(snap.balance!.availableCash).toBe(42.5);
		expect(snap.balance!.totalRecharged).toBe(100);
		expect(snap.balance!.totalSpent).toBe(67.5);
		expect(snap.balance!.giftedAmount).toBe(10);
		expect(snap.balance!.tokenPackages).toHaveLength(2);
		expect(snap.balance!.tokenPackages[0]).toMatchObject({ name: 'GLM-5.2 Pack', remainingTokens: 800, magnitude: 10000, model: 'glm-5.2' });
	});

	it('returns ok with cash only when token packages endpoint returns empty', async () => {
		const client = new UsageClient(() => 'https://open.bigmodel.cn', mockFetch({
			'query-customer-account-report': { status: 200, body: ACCOUNT_OK },
			'tokenAccounts/list/my': { status: 200, body: TOKEN_PACKAGES_EMPTY },
		}));
		const snap = await client.fetchBalance('k');
		expect(snap.status).toBe('ok');
		expect(snap.balance!.tokenPackages).toEqual([]);
		expect(snap.balance!.availableCash).toBe(42.5);
	});

	it('returns ok with packages only when account report has no data', async () => {
		const client = new UsageClient(() => 'https://open.bigmodel.cn', mockFetch({
			'query-customer-account-report': { status: 200, body: ACCOUNT_EMPTY },
			'tokenAccounts/list/my': { status: 200, body: TOKEN_PACKAGES_OK },
		}));
		const snap = await client.fetchBalance('k');
		expect(snap.status).toBe('ok');
		expect(snap.balance!.availableCash).toBeUndefined();
		expect(snap.balance!.tokenPackages.length).toBeGreaterThan(0);
	});

	it('returns no-data when both endpoints return empty', async () => {
		const client = new UsageClient(() => 'https://open.bigmodel.cn', mockFetch({
			'query-customer-account-report': { status: 200, body: ACCOUNT_EMPTY },
			'tokenAccounts/list/my': { status: 200, body: TOKEN_PACKAGES_EMPTY },
		}));
		const snap = await client.fetchBalance('k');
		expect(snap.status).toBe('no-data');
	});

	it('maps HTTP 401 on account report to auth-error', async () => {
		const client = new UsageClient(() => 'https://open.bigmodel.cn', mockFetch({
			'query-customer-account-report': { status: 401, body: '' },
			'tokenAccounts/list/my': { status: 200, body: TOKEN_PACKAGES_OK },
		}));
		const snap = await client.fetchBalance('k');
		expect(snap.status).toBe('auth-error');
	});

	it('survives token packages failure (non-fatal), still shows cash', async () => {
		const client = new UsageClient(() => 'https://open.bigmodel.cn', mockFetch({
			'query-customer-account-report': { status: 200, body: ACCOUNT_OK },
			'tokenAccounts/list/my': { status: 500, body: '' },
		}));
		const snap = await client.fetchBalance('k');
		expect(snap.status).toBe('ok');
		expect(snap.balance!.availableCash).toBe(42.5);
		expect(snap.balance!.tokenPackages).toEqual([]);
	});

	it('uses raw key auth (no Bearer) for bigmodel.cn balance endpoints', async () => {
		const authHeaders: string[] = [];
		const fetchImpl = vi.fn(async (url: URL | string, init?: RequestInit) => {
			authHeaders.push((init?.headers as Record<string, string>)?.Authorization);
			const path = typeof url === 'string' ? url : url.toString();
			if (path.includes('query-customer-account-report')) {
				return new Response(ACCOUNT_OK, { status: 200, headers: { 'Content-Type': 'application/json' } });
			}
			return new Response(TOKEN_PACKAGES_OK, { status: 200, headers: { 'Content-Type': 'application/json' } });
		}) as unknown as typeof fetch;
		const client = new UsageClient(() => 'https://open.bigmodel.cn', fetchImpl);
		await client.fetchBalance('raw-key');
		expect(authHeaders.length).toBe(2);
		for (const h of authHeaders) {
			expect(h).toBe('raw-key');
			expect(h).not.toContain('Bearer');
		}
	});
});
