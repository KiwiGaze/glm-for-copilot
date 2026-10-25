import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { getRegion } from '../config';
import { barWidthCss, metricPercent } from './usage-detail-html';
import type { UsageMetricView, UsagePanelMessage } from './usage-detail-html';
import type { ResetType } from '../types';
import type { UsageStatusBar } from './usage-bar';
import { usagePanelStrings } from './usage-strings';

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
	private themeSub: vscode.Disposable | undefined;
	private lastMessage: UsagePanelMessage | null | undefined;

	private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, bar: UsageStatusBar) {
		this.panel = panel;
		this.bar = bar;

		this.render(this.bar.getSnapshot());

		this.subscription = bar.onDidChangeSnapshot((message) => this.render(message));

		this.themeSub = vscode.window.onDidChangeActiveColorTheme(() => this.render(this.bar.getSnapshot()));

		this.panel.webview.onDidReceiveMessage(
			(message: unknown) => this.onMessage(message),
			undefined,
			context.subscriptions,
		);

		this.panel.onDidDispose(() => this.dispose(), undefined, context.subscriptions);
	}

	/**
	 * Reveal the singleton panel if it exists, otherwise create one bound to `bar`.
	 * The panel subscribes to `bar.onDidChangeSnapshot` and re-renders on every push.
	 */
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

	/** Handle a user action posted by the usage webview. */
	private async onMessage(message: unknown): Promise<void> {
		if (typeof message !== 'object' || message === null || !('type' in message)) {
			return;
		}
		if (message.type === 'refresh') {
			await this.bar.refresh();
		} else if (message.type === 'setKey') {
			await vscode.commands.executeCommand('glm-copilot.setApiKey');
		} else if (message.type === 'checkStandard') {
			await this.bar.checkStandardApi();
		} else if (message.type === 'useReset' && 'resetType' in message &&
			(message.resetType === 'FIVE_HOUR' || message.resetType === 'WEEK')) {
			await this.bar.useResetCard(message.resetType);
		}
	}

	/**
	 * Re-render the panel HTML. Suppresses the transition to `loading` when a non-loading snapshot
	 * is already showing (avoids fltransform on background refresh). Caches the last message.
	 */
	private render(message: UsagePanelMessage | null): void {
		if (message?.status === 'loading' && this.lastMessage != null && this.lastMessage.status !== 'loading') {
			return;
		}
		this.lastMessage = message;
		this.panel.title = t('usage.panel.title');
		this.panel.webview.html = this.buildHtml(message);
	}

	/**
	 * Build the full panel HTML document. Uses a gate-failed fallback message when `message` is null.
	 * Inline scripts run under a nonce CSP; reset-countdown timers are hydrated via `resetsAtMap`.
	 */
	private buildHtml(message: UsagePanelMessage | null): string {
		const nonce = getNonce();
		const theme = themeKind();
		const gateFailed = message === null;
		const effective: UsagePanelMessage = message ?? {
			status: 'no-data',
			metrics: [],
			currency: getRegion() === 'china' ? '¥' : '$',
			offline: false,
			theme,
			strings: usagePanelStrings(),
		};
		const body = gateFailed
			? `<div class="status-message"><p>${escapeHtml(effective.strings.unavailable)}</p></div>`
			: effective.status === 'ok'
				? renderOkBody(effective)
				: renderStatusBody(effective);

		return /* html */ `<!DOCTYPE html>
<html lang="${escapeHtml(vscode.env.language)}">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>${escapeHtml(effective.strings.title)}</title>
	<style nonce="${nonce}">
		${themeCss(theme)}
		${barWidthCss(effective.metrics)}
	</style>
</head>
<body>
	<main class="page">
		<header class="header">
			<div class="heading"><h1>${escapeHtml(effective.strings.title)}</h1>${renderPlan(effective)}</div>
			<button id="refresh" class="btn btn-secondary"><span aria-hidden="true">↻</span> ${escapeHtml(effective.strings.refresh)}</button>
		</header>
		<div id="content">${body}${renderResetCards(effective)}</div>
		${renderFooter(effective)}
	</main>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
		const setKeyBtn = document.getElementById('setKey');
		if (setKeyBtn) setKeyBtn.addEventListener('click', () => vscode.postMessage({ type: 'setKey' }));
		const checkStandardBtn = document.getElementById('checkStandard');
		if (checkStandardBtn) checkStandardBtn.addEventListener('click', () => vscode.postMessage({ type: 'checkStandard' }));
		let resetRequested = ${jsonForScript(effective.resetBusy === true)};
		const resetBlocked = ${jsonForScript(effective.offline)};
		const resetButtons = document.querySelectorAll('[data-reset-type]');
		for (const button of resetButtons) {
			button.addEventListener('click', () => {
				if (button.disabled || resetRequested || resetBlocked) return;
				resetRequested = true;
				for (const other of resetButtons) other.disabled = true;
				vscode.postMessage({ type: 'useReset', resetType: button.dataset.resetType });
			});
		}
		const tickResetCards = () => {
			const dateFormat = new Intl.DateTimeFormat(document.documentElement?.lang, {
				year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
			});
			for (const type of ['FIVE_HOUR', 'WEEK']) {
				const group = document.getElementById('reset-group-' + type);
				if (!group) continue;
				let count = 0;
				for (const expiry of group.querySelectorAll('[data-reset-expiry]')) {
					const time = Number(expiry.dataset.resetExpiry);
					const quantity = Number(expiry.dataset.resetCount);
					expiry.hidden = time <= Date.now();
					if (!expiry.hidden) count += quantity;
					expiry.querySelector('[data-expiry-date]').textContent = ${jsonForScript(effective.strings.resetExpires)}
						.replace('{0}', dateFormat.format(new Date(time)));
				}
				document.getElementById('reset-count-' + type).textContent = ${jsonForScript(effective.strings.resetAvailable)}.replace('{0}', String(count));
				document.getElementById('use-reset-' + type).disabled = resetRequested || resetBlocked || count === 0;
			}
		};
		tickResetCards();
		setInterval(tickResetCards, 1000);
		const resetsAtTimes = ${jsonForScript(resetsAtMap(effective))};
		if (resetsAtTimes && Object.keys(resetsAtTimes).length > 0) {
			const fmt = (ms) => {
				if (ms <= 0) return '0m';
				const d = Math.floor(ms / 86400000);
				const h = Math.floor((ms % 86400000) / 3600000);
				const m = Math.round((ms % 3600000) / 60000);
				if (d > 0) return d + 'd ' + h + 'h';
				if (h > 0 && m > 0) return h + 'h ' + m + 'm';
				if (h > 0) return h + 'h';
				return m + 'm';
			};
			const tick = () => {
				const now = Date.now();
				for (const [key, ts] of Object.entries(resetsAtTimes)) {
					const el = document.getElementById('resets-' + key);
					if (el) el.textContent = ${jsonForScript(effective.strings.resetsIn)}.replace('{0}', fmt(ts - now));
				}
			};
			tick();
			setInterval(tick, 1000);
		}
	</script>
</body>
</html>`;
	}

	/** Dispose subscriptions, theme listener, and the webview panel; clear the singleton reference. */
	dispose(): void {
		this.subscription?.dispose();
		this.themeSub?.dispose();
		this.panel.dispose();
		UsageDetailPanel.currentPanel = undefined;
	}
}

/** Render usage cards with their matching reset inventory and an optional account balance. */
function renderOkBody(msg: UsagePanelMessage): string {
	const lines: string[] = [];
	if (msg.metrics.length > 0) {
		lines.push(`<div class="quota-grid">${msg.metrics.map((metric) => renderMetricCard(msg, metric)).join('')}</div>`);
	}
	if (msg.balance) {
		lines.push(renderBalanceBody(msg));
	}
	if (msg.recoveryReason) {
		lines.push(renderRecoveryCard(msg));
	}
	return lines.join('');
}

function renderMetricCard(msg: UsagePanelMessage, metric: UsageMetricView): string {
	const percent = metricPercent(metric);
	const tone = percent >= 100 ? 'critical' : percent >= 90 ? 'warning' : 'normal';
	const number = new Intl.NumberFormat(vscode.env.language);
	const valueLabel = metric.isPercent ? `${metric.used}%` : `${number.format(metric.used)} / ${number.format(metric.limit)}`;
	const value = metric.isPercent
		? `${escapeHtml(String(metric.used))}<span class="metric-unit">%</span>`
		: `${escapeHtml(number.format(metric.used))}<span class="metric-limit"> / ${escapeHtml(number.format(metric.limit))}</span>`;
	const resetType = metric.kind === 'session' ? 'FIVE_HOUR' : metric.kind === 'weekly' ? 'WEEK' : undefined;
	return `<article class="metric metric-${tone}" data-kind="${metric.kind}">
		<div class="metric-head"><h2>${escapeHtml(metric.label)}</h2><span class="metric-window">${escapeHtml(metric.window)}</span></div>
		<div class="metric-value">${value}<span class="used-label">${escapeHtml(msg.strings.used)}</span></div>
		<div class="bar" role="progressbar" aria-label="${escapeHtml(`${metric.label}: ${valueLabel} ${msg.strings.used}`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><div class="bar-fill" id="fill-${metric.kind}"></div></div>
		${metric.resetsAt ? `<div id="resets-${metric.kind}" class="resets"></div>` : ''}
		${resetType && msg.resetCards ? renderResetGroup(msg, resetType, true) : ''}
	</article>`;
}

function renderPlan(msg: UsagePanelMessage): string {
	if (!msg.planName && !msg.renewsAt) return '';
	return `<div class="plan-meta">${msg.planName ? `<span class="plan-name" title="${escapeHtml(msg.strings.plan.replace('{0}', msg.planName))}">${escapeHtml(msg.planName)}</span>` : ''}
		${msg.renewsAt ? `<span class="plan-renewal">${escapeHtml(msg.strings.renewsAt.replace('{0}', msg.renewsAt))}</span>` : ''}</div>`;
}

function renderFooter(msg: UsagePanelMessage): string {
	const parts: string[] = [];
	if (msg.offline) parts.push(`<span class="offline">${escapeHtml(msg.strings.offline)}</span>`);
	if (msg.resetCards) parts.push(`<span>${escapeHtml(msg.strings.localTime)}</span>`);
	if (msg.lastUpdated !== undefined) {
		parts.push(`<span class="last-updated">${escapeHtml(msg.strings.lastUpdated.replace('{0}', new Date(msg.lastUpdated).toLocaleTimeString()))}</span>`);
	}
	return parts.length > 0 ? `<footer class="page-footer">${parts.join('')}</footer>` : '';
}

/** Show reset inventories separately when their quota card is absent, or a shared load failure. */
function renderResetCards(msg: UsagePanelMessage): string {
	if (msg.resetCards === undefined || (msg.resetCards === null && msg.status !== 'ok')) {
		return '';
	}
	const s = msg.strings;
	if (msg.resetCards === null) {
		return `<section class="reset-unavailable" role="status"><h2>${escapeHtml(s.resetTitle)}</h2><p>${escapeHtml(s.resetUnavailable)}</p></section>`;
	}
	const kinds = msg.status === 'ok' ? new Set(msg.metrics.map((metric) => metric.kind)) : new Set<string>();
	const groups = (['FIVE_HOUR', 'WEEK'] as const)
		.filter((type) => !kinds.has(type === 'FIVE_HOUR' ? 'session' : 'weekly'))
		.map((type) => renderResetGroup(msg, type, false)).join('');
	return groups ? `<section class="reset-section"><h2>${escapeHtml(s.resetTitle)}</h2><div class="reset-grid">${groups}</div></section>` : '';
}

function renderResetGroup(msg: UsagePanelMessage, type: ResetType, embedded: boolean): string {
	const s = msg.strings;
	const dates = new Map<number, number>();
	const available = msg.resetCards![type].filter((expiresAt) => expiresAt > Date.now());
	for (const expiresAt of available) dates.set(expiresAt, (dates.get(expiresAt) ?? 0) + 1);
	const dateFormat = new Intl.DateTimeFormat(vscode.env.language, {
		year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
	});
	const expiryRows = [...dates].sort(([left], [right]) => left - right).map(([expiresAt, count]) =>
		`<li data-reset-expiry="${expiresAt}" data-reset-count="${count}"><span class="expiry-quantity">×${count}</span><span data-expiry-date title="${new Date(expiresAt).toISOString()}">${escapeHtml(s.resetExpires.replace('{0}', dateFormat.format(new Date(expiresAt))))}</span></li>`,
	).join('');
	return `<section class="reset-group" id="reset-group-${type}" aria-label="${escapeHtml(s.resetLabels[type])}">
		<div class="reset-heading"><h3>${escapeHtml(embedded ? s.resetTitle : s.resetLabels[type])}</h3><span class="available-badge" id="reset-count-${type}">${escapeHtml(s.resetAvailable.replace('{0}', String(available.length)))}</span></div>
		<ul class="reset-expiries">${expiryRows}</ul>
		<div class="reset-actions"><button class="btn btn-secondary" id="use-reset-${type}" data-reset-type="${type}" aria-label="${escapeHtml(`${s.resetUse}: ${s.resetLabels[type]}`)}"${msg.resetBusy || msg.offline || available.length === 0 ? ' disabled' : ''}>${escapeHtml(msg.resetBusy ? s.resetProcessing : s.resetUse)}</button></div>
	</section>`;
}

/** Render the HTML for the Standard API balance section: cash rows (right-aligned values) + token packages. */
function renderBalanceBody(msg: UsagePanelMessage): string {
	const s = msg.strings;
	const b = msg.balance!;
	const c = msg.currency;
	const lines: string[] = [`<div class="balance-section"><h2>${escapeHtml(s.balanceSection)}</h2>`];
	if (b.availableCash !== undefined) {
		lines.push(`<div class="balance-row"><span>${escapeHtml(s.balanceAvailable)}</span><span class="balance-value">${escapeHtml(c)}${escapeHtml(b.availableCash)}</span></div>`);
	}
	if (b.totalRecharged !== undefined) {
		lines.push(`<div class="balance-row"><span>${escapeHtml(s.balanceRecharged)}</span><span class="balance-value">${escapeHtml(c)}${escapeHtml(b.totalRecharged)}</span></div>`);
	}
	if (b.giftedAmount !== undefined && b.giftedAmount !== '0') {
		lines.push(`<div class="balance-row"><span>${escapeHtml(s.balanceGifted)}</span><span class="balance-value">${escapeHtml(c)}${escapeHtml(b.giftedAmount)}</span></div>`);
	}
	if (b.totalSpent !== undefined) {
		lines.push(`<div class="balance-row"><span>${escapeHtml(s.balanceSpent)}</span><span class="balance-value">${escapeHtml(c)}${escapeHtml(b.totalSpent)}</span></div>`);
	}
	if (b.frozenAmount !== undefined && b.frozenAmount !== '0') {
		lines.push(`<div class="balance-row"><span>${escapeHtml(s.balanceFrozen)}</span><span class="balance-value">${escapeHtml(c)}${escapeHtml(b.frozenAmount)}</span></div>`);
	}
	if (b.tokenPackages.length > 0) {
		lines.push(`<div class="balance-packages">${escapeHtml(s.balancePackages)}</div>`);
		for (const pkg of b.tokenPackages) {
			const modelLabel = pkg.model ? ` <span class="pkg-model">(${escapeHtml(pkg.model)})</span>` : '';
			lines.push(`<div class="balance-row"><span>${escapeHtml(pkg.name)}${modelLabel}</span><span class="balance-value">${escapeHtml(pkg.tokens)} tokens</span></div>`);
		}
	}
	lines.push('</div>');
	return lines.join('');
}

/** Render the HTML body for non-ok statuses: a centered message, plus a Set-Key button on auth errors. */
function renderStatusBody(msg: UsagePanelMessage): string {
	const s = msg.strings;
	if (msg.recoveryReason === 'coding-plan-unavailable') {
		return renderRecoveryCard(msg);
	}
	if (msg.status === 'auth-error') {
		return `<div class="status-message">
			<p>${escapeHtml(s.status['auth-error'])}</p>
			<button id="setKey" class="btn">${escapeHtml(s.setKey)}</button>
		</div>`;
	}
	const text = msg.status === 'no-data' && msg.metrics.length === 0
		? (s.status['no-data'])
		: (s.status[msg.status] || s.status['no-data']);
	return `<div class="status-message"><p>${escapeHtml(text)}</p></div>`;
}

/** Render the opt-in Standard API balance check for a recoverable Coding Plan state. */
function renderRecoveryCard(msg: UsagePanelMessage): string {
	const copy = msg.recoveryReason === 'coding-plan-exhausted'
		? msg.strings.recoveryExhausted
		: msg.strings.recoveryUnavailable;
	return `<div class="recovery-card">
		<p>${escapeHtml(copy)}</p>
		<button id="checkStandard" class="btn">${escapeHtml(msg.strings.checkStandard)}</button>
	</div>`;
}

/** Collect `{ kind: resetsAt }` for metrics that have a reset time, to hydrate the client-side countdown. */
function resetsAtMap(msg: UsagePanelMessage): Record<string, number> {
	const map: Record<string, number> = {};
	for (const m of msg.metrics) {
		if (m.resetsAt !== undefined) {
			map[m.kind] = m.resetsAt;
		}
	}
	return map;
}

/** Generate the panel's theme CSS string, switching colors by dark/light token. */
function themeCss(theme: 'dark' | 'light'): string {
	const dark = theme === 'dark';
	return `
		:root { color-scheme: ${dark ? 'dark' : 'light'}; --fg: var(--vscode-foreground, ${dark ? '#d4d4d4' : '#252526'}); --muted: var(--vscode-descriptionForeground, ${dark ? '#a1a1aa' : '#66666f'}); --accent: var(--vscode-textLink-foreground, ${dark ? '#75beff' : '#006ab1'}); --border: var(--vscode-widget-border, ${dark ? '#3b3b3f' : '#dedee3'}); --surface: var(--vscode-sideBar-background, ${dark ? '#252526' : '#f8f8fa'}); }
		* { box-sizing: border-box; }
		body { margin: 0; color: var(--fg); background: var(--vscode-editor-background, ${dark ? '#1f1f1f' : '#ffffff'}); font-family: var(--vscode-font-family, system-ui, sans-serif); font-size: 13px; line-height: 1.5; }
		.page { max-width: 1120px; margin: 0 auto; padding: 28px; }
		.header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 24px; }
		.heading { min-width: 0; }
		h1 { margin: 0; font-size: 22px; line-height: 1.3; font-weight: 600; letter-spacing: -0.4px; }
		.plan-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 10px; color: var(--muted); font-size: 12px; }
		.plan-name { background: var(--surface); border: 1px solid var(--border); border-radius: 5px; color: var(--fg); padding: 2px 8px; overflow-wrap: anywhere; }
		.btn { display: inline-flex; justify-content: center; align-items: center; gap: 6px; flex-shrink: 0; min-height: 34px; padding: 6px 12px; font: inherit; font-weight: 500; border: 1px solid transparent; border-radius: 5px; cursor: pointer; background: var(--vscode-button-background, #0078d4); color: var(--vscode-button-foreground, #ffffff); }
		.btn:hover:not(:disabled) { filter: brightness(1.08); }
		.btn-secondary { color: var(--fg); border-color: var(--border); background: transparent; }
		.btn-secondary:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, ${dark ? '#ffffff0d' : '#00000008'}); }
		.btn:focus-visible { outline: 2px solid var(--vscode-focusBorder, #007fd4); outline-offset: 3px; }
		.btn:disabled { opacity: 0.45; cursor: default; }
		.quota-grid, .reset-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
		.metric { min-width: 0; display: flex; flex-direction: column; padding: 22px; background: var(--surface); border: 1px solid var(--border); border-radius: 9px; }
		.metric-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
		.metric-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
		.metric-window { color: var(--muted); font-size: 11px; border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
		.metric-value { display: flex; align-items: baseline; flex-wrap: wrap; margin: 16px 0 13px; font-size: 42px; font-weight: 600; line-height: 1.1; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
		.metric-unit { font-size: 25px; margin-left: 1px; }
		.metric-limit { font-size: 19px; color: var(--muted); white-space: pre; letter-spacing: 0; }
		.used-label { font-size: 12px; font-weight: 400; color: var(--muted); margin-left: 8px; letter-spacing: 0; }
		.bar { height: 6px; border-radius: 4px; overflow: hidden; background: var(--vscode-progressBar-background, ${dark ? '#75beff' : '#0078d4'}); background: color-mix(in srgb, var(--fg) 12%, transparent); }
		.bar-fill { height: 100%; width: 0; border-radius: inherit; background: var(--accent); transition: width 0.2s; }
		.metric-warning .bar-fill { background: var(--vscode-notificationsWarningIcon-foreground, ${dark ? '#d7ba7d' : '#986800'}); }
		.metric-warning .metric-value { color: var(--vscode-notificationsWarningIcon-foreground, ${dark ? '#d7ba7d' : '#986800'}); }
		.metric-critical .bar-fill { background: var(--vscode-errorForeground, #f14c4c); }
		.metric-critical .metric-value { color: var(--vscode-errorForeground, #f14c4c); }
		.resets { color: var(--muted); font-size: 12px; margin-top: 9px; }
		.metric[data-kind="web-searches"] { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; column-gap: 32px; row-gap: 10px; }
		.metric[data-kind="web-searches"] .metric-head { grid-column: 1; grid-row: 1; }
		.metric[data-kind="web-searches"] .metric-value { grid-column: 1; grid-row: 2; margin: 0; font-size: 28px; }
		.metric[data-kind="web-searches"] .bar { grid-column: 2; grid-row: 1; align-self: center; }
		.metric[data-kind="web-searches"] .resets { grid-column: 2; grid-row: 2; align-self: center; margin: 0; }
		.reset-group { min-width: 0; }
		.metric .reset-group { display: flex; flex-direction: column; flex: 1; border-top: 1px solid var(--border); margin-top: 20px; padding-top: 16px; }
		.reset-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
		.reset-heading h3 { font-size: 12px; font-weight: 500; margin: 0; color: var(--muted); }
		.available-badge { color: var(--fg); border: 1px solid var(--border); border-radius: 20px; padding: 1px 8px; font-size: 11px; font-variant-numeric: tabular-nums; }
		.reset-expiries { margin: 12px 0; padding: 0; list-style: none; color: var(--muted); font-size: 12px; }
		.reset-expiries li { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; }
		.reset-expiries li[hidden] { display: none; }
		.expiry-quantity { flex-shrink: 0; min-width: 24px; font-variant-numeric: tabular-nums; color: var(--fg); }
		.reset-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 14px; }
		.metric .reset-actions { margin-top: auto; padding-top: 2px; }
		.reset-actions .btn { color: var(--accent); }
		.reset-section { margin-top: 20px; }
		.reset-section h2 { margin: 0 0 12px; font-size: 14px; }
		.reset-grid > .reset-group { padding: 20px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); }
		.reset-unavailable { margin-top: 16px; padding: 16px 20px; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); }
		.reset-unavailable h2 { margin: 0 0 4px; font-size: 13px; color: var(--fg); }
		.reset-unavailable p { margin: 0; }
		.page-footer { display: flex; flex-wrap: wrap; gap: 6px 20px; color: var(--muted); font-size: 11px; margin-top: 18px; }
		.last-updated { margin-left: auto; }
		.offline { color: var(--vscode-notificationsWarningIcon-foreground, ${dark ? '#d7ba7d' : '#986800'}); }
		.status-message { text-align: center; padding: 40px 20px; color: var(--muted); border: 1px solid var(--border); border-radius: 9px; }
		.status-message p { margin: 0 0 16px; }
		.recovery-card { margin-top: 16px; padding: 18px 20px; border: 1px solid var(--border); border-radius: 9px; background: var(--vscode-editorWidget-background, var(--surface)); }
		.recovery-card p { margin: 0 0 12px; line-height: 1.6; }
		.balance-section { padding: 22px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); }
		.balance-section h2 { font-size: 14px; margin: 0 0 16px; }
		.balance-row { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; font-size: 13px; }
		.balance-value { font-weight: 600; font-variant-numeric: tabular-nums; }
		.balance-packages { margin-top: 16px; font-weight: 600; font-size: 12px; color: var(--muted); }
		.pkg-model { font-weight: 400; color: var(--muted); font-size: 12px; }
		@media (max-width: 720px) { .quota-grid, .reset-grid { grid-template-columns: 1fr; } .metric[data-kind="web-searches"] { display: flex; gap: 0; } .metric[data-kind="web-searches"] .metric-value { margin: 16px 0 13px; } .metric[data-kind="web-searches"] .bar { width: 100%; align-self: stretch; } .metric[data-kind="web-searches"] .resets { margin-top: 9px; align-self: stretch; } }
		@media (max-width: 480px) { .page { padding: 20px 16px; } .header { gap: 12px; } .metric { padding: 18px; } .reset-actions { align-items: flex-start; flex-direction: column; } .reset-actions .btn { width: 100%; } .last-updated { margin-left: 0; } }
		@media (prefers-reduced-motion: reduce) { .bar-fill { transition: none; } }
	`;
}

/** Map the VS Code color theme to a dark/light token (high-contrast counted as dark). */
function themeKind(): 'dark' | 'light' {
	const kind = vscode.window.activeColorTheme.kind;
	return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast ? 'dark' : 'light';
}

/** Generate a CSP nonce for the panel's `<style>` / `<script>` elements. */
function getNonce(): string {
	return randomBytes(16).toString('base64');
}

/** Escape `& < > " '` for safe interpolation into HTML. */
function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** JSON-stringify a value for inline `<script>` interpolation, escaping `<` to prevent tag-break-out. */
function jsonForScript(value: unknown): string {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}
