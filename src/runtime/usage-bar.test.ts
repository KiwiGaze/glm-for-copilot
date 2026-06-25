import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IAuthManager } from '../types';
import type { IUsageClient } from '../client/usage';
import type { UsageSnapshot } from '../types';

// VS Code API is not available in unit tests; stub only the surface UsageStatusBar touches.
const statusBar = { text: '', tooltip: '', command: '', name: 'glm', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
const subscriptions: { dispose(): void }[] = [];

vi.mock('vscode', () => ({
	StatusBarAlignment: { Right: 2 },
	ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
	EventEmitter: class<T> {
		private listeners: ((e: T) => void)[] = [];
		get event() {
			return (listener: (e: T) => void) => {
				this.listeners.push(listener);
				return { dispose: () => {
					this.listeners = this.listeners.filter((l) => l !== listener);
				} };
			};
		}
		fire(data: T): void {
			for (const listener of this.listeners) {
				listener(data);
			}
		}
		dispose(): void {
			this.listeners = [];
		}
	},
	window: {
		createStatusBarItem: vi.fn(() => statusBar),
		activeColorTheme: { kind: 1 },
	},
	workspace: {
		onDidChangeConfiguration: vi.fn(() => ({ dispose: () => undefined })),
		getConfiguration: vi.fn(() => ({ get: () => undefined })),
	},
	commands: { registerCommand: vi.fn(() => ({ dispose: () => undefined })) },
	env: { language: 'en' },
}));

// config getters must be mocked HOISTED (before usage-bar.ts is imported) so setConfig mutations
// are visible to the module under test. Use vi.hoisted so the holder is initialized before the
// vi.mock factory runs — a plain module-scope `let cfg` would be in the temporal dead zone.
const cfg = vi.hoisted(() => ({
	mode: 'coding-plan' as 'coding-plan' | 'standard',
	region: 'international' as 'international' | 'china',
	baseUrl: '',
	show: true,
	interval: 15,
}));
vi.mock('../config', () => ({
	getApiMode: () => cfg.mode,
	getRegion: () => cfg.region,
	getBaseUrlOverride: () => cfg.baseUrl,
	getShowUsageStatusBar: () => cfg.show,
	getUsageRefreshIntervalMinutes: () => cfg.interval,
}));

import { UsageStatusBar } from './usage-bar';

function makeAuth(hasKey: boolean): IAuthManager {
	return {
		getApiKey: vi.fn(async () => (hasKey ? 'k' : undefined)),
		hasApiKey: vi.fn(async () => hasKey),
		promptForApiKey: vi.fn(async () => false),
		deleteApiKey: vi.fn(async () => undefined),
	};
}

function okSnapshot(): UsageSnapshot {
	return { status: 'ok', fetchedAt: Date.now(), planName: 'GLM Coding Max', metrics: [{ kind: 'session', used: 42, limit: 100 }] };
}

function setConfig(mode: 'coding-plan' | 'standard', region: 'international' | 'china', baseUrl = ''): void {
	cfg.mode = mode;
	cfg.region = region;
	cfg.baseUrl = baseUrl;
	cfg.show = true;
	cfg.interval = 15;
}

describe('UsageStatusBar activation gate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		subscriptions.length = 0;
	});

	it('hides and does not fetch when region is china', async () => {
		setConfig('coding-plan', 'china');
		const client: IUsageClient = { fetchSnapshot: vi.fn() };
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		expect(statusBar.hide).toHaveBeenCalled();
		expect(client.fetchSnapshot).not.toHaveBeenCalled();
		bar.dispose();
	});

	it('hides and does not fetch when apiMode is standard', async () => {
		setConfig('standard', 'international');
		const client: IUsageClient = { fetchSnapshot: vi.fn() };
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		expect(client.fetchSnapshot).not.toHaveBeenCalled();
		bar.dispose();
	});

	it('hides and does not fetch when baseUrl is overridden', async () => {
		setConfig('coding-plan', 'international', 'https://proxy.example');
		const client: IUsageClient = { fetchSnapshot: vi.fn() };
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		expect(client.fetchSnapshot).not.toHaveBeenCalled();
		bar.dispose();
	});

	it('hides and does not fetch when there is no API key', async () => {
		setConfig('coding-plan', 'international');
		const client: IUsageClient = { fetchSnapshot: vi.fn() };
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(false),
			client,
		);
		await bar.refresh();
		expect(client.fetchSnapshot).not.toHaveBeenCalled();
		bar.dispose();
	});

	it('fetches and shows when gate passes', async () => {
		setConfig('coding-plan', 'international');
		const client: IUsageClient = { fetchSnapshot: vi.fn(async () => okSnapshot()) };
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		expect(client.fetchSnapshot).toHaveBeenCalledTimes(1);
		expect(statusBar.show).toHaveBeenCalled();
		bar.dispose();
	});
});

describe('UsageStatusBar debounce', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		subscriptions.length = 0;
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-23T00:00:00Z'));
	});

	it('second refresh within 30s does not fetch again', async () => {
		setConfig('coding-plan', 'international');
		const client: IUsageClient = { fetchSnapshot: vi.fn(async () => okSnapshot()) };
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		await bar.refresh();
		expect(client.fetchSnapshot).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(31_000);
		await bar.refresh();
		expect(client.fetchSnapshot).toHaveBeenCalledTimes(2);
		bar.dispose();
	});

	it('starts a fresh fetch after config changes while a refresh is pending', async () => {
		setConfig('standard', 'international');
		const pendingFetches: Array<{ signal?: AbortSignal; resolve: (snapshot: UsageSnapshot) => void }> = [];
		const client: IUsageClient = {
			fetchSnapshot: vi.fn((_apiKey, signal) => new Promise<UsageSnapshot>((resolve) => {
				pendingFetches.push({ signal, resolve });
			})),
		};
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(client.fetchSnapshot).not.toHaveBeenCalled();
		setConfig('coding-plan', 'international');
		void bar.refresh();
		await Promise.resolve();
		await Promise.resolve();
		expect(client.fetchSnapshot).toHaveBeenCalledTimes(1);
		const onConfigOrKeyChange = (bar as unknown as { onConfigOrKeyChange(): Promise<void> }).onConfigOrKeyChange.bind(bar);
		await onConfigOrKeyChange();
		await Promise.resolve();
		await Promise.resolve();
		expect(pendingFetches[0].signal?.aborted).toBe(true);
		expect(client.fetchSnapshot).toHaveBeenCalledTimes(2);
		pendingFetches[0].resolve(okSnapshot());
		pendingFetches[1].resolve(okSnapshot());
		await Promise.resolve();
		bar.dispose();
	});
});

describe('UsageStatusBar cache-stale rendering', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		subscriptions.length = 0;
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-23T00:00:00Z'));
	});

	it('shows cached metrics on network error when cache < 1h old', async () => {
		setConfig('coding-plan', 'international');
		const ok = okSnapshot();
		const networkError: UsageSnapshot = { status: 'network-error', metrics: [], fetchedAt: Date.now() };
		const client: IUsageClient = { fetchSnapshot: vi.fn(async () => ok).mockResolvedValueOnce(ok).mockResolvedValueOnce(networkError) };
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		vi.advanceTimersByTime(31_000);
		await bar.refresh();
		expect(statusBar.text).toContain('42');
		bar.dispose();
	});
});

describe('UsageStatusBar snapshot emitter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		subscriptions.length = 0;
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-23T00:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('fires a message on ok render and getSnapshot returns it', async () => {
		setConfig('coding-plan', 'international');
		const client: IUsageClient = { fetchSnapshot: vi.fn(async () => okSnapshot()) };
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		const seen: unknown[] = [];
		const sub = bar.onDidChangeSnapshot((m) => seen.push(m));
		await bar.refresh();
		expect(seen.length).toBeGreaterThan(0);
		expect((seen[seen.length - 1] as { status: string }).status).toBe('ok');
		expect(bar.getSnapshot()?.status).toBe('ok');
		sub.dispose();
		bar.dispose();
	});

	it('fires null when gate fails', async () => {
		setConfig('standard', 'international');
		const client: IUsageClient = { fetchSnapshot: vi.fn() };
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		const seen: unknown[] = [];
		const sub = bar.onDidChangeSnapshot((m) => seen.push(m));
		await bar.refresh();
		expect(seen).toContain(null);
		sub.dispose();
		bar.dispose();
	});

	it('fires effective message with offline true on cache-fallback network error', async () => {
		setConfig('coding-plan', 'international');
		const ok = okSnapshot();
		const networkError: UsageSnapshot = { status: 'network-error', metrics: [], fetchedAt: Date.now() };
		const client: IUsageClient = { fetchSnapshot: vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(networkError) };
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		const seen: ({ offline: boolean; status: string } | null)[] = [];
		const sub = bar.onDidChangeSnapshot((m) => seen.push(m as typeof seen[number]));
		await bar.refresh();
		seen.length = 0;
		vi.advanceTimersByTime(31_000);
		await bar.refresh();
		const last = seen[seen.length - 1];
		expect(last?.status).toBe('ok');
		expect(last?.offline).toBe(true);
		sub.dispose();
		bar.dispose();
	});
});
