import * as vscode from 'vscode';
import { getApiMode, getBaseUrlOverride, getRegion, getShowUsageStatusBar, getUsageRefreshIntervalMinutes } from '../config';
import { API_KEY_SECRET, USAGE_CACHE_STALE_MS, USAGE_MANUAL_DEBOUNCE_MS } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import type { IAuthManager, UsageSnapshot } from '../types';
import type { IUsageClient } from '../client/usage';
import { buildUsageMessage, type UsagePanelMessage } from './usage-detail-html';
import { UsageDetailPanel } from './usage-detail-panel';
import { usagePanelStrings } from './usage-strings';

/**
 * Status-bar item showing z.ai Coding Plan quota usage. Constructed inside
 * `registerProvider` (where AuthManager lives). Registers its own refresh command.
 *
 * Gate (§5 of spec): the item shows AND fetches only when apiMode=coding-plan,
 * region=international, no baseUrl override, a key is present, and the user has
 * not opted out. The gate is re-checked inside refresh() — a racing timer tick
 * cannot bypass it.
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
			const snapshot = await this.client.fetchSnapshot(gate.apiKey, controller.signal);
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

	private async evaluateGate(): Promise<{ passed: true; apiKey: string } | { passed: false }> {
		if (
			getApiMode() !== 'coding-plan' ||
			getRegion() !== 'international' ||
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

	private render(snapshot: UsageSnapshot): void {
		const now = Date.now();
		const cacheUsable = this.lastOk && now - this.lastOk.fetchedAt < USAGE_CACHE_STALE_MS;
		let offline = false;

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

	private startInterval(): void {
		const minutes = getUsageRefreshIntervalMinutes();
		this.intervalHandle = setInterval(() => {
			void this.refresh();
		}, minutes * 60_000);
	}

	private stopInterval(): void {
		if (this.intervalHandle !== null) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}
	}

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
		const message = buildUsageMessage(snapshot, offline, usagePanelStrings(), currentThemeKind());
		this.lastRendered = message;
		this._onDidChange.fire(message);
	}
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function currentThemeKind(): 'dark' | 'light' {
	return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'light';
}
