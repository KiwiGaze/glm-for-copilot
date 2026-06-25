import { t } from '../i18n';
import type { UsagePanelStrings } from './usage-detail-html';

/**
 * The full set of localized strings the usage panel renders. Built in one place so the status bar
 * (live messages) and the detail panel (gate-failed fallback) share a single source of truth.
 */
export function usagePanelStrings(): UsagePanelStrings {
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
		window: {
			session: t('usage.metric.window.session'),
			weekly: t('usage.metric.window.weekly'),
			'web-searches': t('usage.metric.window.webSearches'),
		},
		label: {
			session: t('usage.metric.session'),
			weekly: t('usage.metric.weekly'),
			'web-searches': t('usage.metric.webSearches'),
		},
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
