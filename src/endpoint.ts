import { ENDPOINTS, EXTERNAL_URLS, USAGE_HOSTS } from './consts';
import { getApiMode, getBaseUrlOverride, getRegion } from './config';

export function normalizeBaseUrl(url: string): string {
	return url.trim().replace(/\/+$/, '');
}

/**
 * Resolve the chat-completions base URL from settings.
 * Override wins; otherwise derive from apiMode (+ region for standard mode).
 */
export function resolveBaseUrl(): string {
	const override = getBaseUrlOverride();
	if (override) {
		return normalizeBaseUrl(override);
	}
	const china = getRegion() === 'china';
	if (getApiMode() === 'coding-plan') {
		return china ? ENDPOINTS.codingPlanChina : ENDPOINTS.codingPlanInternational;
	}
	return china ? ENDPOINTS.standardChina : ENDPOINTS.standardInternational;
}

/** The key-management page that matches the current apiMode/region. */
export function resolveKeyPageUrl(): string {
	const china = getRegion() === 'china';
	if (getApiMode() === 'coding-plan') {
		return china ? EXTERNAL_URLS.codingPlanKeysChina : EXTERNAL_URLS.codingPlanKeysInternational;
	}
	return china ? EXTERNAL_URLS.standardKeysChina : EXTERNAL_URLS.standardKeysInternational;
}

/**
 * Host root for the Coding Plan usage API. Both stations expose the same `/api/biz` (subscription)
 * and `/api/monitor` (quota) paths and JSON shape; only the host differs.
 *
 * Usage paths are a DIFFERENT root than chat (`/api/paas/v4`), so this does not derive from
 * `resolveBaseUrl()`. Routing is by region: china → open.bigmodel.cn, else → api.z.ai.
 */
export function resolveUsageHost(): string {
	return getRegion() === 'china' ? USAGE_HOSTS.china : USAGE_HOSTS.international;
}
