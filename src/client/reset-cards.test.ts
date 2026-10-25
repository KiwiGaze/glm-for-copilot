import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
	workspace: { getConfiguration: () => ({ get: () => undefined }) },
	env: { language: 'en' },
}));
vi.mock('../logger', () => ({ logger: { warn: vi.fn() } }));

import { UsageClient } from './usage';
import { USAGE_REQUEST_TIMEOUT_MS } from '../consts';
import type { ResetType } from '../types';

const REQUEST_ID = '12345678-1234-4123-8123-123456789abc';
const expiresAt = Date.parse('2026-10-28T06:58:28Z');
const response = (data: unknown) => new Response(JSON.stringify({ code: 200, success: true, data }));
const inventory = () => ({
	fiveHourResets: [{ recordId: 11, available: true, expireTime: '2026-10-28 14:58:28' }],
	weekResets: [{ recordId: 22, available: true, expireTime: '2026-12-22 23:59:59' }],
});

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-24T15:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('regional reset-card inventory', () => {
	it.each(['https://api.z.ai', 'https://open.bigmodel.cn'])('reads %s with API-key business authentication', async (host) => {
		const fetchImpl = vi.fn(async () => response(inventory()));
		const client = new UsageClient(host, fetchImpl);
		const cards = await client.fetchResetCards('regional-key');
		expect(fetchImpl).toHaveBeenCalledWith(`${host}/api/biz/customer-package-reset/list?targetType=PERSONAL`, expect.objectContaining({
			method: 'GET', headers: { Authorization: 'Bearer regional-key', Accept: 'application/json' },
		}));
		expect(cards.FIVE_HOUR).toEqual([{ recordId: 11, expiresAt }]);
		expect(cards.WEEK).toEqual([{ recordId: 22, expiresAt: Date.parse('2026-12-22T15:59:59Z') }]);
	});

	it('filters unavailable, expired, malformed, duplicate and unsafe records, ordering each type by UTC+8 expiry', async () => {
		const data = inventory();
		const rows: unknown[] = [
			...data.fiveHourResets,
			{ recordId: 12, available: true, expireTime: '2026-10-25 00:00:00' },
			{ recordId: 13, available: false, expireTime: '2026-10-28 14:58:28' },
			{ recordId: 14, available: true, expireTime: '2026-10-23 14:58:28' },
			{ recordId: 15, available: true, expireTime: '2027-02-30 14:58:28' },
			{ recordId: 16, available: 'true', expireTime: '2026-10-28 14:58:28' },
			{ recordId: Number.MAX_SAFE_INTEGER + 1, available: true, expireTime: '2026-10-28 14:58:28' },
			{ recordId: 11, available: true, expireTime: '2026-10-28 14:58:28' },
			null,
		];
		const client = new UsageClient('https://api.z.ai', vi.fn(async () => response({ ...data, fiveHourResets: rows })));
		const cards = await client.fetchResetCards('key');
		expect(cards.FIVE_HOUR).toEqual([
			{ recordId: 12, expiresAt: Date.parse('2026-10-24T16:00:00Z') },
			{ recordId: 11, expiresAt },
		]);
		expect(cards.WEEK.map((card) => card.recordId)).toEqual([22]);
	});

	it('distinguishes an empty inventory from an unreadable inventory without hiding quota', async () => {
		let inventoryFailed = false;
		const fetchImpl = vi.fn(async (url: string | URL | Request) => {
			if (String(url).includes('customer-package-reset')) {
				return inventoryFailed ? new Response('', { status: 503 }) : response({ fiveHourResets: [], weekResets: [] });
			}
			if (String(url).includes('subscription')) return response([]);
			return response({ limits: [{ type: 'TOKENS_LIMIT', unit: 3, percentage: 10 }] });
		});
		const client = new UsageClient('https://api.z.ai', fetchImpl);
		expect(await client.fetchSnapshot('key')).toMatchObject({ status: 'ok', resetCards: { FIVE_HOUR: [], WEEK: [] } });
		inventoryFailed = true;
		expect(await client.fetchSnapshot('key')).toMatchObject({ status: 'ok', resetCards: null, metrics: [{ kind: 'session', used: 10 }] });
	});

	it('pins every request in a snapshot to one host and follows the next region change', async () => {
		let host = 'https://api.z.ai';
		const urls: string[] = [];
		const client = new UsageClient(() => host, vi.fn(async (url) => {
			urls.push(String(url));
			host = 'https://open.bigmodel.cn';
			return response(inventory());
		}));
		await client.fetchSnapshot('key');
		expect(urls).toHaveLength(3);
		expect(urls.every((url) => url.startsWith('https://api.z.ai/'))).toBe(true);
		await client.fetchResetCards('key');
		expect(urls[3]).toBe('https://open.bigmodel.cn/api/biz/customer-package-reset/list?targetType=PERSONAL');
	});

	it.each([{}, { code: 200, success: true, data: {} }, { code: 200, success: true, data: { fiveHourResets: [], weekResets: null } }])('rejects missing inventory contracts', async (body) => {
		const client = new UsageClient('https://api.z.ai', vi.fn(async () => new Response(JSON.stringify(body))));
		await expect(client.fetchResetCards('key')).rejects.toThrow();
	});
});

describe('reset-card redemption', () => {
	it.each([
		['https://api.z.ai', 'FIVE_HOUR', 11],
		['https://api.z.ai', 'WEEK', 22],
		['https://open.bigmodel.cn', 'FIVE_HOUR', 11],
		['https://open.bigmodel.cn', 'WEEK', '9223372036854775807'],
	] as const)('sends one %s %s redemption with the exact identifier and request ID', async (host, resetType, recordId) => {
		const fetchImpl = vi.fn(async () => response(true));
		const client = new UsageClient(host, fetchImpl);
		await client.useResetCard('key', resetType, { recordId, expiresAt }, REQUEST_ID);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(fetchImpl).toHaveBeenCalledWith(`${host}/api/biz/customer-package-reset/use`, expect.objectContaining({
			method: 'POST', redirect: 'error',
			headers: { Authorization: 'Bearer key', Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetType: 'PERSONAL', resetType, recordId, requestId: REQUEST_ID }),
		}));
	});

	it.each([
		{ code: 401, success: false, msg: 'Invalid key' },
		{ code: 200, success: false },
		{},
		{ code: 200 },
	])('rejects a failed or incomplete success envelope without retrying', async (body) => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body)));
		const client = new UsageClient('https://api.z.ai', fetchImpl);
		await expect(client.useResetCard('key', 'WEEK', { recordId: 22, expiresAt }, REQUEST_ID)).rejects.toThrow();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('times out a pending redemption without retrying it', async () => {
		const fetchImpl = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
		})) as typeof fetch;
		const client = new UsageClient('https://api.z.ai', fetchImpl);
		const pending = expect(client.useResetCard('key', 'FIVE_HOUR', { recordId: 11, expiresAt }, REQUEST_ID)).rejects.toThrow('timed out');
		await vi.advanceTimersByTimeAsync(USAGE_REQUEST_TIMEOUT_MS);
		await pending;
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('keeps the redemption deadline active while the response body is incomplete', async () => {
		const fetchImpl = vi.fn(async (_url, init) => new Response(new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"code":200'));
				init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
			},
		}))) as typeof fetch;
		const client = new UsageClient('https://api.z.ai', fetchImpl);
		const pending = expect(client.useResetCard('key', 'WEEK', { recordId: 22, expiresAt }, REQUEST_ID)).rejects.toThrow('timed out');
		await vi.advanceTimersByTimeAsync(USAGE_REQUEST_TIMEOUT_MS);
		await pending;
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('refuses expired cards and unknown reset types before making a request', async () => {
		const fetchImpl = vi.fn();
		const client = new UsageClient('https://api.z.ai', fetchImpl);
		await expect(client.useResetCard('key', 'FIVE_HOUR', { recordId: 11, expiresAt: Date.now() }, REQUEST_ID)).rejects.toThrow();
		await expect(client.useResetCard('key', 'MONTH' as ResetType, { recordId: 11, expiresAt }, REQUEST_ID)).rejects.toThrow();
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
