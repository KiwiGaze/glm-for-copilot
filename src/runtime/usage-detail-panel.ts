import * as vscode from 'vscode';
import { t } from '../i18n';
import type { UsagePanelMessage, UsagePanelStrings } from './usage-detail-html';
import type { UsageStatusBar } from './usage-bar';

/**
 * Singleton webview panel showing z.ai Coding Plan quota detail. Clicking the GLM Usage
 * status bar opens (or reveals) this pane. It never fetches on its own: it renders the
 * effective snapshot pushed by UsageStatusBar via onDidChangeSnapshot.
 */
export class UsageDetailPanel {
	private static currentPanel: UsageDetailPanel | undefined;

	private readonly panel: vscode.WebviewPanel;
	private readonly bar: UsageStatusBar;
	private subscription: vscode.Disposable | undefined;

	private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, bar: UsageStatusBar) {
		this.panel = panel;
		this.bar = bar;

		this.render(this.bar.getSnapshot());

		this.subscription = bar.onDidChangeSnapshot((message) => this.render(message));

		context.subscriptions.push(
			vscode.window.onDidChangeActiveColorTheme(() => this.render(this.bar.getSnapshot())),
		);

		this.panel.webview.onDidReceiveMessage(
			(message: { type: string }) => this.onMessage(message),
			undefined,
			context.subscriptions,
		);

		this.panel.onDidDispose(() => this.dispose(), undefined, context.subscriptions);
	}

	static createOrShow(context: vscode.ExtensionContext, bar: UsageStatusBar): void {
		if (UsageDetailPanel.currentPanel) {
			UsageDetailPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active, false);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'glmUsageDetail',
			t('usage.panel.title'),
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: false,
			},
		);
		UsageDetailPanel.currentPanel = new UsageDetailPanel(panel, context, bar);
	}

	private async onMessage(message: { type: string }): Promise<void> {
		if (message.type === 'refresh') {
			await this.bar.refresh();
		} else if (message.type === 'setKey') {
			await vscode.commands.executeCommand('glm-copilot.setApiKey');
		}
	}

	private render(message: UsagePanelMessage | null): void {
		this.panel.title = t('usage.panel.title');
		this.panel.webview.html = this.buildHtml(message);
	}

	private buildHtml(message: UsagePanelMessage | null): string {
		const nonce = getNonce();
		const gateFailed = message === null;
		const strings = message?.strings;
		const effective: UsagePanelMessage = message ?? {
			status: 'no-data',
			metrics: [],
			offline: false,
			theme: themeKind(),
			strings: emptyFallbackStrings(),
		};
		const body = gateFailed
			? `<div class="status-message"><p>${escapeHtml(effective.strings.unavailable)}</p></div>`
			: effective.status === 'ok'
				? renderOkBody(effective)
				: renderStatusBody(effective);

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>${escapeHtml(strings?.title ?? 'GLM Usage')}</title>
	<style nonce="${nonce}">
		${themeCss(effective.theme)}
	</style>
</head>
<body>
	<div class="header">
		<h1>${escapeHtml(strings?.title ?? 'GLM Usage')}</h1>
		<button id="refresh" class="btn">${escapeHtml(strings?.refresh ?? 'Refresh')}</button>
	</div>
	<div id="content">${body}</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
		const resetsAtTimes = ${JSON.stringify(resetsAtMap(effective))};
		if (resetsAtTimes && Object.keys(resetsAtTimes).length > 0) {
			const fmt = (ms) => {
				if (ms <= 0) return '0m';
				const h = Math.floor(ms / 3600000);
				const m = Math.round((ms % 3600000) / 60000);
				if (h > 0 && m > 0) return h + 'h ' + m + 'm';
				if (h > 0) return h + 'h';
				const d = Math.floor(h / 24);
				if (d > 0) return d + 'd ' + (h % 24) + 'h';
				return m + 'm';
			};
			const tick = () => {
				const now = Date.now();
				for (const [key, ts] of Object.entries(resetsAtTimes)) {
					const el = document.getElementById('resets-' + key);
					if (el) el.textContent = '${escapeAttr(strings?.resetsIn ?? 'Resets in {0}')}'.replace('{0}', fmt(ts - now));
				}
			};
			tick();
			setInterval(tick, 1000);
		}
	</script>
</body>
</html>`;
	}

	dispose(): void {
		this.subscription?.dispose();
		this.panel.dispose();
		UsageDetailPanel.currentPanel = undefined;
	}
}

function renderOkBody(msg: UsagePanelMessage): string {
	const s = msg.strings;
	const lines: string[] = [];
	if (msg.planName) {
		lines.push(`<div class="plan">${escapeHtml(s.plan.replace('{0}', msg.planName))}</div>`);
	}
	if (msg.renewsAt) {
		lines.push(`<div class="plan">${escapeHtml(s.renewsAt.replace('{0}', msg.renewsAt))}</div>`);
	}
	for (const metric of msg.metrics) {
		const pct = metric.isPercent ? metric.used : Math.round((metric.used / Math.max(metric.limit, 1)) * 100);
		const valueLabel = metric.isPercent ? `${metric.used}%` : `${metric.used} / ${metric.limit}`;
		lines.push(`<div class="metric">
			<div class="metric-head"><span class="metric-label">${escapeHtml(metric.label)}</span><span class="metric-window">${escapeHtml(metric.window)}</span></div>
			<div class="bar"><div class="bar-fill" style="width:${Math.min(Math.max(pct, 0), 100)}%"></div></div>
			<div class="metric-value">${escapeHtml(valueLabel)}</div>
			${metric.resetsAt ? `<div id="resets-${escapeHtml(metric.kind)}" class="resets"></div>` : ''}
		</div>`);
	}
	if (msg.lastUpdated !== undefined) {
		lines.push(`<div class="last-updated">${escapeHtml(s.lastUpdated.replace('{0}', new Date(msg.lastUpdated).toLocaleTimeString()))}</div>`);
	}
	if (msg.offline) {
		lines.push(`<div class="offline">${escapeHtml(s.offline)}</div>`);
	}
	return lines.join('');
}

function renderStatusBody(msg: UsagePanelMessage): string {
	const s = msg.strings;
	if (msg.status === 'auth-error') {
		return `<div class="status-message">
			<p>${escapeHtml(s.status['auth-error'])}</p>
			<button id="setKey" class="btn" onclick="var vscode = acquireVsCodeApi(); vscode.postMessage({ type: 'setKey' });">${escapeHtml(s.setKey)}</button>
		</div>`;
	}
	const text = msg.status === 'no-data' && msg.metrics.length === 0
		? (s.status['no-data'])
		: (s.status[msg.status] || s.status['no-data']);
	return `<div class="status-message"><p>${escapeHtml(text)}</p></div>`;
}

function resetsAtMap(msg: UsagePanelMessage): Record<string, number> {
	const map: Record<string, number> = {};
	for (const m of msg.metrics) {
		if (m.resetsAt !== undefined) {
			map[m.kind] = m.resetsAt;
		}
	}
	return map;
}

function themeCss(theme: 'dark' | 'light'): string {
	const dark = theme === 'dark';
	const fg = dark ? '#cccccc' : '#313033';
	const muted = dark ? '#9d9d9d' : '#6d6d6d';
	const accent = dark ? '#3794ff' : '#0066b8';
	const barBg = dark ? '#3a3d41' : '#d4d4d4';
	const border = dark ? '#2d2d2d' : '#e5e5e5';
	return `
		body { font-family: var(--vscode-font-family, sans-serif); color: ${fg}; padding: 16px 20px; margin: 0; }
		.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
		h1 { font-size: 1.1rem; margin: 0; font-weight: 600; }
		.btn { background: var(--vscode-button-background, ${accent}); color: var(--vscode-button-foreground, #fff); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; font-size: 0.85rem; }
		.btn:hover { opacity: 0.9; }
		.plan { color: ${muted}; font-size: 0.9rem; margin-bottom: 2px; }
		.metric { margin: 14px 0; padding-bottom: 14px; border-bottom: 1px solid ${border}; }
		.metric-head { display: flex; justify-content: space-between; margin-bottom: 6px; }
		.metric-label { font-weight: 600; }
		.metric-window { color: ${muted}; font-size: 0.85rem; }
		.bar { background: ${barBg}; border-radius: 2px; height: 8px; overflow: hidden; }
		.bar-fill { background: ${accent}; height: 100%; transition: width 0.2s; }
		.metric-value { margin-top: 4px; font-size: 0.9rem; }
		.resets { color: ${muted}; font-size: 0.8rem; margin-top: 2px; }
		.last-updated { color: ${muted}; font-size: 0.8rem; margin-top: 12px; }
		.offline { color: ${muted}; font-size: 0.8rem; font-style: italic; margin-top: 4px; }
		.status-message { text-align: center; padding: 40px 16px; color: ${muted}; }
		.status-message p { margin-bottom: 16px; }
	`;
}

function themeKind(): 'dark' | 'light' {
	return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'light';
}

function emptyFallbackStrings(): UsagePanelStrings {
	return {
		title: t('usage.panel.title'),
		refresh: t('usage.panel.refresh'),
		setKey: t('usage.panel.setKey'),
		offline: t('usage.panel.offline'),
		unavailable: t('usage.panel.unavailable'),
		lastUpdated: t('usage.panel.lastUpdated'),
		resetsIn: t('usage.metric.resetsIn'),
		plan: t('usage.plan.label'),
		renewsAt: t('usage.plan.renewsAt'),
		window: { session: '', weekly: '', 'web-searches': '' },
		label: { session: '', weekly: '', 'web-searches': '' },
		status: {
			ok: '',
			loading: t('usage.status.loading'),
			'no-data': t('usage.status.no-data'),
			'auth-error': t('usage.status.auth-error'),
			'network-error': t('usage.status.network-error'),
			'server-error': t('usage.status.server-error'),
		},
	};
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function escapeAttr(s: string): string {
	return escapeHtml(s);
}
