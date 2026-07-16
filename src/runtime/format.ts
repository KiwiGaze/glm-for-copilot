/** Shared formatting helpers for cash amounts and compact token counts. */

/** Format a cash amount with up to 2 decimal places, stripping trailing zeros. */
export function formatAmount(value: number): string {
	return value.toFixed(2).replace(/\.?0+$/, '') || '0';
}

/** Format a token count with K/M/B/T suffixes for compact status-bar display (e.g. `8M`, `1.2B`). */
export function formatTokens(tokens: number): string {
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
