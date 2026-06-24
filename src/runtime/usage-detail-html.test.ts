import { describe, it, expect } from 'vitest';
import { buildUsageMessage } from './usage-detail-html';
import type { UsageSnapshot } from '../types';
import type { UsagePanelStrings } from './usage-detail-html';

const strings: UsagePanelStrings = {
	title: 'GLM Usage',
	refresh: 'Refresh',
	setKey: 'Set API Key',
	offline: 'Offline · showing last data',
	unavailable: 'Usage unavailable.',
	lastUpdated: 'Last updated: {0}',
	resetsIn: 'Resets in {0}',
	plan: 'Plan: {0}',
	renewsAt: 'Renews: {0}',
	window: { session: '5h rolling', weekly: '7-day rolling', 'web-searches': 'Monthly' },
	label: { session: 'Session', weekly: 'Weekly', 'web-searches': 'Web Searches' },
	status: {
		ok: '', loading: 'Refreshing…', 'no-data': 'No usage data.',
		'auth-error': 'API key invalid.', 'network-error': 'Usage unavailable (offline).',
		'server-error': 'Usage request failed.',
	},
};

describe('buildUsageMessage', () => {
	it('returns null for gate-failed (no snapshot)', () => {
		expect(buildUsageMessage(null, false, strings, 'dark')).toBeNull();
	});

	it('maps ok with all three metrics, ordered session/weekly/web-searches', () => {
		const snap: UsageSnapshot = {
			status: 'ok', fetchedAt: 1_000_000, planName: 'GLM Coding Max', renewsAt: '2026-03-12',
			metrics: [
				{ kind: 'session', used: 15, limit: 100, resetsAt: 2_000_000 },
				{ kind: 'weekly', used: 3, limit: 100, resetsAt: 3_000_000 },
				{ kind: 'web-searches', used: 1828, limit: 4000 },
			],
		};
		const msg = buildUsageMessage(snap, false, strings, 'dark');
		expect(msg?.status).toBe('ok');
		expect(msg?.planName).toBe('GLM Coding Max');
		expect(msg?.renewsAt).toBe('2026-03-12');
		expect(msg?.offline).toBe(false);
		expect(msg?.theme).toBe('dark');
		expect(msg?.lastUpdated).toBe(1_000_000);
		expect(msg?.metrics).toHaveLength(3);
		expect(msg?.metrics[0]).toMatchObject({ kind: 'session', label: 'Session', window: '5h rolling', used: 15, limit: 100, isPercent: true });
		expect(msg?.metrics[1]).toMatchObject({ kind: 'weekly', label: 'Weekly', window: '7-day rolling', used: 3, isPercent: true });
		expect(msg?.metrics[2]).toMatchObject({ kind: 'web-searches', label: 'Web Searches', window: 'Monthly', used: 1828, limit: 4000, isPercent: false });
	});

	it('maps ok with session-only metric', () => {
		const snap: UsageSnapshot = {
			status: 'ok', fetchedAt: 1, metrics: [{ kind: 'session', used: 42, limit: 100 }],
		};
		const msg = buildUsageMessage(snap, false, strings, 'dark');
		expect(msg?.metrics).toHaveLength(1);
		expect(msg?.metrics[0].kind).toBe('session');
	});

	it('marks offline true when cache-fallback flag is set', () => {
		const snap: UsageSnapshot = {
			status: 'ok', fetchedAt: 1, metrics: [{ kind: 'session', used: 42, limit: 100 }],
		};
		const msg = buildUsageMessage(snap, true, strings, 'dark');
		expect(msg?.offline).toBe(true);
	});

	it('maps loading status with empty metrics and no lastUpdated', () => {
		const snap: UsageSnapshot = { status: 'loading', fetchedAt: 1, metrics: [] };
		const msg = buildUsageMessage(snap, false, strings, 'dark');
		expect(msg?.status).toBe('loading');
		expect(msg?.metrics).toEqual([]);
		expect(msg?.lastUpdated).toBeUndefined();
	});

	it('maps error statuses with empty metrics', () => {
		for (const status of ['no-data', 'auth-error', 'network-error', 'server-error'] as const) {
			const snap: UsageSnapshot = { status, fetchedAt: 1, metrics: [] };
			const msg = buildUsageMessage(snap, false, strings, 'dark');
			expect(msg?.status).toBe(status);
			expect(msg?.metrics).toEqual([]);
		}
	});

	it('forwards resetsAt from source metrics', () => {
		const snap: UsageSnapshot = {
			status: 'ok', fetchedAt: 1,
			metrics: [{ kind: 'session', used: 1, limit: 100, resetsAt: 9_999_999 }],
		};
		const msg = buildUsageMessage(snap, false, strings, 'dark');
		expect(msg?.metrics[0].resetsAt).toBe(9_999_999);
	});
});
