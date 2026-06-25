import { describe, it, expect, afterEach, vi } from 'vitest';

const panel = vi.hoisted(() => ({
	title: '',
	webview: {
		html: '',
		onDidReceiveMessage: vi.fn(() => ({ dispose: () => undefined })),
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

describe('UsageDetailPanel', () => {
	afterEach(() => {
		const currentPanel = (UsageDetailPanel as unknown as { currentPanel?: { dispose(): void } }).currentPanel;
		currentPanel?.dispose();
		panel.webview.html = '';
		vi.clearAllMocks();
	});

	it('generates the CSP nonce with node crypto', () => {
		const bar = {
			getSnapshot: () => null,
			onDidChangeSnapshot: vi.fn(() => ({ dispose: () => undefined })),
			refresh: vi.fn(),
		};
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
});
