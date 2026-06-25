import type { UsageMetric, UsageSnapshot, UsageStatus } from '../types';

export interface UsageMetricView {
	kind: 'session' | 'weekly' | 'web-searches';
	label: string;
	window: string;
	used: number;
	limit: number;
	isPercent: boolean;
	resetsAt?: number;
}

export interface UsagePanelMessage {
	status: UsageStatus;
	planName?: string;
	renewsAt?: string;
	metrics: UsageMetricView[];
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
