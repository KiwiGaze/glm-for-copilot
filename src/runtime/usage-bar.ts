import * as vscode from 'vscode';
import { getApiMode, getBaseUrlOverride, getRegion, getShowUsageStatusBar, getUsageRefreshIntervalMinutes } from '../config';
import { API_KEY_SECRET, USAGE_CACHE_STALE_MS, USAGE_MANUAL_DEBOUNCE_MS } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import type { IAuthManager, UsageSnapshot } from '../types';
import { isAbortError } from '../client/errors';
import type { IUsageClient } from '../client/usage';
import { buildUsageMessage, type UsagePanelMessage } from './usage-detail-html';
import { UsageDetailPanel } from './usage-detail-panel';
import { formatAmount, formatTokens } from './format';
import { usagePanelStrings } from './usage-strings';

/**
 * Status-bar item showing GLM usage/balance. Coding Plan shows session/weekly/web-search quota;
 * Standard API shows cash balance + token packages. Both apiModes × both regions are supported.
 * Constructed inside `registerProvider` (where AuthManager lives). Registers its own refresh command.
 *
 * Gate: the item shows AND fetches only when no `baseUrl` override is set, a key is present, and the
 * user has not opted out via `showUsageStatusBar`.
 */
export class UsageStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private readonly client: IUsageClient;
	private readonly auth: IAuthManager;

	private refreshPromise: Promise<void> | null = null;
	private lastFetchAt = 0;
	private lastOk: UsageSnapshot | null = null;
	private intervalHandle: ReturnType<typeof setInterval> | null = null;
	private controller: AbortController | null = null;
	private readonly _onDidChange = new vscode.EventEmitter<UsagePanelMessage | null>();
	readonly onDidChangeSnapshot = this._onDidChange.event;
	private lastRendered: UsagePanelMessage | null = null;

	constructor(
		context: vscode.ExtensionContext,
		auth: IAuthManager,
		client: IUsageClient,
	) {
		this.auth = auth;
		this.client = client;
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
		this.item.command = 'glm-copilot.openUsageDetail';
		this.item.name = 'GLM Usage';

		context.subscriptions.push(
			this.item,
			vscode.commands.registerCommand('glm-copilot.refreshUsage', () => {
				void this.refresh();
			}),
			vscode.commands.registerCommand('glm-copilot.openUsageDetail', () => {
				UsageDetailPanel.createOrShow(context, this);
			}),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('glm-copilot')) {
					void this.onConfigOrKeyChange().catch((error) => logger.warn('Usage gate check failed', error));
				}
			}),
			context.secrets.onDidChange((event) => {
				if (event.key === API_KEY_SECRET) {
					void this.onConfigOrKeyChange().catch((error) => logger.warn('Usage gate check failed', error));
				}
			}),
		);

		// Initial gate evaluation: show + first fetch + arm interval if gate passes.
		void this.onConfigOrKeyChange().catch((error) => logger.warn('Usage gate check failed', error));
	}

	/** Manual + interval entry point. Serialized + debounced. */
	refresh(): Promise<void> {
		if (this.refreshPromise) {
			return this.refreshPromise;
		}
		const now = Date.now();
		if (now - this.lastFetchAt < USAGE_MANUAL_DEBOUNCE_MS) {
			return Promise.resolve();
		}
		const refresh = this.runRefresh()
			.catch((error) => logger.warn('Usage refresh failed', error))
			.finally(() => {
				if (this.refreshPromise !== refresh) {
					return;
				}
				this.refreshPromise = null;
			});
		this.refreshPromise = refresh;
		return this.refreshPromise;
	}

	/**
	 * Evaluate the gate, fetch usage/balance, and render the result. Aborts any in-flight fetch.
	 * On gate failure: hide the bar + stop the interval. On fetch error: render a network-error
	 * snapshot (unless the error is an abort, which is expected during cancellation).
	 */
	private async runRefresh(): Promise<void> {
		const gate = await this.evaluateGate();
		if (!gate.passed) {
			this.item.hide();
			this.stopInterval();
			this.lastRendered = null;
			this._onDidChange.fire(null);
			return;
		}
		this.lastFetchAt = Date.now();
		this.render({ status: 'loading', metrics: [], fetchedAt: Date.now() });
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		try {
			const snapshot = await this.fetchUsage(gate.apiKey, controller.signal);
			if (snapshot.status === 'ok') {
				this.lastOk = snapshot;
			}
			this.render(snapshot);
		} catch (error) {
			if (isAbortError(error)) {
				logger.warn('Usage fetch aborted');
				return;
			}
			logger.warn('Usage fetch threw', error);
			this.render({ status: 'network-error', metrics: [], fetchedAt: Date.now() });
		}
	}

	/**
	 * Decide whether the status bar should be visible. Passes when no `baseUrl` override is set,
	 * the user has opted in (`showUsageStatusBar`), and an API key is present. Both apiModes ×
	 * both regions are eligible — the usage/balance endpoints exist on both stations.
	 */
	private async evaluateGate(): Promise<{ passed: true; apiKey: string } | { passed: false }> {
		// Both apiModes (Coding Plan + Standard API) and both regions (z.ai + bigmodel.cn) are
		// supported. The usage/balance endpoints exist on both stations' biz gateways and share
		// the same JSON shape. Only gate on baseUrl override, opt-in, and key presence.
		if (
			getBaseUrlOverride() !== '' ||
			!getShowUsageStatusBar()
		) {
			return { passed: false };
		}
		const apiKey = await this.auth.getApiKey();
		if (!apiKey) {
			return { passed: false };
		}
		return { passed: true, apiKey };
	}

	/** Route to fetchSnapshot (Coding Plan) or fetchBalance (Standard API) based on apiMode. */
	private fetchUsage(apiKey: string, signal: AbortSignal): Promise<UsageSnapshot> {
		return getApiMode() === 'standard'
			? this.client.fetchBalance(apiKey, signal)
			: this.client.fetchSnapshot(apiKey, signal);
	}

	/**
	 * Render a snapshot to the status bar (text + tooltip + background) and fire the panel message.
	 * On network/server error with a fresh cache (< 1h), falls back to the last `ok` snapshot
	 * marked `offline`. Resets the warning background; ok-state renderers may set it.
	 */
	private render(snapshot: UsageSnapshot): void {
		const now = Date.now();
		const cacheUsable = this.lastOk && now - this.lastOk.fetchedAt < USAGE_CACHE_STALE_MS;
		let offline = false;

		// Reset warning background by default; ok-state renderers may set it for critical values.
		this.item.backgroundColor = undefined;

		let effective: UsageSnapshot = snapshot;
		if ((snapshot.status === 'network-error' || snapshot.status === 'server-error') && cacheUsable) {
			effective = { ...this.lastOk! };
			offline = true;
		}

		switch (effective.status) {
			case 'loading':
				this.item.text = '$(pulse) GLM';
				this.item.tooltip = t('usage.status.loading');
				this.item.show();
				break;
			case 'ok':
				this.renderOkBar(effective, offline);
				break;
			case 'no-data':
				this.item.text = '$(dash) GLM';
				this.item.tooltip = t('usage.status.no-data');
				this.item.show();
				break;
			case 'auth-error':
				this.item.text = '$(warning) GLM';
				this.item.tooltip = t('usage.status.auth-error');
				this.item.show();
				break;
			case 'network-error':
			case 'server-error':
				this.item.text = snapshot.status === 'network-error' ? '$(plug) GLM' : '$(warning) GLM';
				this.item.tooltip =
					snapshot.status === 'network-error' ? t('usage.status.network-error') : t('usage.status.server-error');
				this.item.show();
				break;
		}

		this.fireEffective(effective, offline);
	}

	/** Status-bar rendering for the ok state (text + tooltip). Pane gets the structured message via fireEffective. */
	private renderOkBar(snapshot: UsageSnapshot, offline: boolean): void {
		if (snapshot.balance) {
			this.renderOkBarBalance(snapshot, offline);
			return;
		}
		const primary = snapshot.metrics.find((m) => m.kind === 'session') ?? snapshot.metrics[0];
		if (!primary) {
			this.item.text = '$(sparkle) GLM';
		} else if (primary.kind === 'web-searches') {
			this.item.text = `$(sparkle) GLM ${primary.used} / ${primary.limit}`;
		} else {
			this.item.text = t('usage.status.ok.short', String(primary.used));
		}
		const lines: string[] = [];
		if (snapshot.planName) {
			lines.push(t('usage.plan.label', snapshot.planName));
		}
		if (snapshot.renewsAt) {
			lines.push(t('usage.plan.renewsAt', snapshot.renewsAt));
		}
		for (const metric of snapshot.metrics) {
			const label =
				metric.kind === 'session' ? t('usage.metric.session') :
				metric.kind === 'weekly' ? t('usage.metric.weekly') :
				t('usage.metric.webSearches');
			const detail = metric.kind === 'web-searches'
				? `${metric.used} / ${metric.limit}`
				: `${metric.used}%`;
			lines.push(`${label}: ${detail}`);
			if (metric.resetsAt) {
				lines.push('  ' + t('usage.metric.resetsAt', new Date(metric.resetsAt).toLocaleString()));
			}
		}
		lines.push(t('usage.tooltip.lastUpdated', new Date(snapshot.fetchedAt).toLocaleTimeString()));
		if (offline) {
			lines.push(t('usage.tooltip.offline'));
		}
		this.item.tooltip = lines.join('\n');
		// Critical: any percentage metric at 100% → error background.
		const exhausted = snapshot.metrics.some((m) => m.limit > 0 && m.used >= m.limit);
		this.item.backgroundColor = exhausted
			? new vscode.ThemeColor('statusBarItem.errorBackground')
			: undefined;
		this.item.show();
	}

	/** Status-bar rendering for the Standard API balance (cash + token packages). */
	private renderOkBarBalance(snapshot: UsageSnapshot, offline: boolean): void {
		const bal = snapshot.balance!;
		const cash = bal.availableCash;
		const packages = bal.tokenPackages;
		const totalTokens = packages.reduce((sum, p) => sum + p.remainingTokens * p.magnitude, 0);
		const currency = getRegion() === 'china' ? '¥' : '$';

		if (cash !== undefined && totalTokens > 0) {
			this.item.text = `$(wallet) GLM ${currency}${formatAmount(cash)} · ${formatTokens(totalTokens)}`;
		} else if (cash !== undefined) {
			this.item.text = `$(wallet) GLM ${currency}${formatAmount(cash)}`;
		} else if (totalTokens > 0) {
			this.item.text = `$(sparkle) GLM ${formatTokens(totalTokens)}`;
		} else {
			this.item.text = '$(dash) GLM';
		}

		const lines: string[] = [];
		if (cash !== undefined) {
			lines.push(`${t('usage.balance.available')}: ${currency}${formatAmount(cash)}`);
		}
		if (bal.totalRecharged !== undefined) {
			lines.push(`${t('usage.balance.recharged')}: ${currency}${formatAmount(bal.totalRecharged)}`);
		}
		if (bal.giftedAmount !== undefined && bal.giftedAmount > 0) {
			lines.push(`${t('usage.balance.gifted')}: ${currency}${formatAmount(bal.giftedAmount)}`);
		}
		if (bal.totalSpent !== undefined) {
			lines.push(`${t('usage.balance.spent')}: ${currency}${formatAmount(bal.totalSpent)}`);
		}
		if (bal.frozenAmount !== undefined && bal.frozenAmount > 0) {
			lines.push(`${t('usage.balance.frozen')}: ${currency}${formatAmount(bal.frozenAmount)}`);
		}
		for (const pkg of packages) {
			const tokens = pkg.remainingTokens * pkg.magnitude;
			lines.push(`${pkg.name}: ${formatTokens(tokens)}`);
		}
		lines.push(t('usage.tooltip.lastUpdated', new Date(snapshot.fetchedAt).toLocaleTimeString()));
		if (offline) {
			lines.push(t('usage.tooltip.offline'));
		}
		this.item.tooltip = lines.join('\n');
		// Critical: no usable credit (cash absent/≤0 AND no token packages) → error background.
		const broke = (cash === undefined || cash <= 0) && totalTokens <= 0;
		this.item.backgroundColor = broke
			? new vscode.ThemeColor('statusBarItem.errorBackground')
			: undefined;
		this.item.show();
	}

	/**
	 * Re-evaluate the gate after settings or the stored key change. Aborts any in-flight fetch,
	 * drops the cached snapshot from the previous key/region, and bypasses the manual debounce so
	 * the next render reflects the new configuration immediately.
	 */
	private async onConfigOrKeyChange(): Promise<void> {
		this.controller?.abort();
		this.refreshPromise = null;
		this.lastOk = null;
		const gate = await this.evaluateGate();
		if (!gate.passed) {
			this.item.hide();
			this.stopInterval();
			this.lastRendered = null;
			this._onDidChange.fire(null);
			return;
		}
		this.stopInterval();
		this.startInterval();
		this.lastFetchAt = 0;
		void this.refresh();
	}

	/** Arm the auto-refresh interval from `getUsageRefreshIntervalMinutes`; replaces any existing handle. */
	private startInterval(): void {
		const minutes = getUsageRefreshIntervalMinutes();
		this.intervalHandle = setInterval(() => {
			void this.refresh();
		}, minutes * 60_000);
	}

	/** Clear the auto-refresh interval if armed. */
	private stopInterval(): void {
		if (this.intervalHandle !== null) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}
	}

	/** Dispose the status bar item, abort any in-flight fetch, and stop auto-refresh. */
	dispose(): void {
		this.stopInterval();
		this.controller?.abort();
		this.item.dispose();
		this._onDidChange.dispose();
	}

	/** Latest effective snapshot message (post-cache-fallback), or null before first render / after gate fail. */
	getSnapshot(): UsagePanelMessage | null {
		return this.lastRendered;
	}

	/** Build a UsagePanelMessage from the effective state and fire the emitter + cache it. */
	private fireEffective(snapshot: UsageSnapshot, offline: boolean): void {
		const currency = getRegion() === 'china' ? '¥' : '$';
		const message = buildUsageMessage(snapshot, offline, usagePanelStrings(), currentThemeKind(), currency);
		this.lastRendered = message;
		this._onDidChange.fire(message);
	}
}

/** Map the active VS Code color theme to a light/dark token for the detail panel. */
function currentThemeKind(): 'dark' | 'light' {
	return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'light';
}
