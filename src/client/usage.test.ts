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
