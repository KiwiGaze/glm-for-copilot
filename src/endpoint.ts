import { ENDPOINTS, EXTERNAL_URLS } from './consts';
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
