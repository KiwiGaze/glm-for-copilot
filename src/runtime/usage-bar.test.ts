import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IAuthManager } from '../types';
import type { IUsageClient } from '../client/usage';
import type { UsageSnapshot } from '../types';

// VS Code API is not available in unit tests; stub only the surface UsageStatusBar touches.
const statusBar = { text: '', tooltip: '', command: '', name: 'glm', backgroundColor: undefined as unknown, color: undefined as unknown, show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
const subscriptions: { dispose(): void }[] = [];

vi.mock('vscode', () => ({
	StatusBarAlignment: { Right: 2 },
	ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
	ThemeColor: class { constructor(public id: string) {} },
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
		createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn() })),
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
	interval: 5,
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
	cfg.interval = 5;
}

describe('UsageStatusBar activation gate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		subscriptions.length = 0;
		statusBar.backgroundColor = undefined;
	});

	it('fetches and shows when region is china (open.bigmodel.cn coding plan)', async () => {
		setConfig('coding-plan', 'china');
		const client: IUsageClient = { fetchSnapshot: vi.fn(async () => okSnapshot()) , fetchBalance: vi.fn() };
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

	it('fetches balance and shows when standard + international (z.ai balance endpoint)', async () => {
		setConfig('standard', 'international');
		const client: IUsageClient = {
			fetchSnapshot: vi.fn(),
			fetchBalance: vi.fn(async () => ({
				status: 'ok',
				fetchedAt: Date.now(),
				metrics: [],
				balance: { availableCash: 1.8, tokenPackages: [] },
			})),
		};
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		expect(client.fetchBalance).toHaveBeenCalledTimes(1);
		expect(client.fetchSnapshot).not.toHaveBeenCalled();
		expect(statusBar.show).toHaveBeenCalled();
		expect(statusBar.text).toContain('$1.8');
		expect(statusBar.text).not.toContain('¥');
		bar.dispose();
	});

	it('fetches balance and shows when standard + china', async () => {
		setConfig('standard', 'china');
		const client: IUsageClient = {
			fetchSnapshot: vi.fn(),
			fetchBalance: vi.fn(async () => ({
				status: 'ok',
				fetchedAt: Date.now(),
				metrics: [],
				balance: { availableCash: 42.5, tokenPackages: [] },
			})),
		};
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		expect(client.fetchBalance).toHaveBeenCalledTimes(1);
		expect(client.fetchSnapshot).not.toHaveBeenCalled();
		expect(statusBar.show).toHaveBeenCalled();
		expect(statusBar.text).toContain('42');
		// China region uses ¥ (not the international $); the codicon "$(wallet)" always prefixes, so
		// assert the currency symbol directly rather than the absence of '$'.
		expect(statusBar.text).toContain('¥');
		bar.dispose();
	});

	it('hides and does not fetch when baseUrl is overridden', async () => {
		setConfig('coding-plan', 'international', 'https://proxy.example');
		const client: IUsageClient = { fetchSnapshot: vi.fn() , fetchBalance: vi.fn() };
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
		const client: IUsageClient = { fetchSnapshot: vi.fn() , fetchBalance: vi.fn() };
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
		const client: IUsageClient = { fetchSnapshot: vi.fn(async () => okSnapshot()) , fetchBalance: vi.fn() };
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

	it('renders web-search-only quota as a count', async () => {
		setConfig('coding-plan', 'international');
		const client: IUsageClient = {
			fetchSnapshot: vi.fn(async () => ({
				status: 'ok',
				fetchedAt: Date.now(),
				metrics: [{ kind: 'web-searches', used: 1095, limit: 4000 }],
			})),
			fetchBalance: vi.fn(),
		};
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		expect(statusBar.text).toBe('$(sparkle) GLM 1095 / 4000');
		expect(statusBar.text).not.toContain('%');
		bar.dispose();
	});

	it('sets error background when a metric hits 100%', async () => {
		setConfig('coding-plan', 'international');
		const client: IUsageClient = {
			fetchSnapshot: vi.fn(async () => ({
				status: 'ok',
				fetchedAt: Date.now(),
				metrics: [{ kind: 'session', used: 100, limit: 100 }],
			})),
			fetchBalance: vi.fn(),
		};
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		expect(statusBar.backgroundColor).toBeDefined();
		bar.dispose();
	});

	it('sets error background when balance is 0', async () => {
		setConfig('standard', 'china');
		const client: IUsageClient = {
			fetchSnapshot: vi.fn(),
			fetchBalance: vi.fn(async () => ({
				status: 'ok',
				fetchedAt: Date.now(),
				metrics: [],
				balance: { availableCash: 0, tokenPackages: [] },
			})),
		};
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		expect(statusBar.backgroundColor).toBeDefined();
		bar.dispose();
	});

	it('keeps normal status when cash is 0 but a token package has credit', async () => {
		setConfig('standard', 'international');
		const client: IUsageClient = {
			fetchSnapshot: vi.fn(),
			fetchBalance: vi.fn(async () => ({
				status: 'ok',
				fetchedAt: Date.now(),
				metrics: [],
				balance: {
					availableCash: 0,
					tokenPackages: [{ name: 'GLM Resource Package', remainingTokens: 500, magnitude: 1000, status: 'EFFECTIVE' }],
				},
			})),
		};
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		expect(statusBar.backgroundColor).toBeUndefined();
		bar.dispose();
	});

	it('clears error background when usage is below 100%', async () => {
		setConfig('coding-plan', 'international');
		const client: IUsageClient = {
			fetchSnapshot: vi.fn(async () => ({
				status: 'ok',
				fetchedAt: Date.now(),
				metrics: [{ kind: 'session', used: 42, limit: 100 }],
			})),
			fetchBalance: vi.fn(),
		};
		const bar = new UsageStatusBar(
			{ subscriptions, secrets: { onDidChange: vi.fn(() => ({ dispose: () => undefined })) } } as unknown as Parameters<typeof UsageStatusBar>[0],
			makeAuth(true),
			client,
		);
		await bar.refresh();
		expect(statusBar.backgroundColor).toBeUndefined();
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
		const client: IUsageClient = { fetchSnapshot: vi.fn(async () => okSnapshot()) , fetchBalance: vi.fn() };
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
			fetchBalance: vi.fn(),
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
		const client: IUsageClient = { fetchSnapshot: vi.fn(async () => ok).mockResolvedValueOnce(ok).mockResolvedValueOnce(networkError) , fetchBalance: vi.fn() };
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
		const client: IUsageClient = { fetchSnapshot: vi.fn(async () => okSnapshot()) , fetchBalance: vi.fn() };
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
		setConfig('standard', 'international', 'https://proxy.example');
		const client: IUsageClient = { fetchSnapshot: vi.fn() , fetchBalance: vi.fn() };
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
		const client: IUsageClient = { fetchSnapshot: vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(networkError) , fetchBalance: vi.fn() };
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
