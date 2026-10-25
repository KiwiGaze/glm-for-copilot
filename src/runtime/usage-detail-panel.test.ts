import { describe, it, expect, afterEach, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import type { UsagePanelMessage } from './usage-detail-html';

const panelHarness = vi.hoisted(() => ({
	messageHandler: undefined as ((message: unknown) => Promise<void>) | undefined,
}));

const panel = vi.hoisted(() => ({
	title: '',
	webview: {
		html: '',
		onDidReceiveMessage: vi.fn((handler: (message: unknown) => Promise<void>) => {
			panelHarness.messageHandler = handler;
			return { dispose: () => undefined };
		}),
	},
	reveal: vi.fn(),
	onDidDispose: vi.fn(() => ({ dispose: () => undefined })),
	dispose: vi.fn(),
}));

vi.mock('node:crypto', () => ({
	randomBytes: vi.fn(() => Buffer.from('0123456789abcdef')),
}));

vi.mock('vscode', () => ({
	ViewColumn: { Active: 1 },
	ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
	window: {
		activeColorTheme: { kind: 1 },
		createWebviewPanel: vi.fn(() => panel),
		onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: () => undefined })),
	},
	commands: { executeCommand: vi.fn() },
	workspace: { getConfiguration: vi.fn(() => ({ get: () => undefined })) },
	env: { language: 'en' },
}));

import { randomBytes } from 'node:crypto';
import { UsageDetailPanel } from './usage-detail-panel';

function recoveryMessage(reason: NonNullable<UsagePanelMessage['recoveryReason']>): UsagePanelMessage {
	return {
		status: reason === 'coding-plan-exhausted' ? 'ok' : 'no-data',
		recoveryReason: reason,
		metrics: reason === 'coding-plan-exhausted'
			? [{ kind: 'session', label: 'Session', window: '5h rolling', used: 100, limit: 100, isPercent: true }]
			: [],
		currency: '$',
		offline: false,
		theme: 'light',
		strings: {
			title: 'GLM Usage',
			refresh: 'Refresh',
			setKey: 'Set API Key',
			checkStandard: 'Check Standard API',
			offline: 'Offline',
			unavailable: 'Unavailable',
			lastUpdated: 'Last updated: {0}',
			resetsIn: 'Resets in {0}',
			used: 'used',
			plan: 'Plan: {0}',
			renewsAt: 'Renews: {0}',
			window: { session: '5h rolling', weekly: '7-day rolling', 'web-searches': 'Monthly' },
			label: { session: 'Session', weekly: 'Weekly', 'web-searches': 'Web Searches' },
			status: {
				ok: '',
				loading: 'Refreshing',
				'no-data': 'No usage data',
				'auth-error': 'Invalid key',
				'network-error': 'Offline',
				'server-error': 'Request failed',
			},
			balanceSection: 'Balance',
			balanceAvailable: 'Available',
			balanceRecharged: 'Recharged',
			balanceSpent: 'Spent',
			balanceGifted: 'Gifted',
			balanceFrozen: 'Frozen',
			balancePackages: 'Packages',
			recoveryUnavailable: 'No usable Coding Plan quota was found.',
			recoveryExhausted: 'Your Coding Plan token quota is exhausted.',
			resetTitle: 'Reset cards',
			resetLabels: { FIVE_HOUR: '5-hour reset cards', WEEK: 'weekly reset cards' },
			resetAvailable: '{0} available',
			resetExpires: 'Expires {0}',
			resetUse: 'Use one reset card',
			resetProcessing: 'Checking reset card…',
			resetUnavailable: 'Reset cards could not be loaded.',
			localTime: 'Expiry dates are shown in your local time.',
		},
	};
}

function createBar(message: UsagePanelMessage | null) {
	return {
		getSnapshot: () => message,
		onDidChangeSnapshot: vi.fn(() => ({ dispose: () => undefined })),
		refresh: vi.fn(async () => undefined),
		checkStandardApi: vi.fn(async () => undefined),
		useResetCard: vi.fn(async (_type: string) => undefined),
	};
}

describe('UsageDetailPanel', () => {
	afterEach(() => {
		const currentPanel = (UsageDetailPanel as unknown as { currentPanel?: { dispose(): void } }).currentPanel;
		currentPanel?.dispose();
		panel.webview.html = '';
		panelHarness.messageHandler = undefined;
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it('generates the CSP nonce with node crypto', () => {
		const bar = createBar(null);
		UsageDetailPanel.createOrShow(
			{ subscriptions: [] } as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[0],
			bar as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[1],
		);
		const expectedNonce = Buffer.from('0123456789abcdef').toString('base64');
		expect(randomBytes).toHaveBeenCalledWith(16);
		expect(panel.webview.html).toContain(`style-src 'nonce-${expectedNonce}'`);
		expect(panel.webview.html).toContain(`style nonce="${expectedNonce}"`);
		expect(panel.webview.html).toContain(`script nonce="${expectedNonce}"`);
	});

	it.each([
		['coding-plan-unavailable', 'No usable Coding Plan quota was found.'],
		['coding-plan-exhausted', 'Your Coding Plan token quota is exhausted.'],
	] as const)('renders %s recovery with an explicit Standard check', (reason, copy) => {
		const bar = createBar(recoveryMessage(reason));
		UsageDetailPanel.createOrShow(
			{ subscriptions: [] } as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[0],
			bar as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[1],
		);

		expect(panel.webview.html).toContain(copy);
		expect(panel.webview.html).toContain('Check Standard API');
		if (reason === 'coding-plan-exhausted') {
			expect(panel.webview.html).toContain('100%');
		}
	});

	it('routes the Standard check action to the usage controller', async () => {
		const bar = createBar(recoveryMessage('coding-plan-unavailable'));
		UsageDetailPanel.createOrShow(
			{ subscriptions: [] } as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[0],
			bar as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[1],
		);

		await panelHarness.messageHandler?.({ type: 'checkStandard' });

		expect(bar.checkStandardApi).toHaveBeenCalledTimes(1);
	});

	function resetMessage(): UsagePanelMessage {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-24T15:00:00Z'));
		return {
			...recoveryMessage('coding-plan-exhausted'), recoveryReason: undefined,
			metrics: [
				{ kind: 'session', label: 'Session', window: '5h rolling', used: 2, limit: 100, isPercent: true },
				{ kind: 'weekly', label: 'Weekly', window: '7-day rolling', used: 90, limit: 100, isPercent: true },
				{ kind: 'web-searches', label: 'Web Searches', window: 'Monthly', used: 12, limit: 4000, isPercent: false },
			],
			resetCards: {
				FIVE_HOUR: [Date.parse('2026-10-28T06:58:28Z'), Date.parse('2026-10-28T06:58:28Z')],
				WEEK: [Date.parse('2026-10-28T06:58:28Z'), Date.parse('2026-12-22T15:59:59Z'), Date.parse('2026-12-22T15:59:59Z')],
			},
		};
	}

	function show(message: UsagePanelMessage) {
		const bar = createBar(message);
		UsageDetailPanel.createOrShow(
			{ subscriptions: [] } as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[0],
			bar as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[1],
		);
		return bar;
	}

	function runWebview() {
		const elements = new Map<string, {
			disabled?: boolean;
			textContent?: string;
			dataset?: Record<string, string>;
			addEventListener?: (name: string, handler: () => void) => void;
			querySelectorAll?: (selector: string) => unknown[];
		}>();
		const clicks = new Map<string, () => void>();
		const buttons: unknown[] = [];
		elements.set('refresh', { addEventListener: () => undefined });
		for (const type of ['FIVE_HOUR', 'WEEK']) {
			const section = panel.webview.html.match(new RegExp(`<section class="reset-group" id="reset-group-${type}"[^>]*>([\\s\\S]*?)</section>`))?.[1];
			if (!section) continue;
			const expiries = [...section.matchAll(/data-reset-expiry="(\d+)" data-reset-count="(\d+)"/g)].map((match) => ({
				dataset: { resetExpiry: match[1], resetCount: match[2] }, hidden: false, textContent: '',
				querySelector: () => ({ textContent: '' }),
			}));
			elements.set(`reset-group-${type}`, { querySelectorAll: () => expiries });
			elements.set(`reset-count-${type}`, { textContent: '' });
			const button = {
				disabled: new RegExp(`id="use-reset-${type}"[^>]* disabled`).test(section),
				dataset: { resetType: type },
				addEventListener: (_name: string, handler: () => void) => { clicks.set(type, handler); },
			};
			buttons.push(button);
			elements.set(`use-reset-${type}`, button);
		}
		const postMessage = vi.fn();
		const ticks: Array<() => void> = [];
		const script = panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
		expect(script).toBeDefined();
		runInNewContext(script!, {
			Date,
			document: { getElementById: (id: string) => elements.get(id), querySelectorAll: () => buttons },
			acquireVsCodeApi: () => ({ postMessage }),
			setInterval: (callback: () => void) => { ticks.push(callback); },
		});
		return { elements, clicks, postMessage, ticks };
	}

	it('pairs each quota with only its matching reset controls and labels percentages as used', () => {
		show(resetMessage());
		const cards = new Map([...panel.webview.html.matchAll(/<article[^>]+data-kind="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)].map((match) => [match[1], match[2]]));
		expect(cards.get('session')).toContain('id="reset-group-FIVE_HOUR"');
		expect(cards.get('session')).not.toContain('id="reset-group-WEEK"');
		expect(cards.get('weekly')).toContain('id="reset-group-WEEK"');
		expect(cards.get('weekly')).not.toContain('id="reset-group-FIVE_HOUR"');
		expect(cards.get('web-searches')).not.toContain('data-reset-type');
		expect(cards.get('weekly')).toContain('aria-label="Weekly: 90% used"');
		expect(cards.get('weekly')).toContain('aria-valuenow="90"');
		expect(panel.webview.html.match(/id="reset-group-WEEK"/g)).toHaveLength(1);
	});

	it('preserves both reset types when quota metrics are unavailable', () => {
		show({ ...resetMessage(), status: 'no-data', metrics: [] });
		expect(panel.webview.html).toContain('id="reset-group-FIVE_HOUR"');
		expect(panel.webview.html).toContain('id="reset-group-WEEK"');
		const dom = runWebview();
		expect(dom.elements.get('reset-count-FIVE_HOUR')?.textContent).toBe('2 available');
		expect(dom.elements.get('reset-count-WEEK')?.textContent).toBe('3 available');
	});

	it('renders separate counts, types and every expiry group', () => {
		show(resetMessage());
		expect(panel.webview.html).toContain('5-hour reset cards');
		expect(panel.webview.html).toContain('weekly reset cards');
		expect(panel.webview.html).toContain('id="reset-count-FIVE_HOUR">2 available');
		expect(panel.webview.html).toContain('id="reset-count-WEEK">3 available');
		expect(panel.webview.html).toContain(`data-reset-expiry="${Date.parse('2026-12-22T15:59:59Z')}" data-reset-count="2"`);
	});

	it.each(['FIVE_HOUR', 'WEEK'])('routes a rendered %s button to its matching controller action and blocks double clicks', async (type) => {
		const bar = show(resetMessage());
		const dom = runWebview();
		dom.clicks.get(type)?.();
		dom.clicks.get(type)?.();
		dom.clicks.get(type === 'WEEK' ? 'FIVE_HOUR' : 'WEEK')?.();
		expect(dom.postMessage).toHaveBeenCalledTimes(1);
		expect(dom.postMessage).toHaveBeenCalledWith({ type: 'useReset', resetType: type });
		await panelHarness.messageHandler?.(dom.postMessage.mock.calls[0][0]);
		expect(bar.useResetCard).toHaveBeenCalledWith(type);
	});

	it('updates visible counts and disables a type when its last card expires', () => {
		show(resetMessage());
		const dom = runWebview();
		vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
		for (const tick of dom.ticks) tick();
		expect(dom.elements.get('reset-count-FIVE_HOUR')?.textContent).toBe('0 available');
		expect(dom.elements.get('use-reset-FIVE_HOUR')?.disabled).toBe(true);
		expect(dom.elements.get('reset-count-WEEK')?.textContent).toBe('2 available');
		expect(dom.elements.get('use-reset-WEEK')?.disabled).toBe(false);
		dom.clicks.get('FIVE_HOUR')?.();
		expect(dom.postMessage).not.toHaveBeenCalled();
	});

	it.each(['offline', 'resetBusy'] as const)('disables both actions while %s', (state) => {
		show({ ...resetMessage(), [state]: true });
		const dom = runWebview();
		for (const type of ['FIVE_HOUR', 'WEEK']) {
			expect(dom.elements.get(`use-reset-${type}`)?.disabled).toBe(true);
			dom.clicks.get(type)?.();
		}
		expect(dom.postMessage).not.toHaveBeenCalled();
	});

	it('shows inventory failure separately from a valid zero-card result', () => {
		show({ ...resetMessage(), resetCards: null });
		expect(panel.webview.html).toContain('Reset cards could not be loaded.');
		expect(panel.webview.html).not.toContain('0 available');
		expect(panel.webview.html).not.toContain('data-reset-type=');
	});

	it.each(['auth-error', 'network-error', 'server-error', 'no-data', 'loading'] as const)(
		'keeps the primary %s message without a duplicate inventory failure', (status) => {
			const message = { ...resetMessage(), status, resetCards: null };
			show(message);
			expect(panel.webview.html).toContain(message.strings.status[status]);
			expect(panel.webview.html).not.toContain('Reset cards could not be loaded.');
		},
	);

	it('does not add reset actions to snapshots without reset inventory', () => {
		show(recoveryMessage('coding-plan-exhausted'));
		expect(panel.webview.html).not.toContain('class="reset-section"');
	});

	it('ignores malformed messages and unknown reset types', async () => {
		const bar = show(resetMessage());
		for (const message of [null, 'useReset', {}, { type: 'useReset' }, { type: 'useReset', resetType: 'MONTH' }]) {
			await panelHarness.messageHandler?.(message);
		}
		expect(bar.useResetCard).not.toHaveBeenCalled();
	});
});
