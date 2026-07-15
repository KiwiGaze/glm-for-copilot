import type { TokenPackage, UsageBalance, UsageMetric, UsageSnapshot, UsageStatus } from '../types';

export interface UsageMetricView {
	kind: 'session' | 'weekly' | 'web-searches';
	label: string;
	window: string;
	used: number;
	limit: number;
	isPercent: boolean;
	resetsAt?: number;
}

export interface TokenPackageView {
	name: string;
	tokens: string;
	status: string;
	model?: string;
}

export interface UsageBalanceView {
	availableCash?: string;
	totalRecharged?: string;
	totalSpent?: string;
	giftedAmount?: string;
	frozenAmount?: string;
	tokenPackages: TokenPackageView[];
}

export interface UsagePanelMessage {
	status: UsageStatus;
	planName?: string;
	renewsAt?: string;
	metrics: UsageMetricView[];
	balance?: UsageBalanceView;
	lastUpdated?: number;
	offline: boolean;
	theme: 'dark' | 'light';
	strings: UsagePanelStrings;
}

export interface UsagePanelStrings {
	title: string;
	refresh: string;
	setKey: string;
	offline: string;
	unavailable: string;
	lastUpdated: string;
	resetsIn: string;
	plan: string;
	renewsAt: string;
	window: Record<UsageMetric['kind'], string>;
	label: Record<UsageMetric['kind'], string>;
	status: Record<UsageStatus, string>;
	balanceSection: string;
	balanceAvailable: string;
	balanceRecharged: string;
	balanceSpent: string;
	balanceGifted: string;
	balanceFrozen: string;
	balancePackages: string;
}

/**
 * Convert a UsageSnapshot (the bar's effective state) into the render-ready view model that the
 * detail panel bakes into its HTML server-side. Returns null when there is no snapshot to show
 * (gate failed while pane is open). Pure: no VS Code dependency.
 */
export function buildUsageMessage(
	snapshot: UsageSnapshot | null,
	offline: boolean,
	strings: UsagePanelStrings,
	theme: 'dark' | 'light',
): UsagePanelMessage | null {
	if (snapshot === null) {
		return null;
	}
	return {
		status: snapshot.status,
		planName: snapshot.planName,
		renewsAt: snapshot.renewsAt,
		metrics: snapshot.metrics.map(toMetricView, strings),
		balance: snapshot.balance ? toBalanceView(snapshot.balance) : undefined,
		lastUpdated: snapshot.status === 'ok' ? snapshot.fetchedAt : undefined,
		offline,
		theme,
		strings,
	};
}

function toMetricView(this: UsagePanelStrings, metric: UsageMetric): UsageMetricView {
	const isPercent = metric.kind === 'session' || metric.kind === 'weekly';
	return {
		kind: metric.kind,
		label: this.label[metric.kind],
		window: this.window[metric.kind],
		used: metric.used,
		limit: metric.limit,
		isPercent,
		resetsAt: metric.resetsAt,
	};
}

function toBalanceView(balance: UsageBalance): UsageBalanceView {
	return {
		availableCash: balance.availableCash !== undefined ? formatAmount(balance.availableCash) : undefined,
		totalRecharged: balance.totalRecharged !== undefined ? formatAmount(balance.totalRecharged) : undefined,
		totalSpent: balance.totalSpent !== undefined ? formatAmount(balance.totalSpent) : undefined,
		giftedAmount: balance.giftedAmount !== undefined ? formatAmount(balance.giftedAmount) : undefined,
		frozenAmount: balance.frozenAmount !== undefined ? formatAmount(balance.frozenAmount) : undefined,
		tokenPackages: balance.tokenPackages.map(toPackageView),
	};
}

function toPackageView(pkg: TokenPackage): TokenPackageView {
	const tokens = pkg.remainingTokens * pkg.magnitude;
	return {
		name: pkg.name,
		tokens: formatTokens(tokens),
		status: pkg.status,
		model: pkg.model,
	};
}

function formatAmount(value: number): string {
	return value.toFixed(2).replace(/\.?0+$/, '') || '0';
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000_000_000) {
		return `${(tokens / 1_000_000_000_000).toFixed(1).replace(/\.0$/, '')}T`;
	}
	if (tokens >= 1_000_000_000) {
		return `${(tokens / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
	}
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
	}
	return String(tokens);
}

/** Bar fill width for a metric, as a clamped 0..100 integer percent. */
export function metricPercent(view: UsageMetricView): number {
	const raw = view.isPercent ? view.used : Math.round((view.used / Math.max(view.limit, 1)) * 100);
	return Math.min(Math.max(raw, 0), 100);
}

/**
 * CSS rules that size each bar fill, one `#fill-<kind>{width:N%}` per metric. Injected into the
 * panel's nonce'd <style> element so the width survives the webview CSP, which strips inline
 * style="" attributes (a nonce authorizes <style> elements, never style attributes).
 */
export function barWidthCss(metrics: UsageMetricView[]): string {
	return metrics.map((m) => `#fill-${m.kind}{width:${metricPercent(m)}%}`).join('\n');
}
