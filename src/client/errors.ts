import { resolveKeyPageUrl } from '../endpoint';
import { t } from '../i18n';
import { safeStringify } from '../json';

/** Hostnames that are official GLM endpoints (used to gate the create-key link). */
const OFFICIAL_API_HOSTS = ['api.z.ai', 'open.bigmodel.cn'];

/** Maximum length for a single diagnostic field before truncation. */
const MAX_DIAGNOSTIC_FIELD_LENGTH = 300;

/** VS Code command URI that opens the API-key prompt. */
const SET_API_KEY_COMMAND = 'command:glm-copilot.setApiKey';

/** VS Code command URI that reveals the extension log output. */
const SHOW_LOGS_COMMAND = 'command:glm-copilot.showLogs';

type RequestErrorKind = 'http' | 'network' | 'unknown';

interface GLMRequestErrorOptions {
	message: string;
	kind: RequestErrorKind;
	baseUrl: string;
	userSummary?: string;
	diagnosticMessage?: string;
	status?: number;
	code?: string;
	cause?: unknown;
}

interface ErrorAction {
	labelKey: string;
	url: string;
}

/**
 * Maps Node/undici network error codes to a user-facing category.
 *
 * Not exhaustive: unknown codes fall back to `generic` while still being
 * surfaced to the user in the error message.
 */
const NETWORK_ERROR_CATEGORY_BY_CODE: Record<string, NetworkErrorCategory> = {
	ENOTFOUND: 'dns',
	EAI_AGAIN: 'dns',
	ENODATA: 'dns',
	ESERVFAIL: 'dns',
	EFORMERR: 'dns',
	ENONAME: 'dns',
	EBADNAME: 'dns',
	EBADQUERY: 'dns',
	EBADFAMILY: 'dns',
	EBADRESP: 'dns',
	ENOTIMP: 'dns',
	EREFUSED: 'dns',
	ENOTINITIALIZED: 'dns',
	ELOADIPHLPAPI: 'dns',
	EADDRGETNETWORKPARAMS: 'dns',
	ECONNREFUSED: 'unreachable',
	ENETUNREACH: 'unreachable',
	EHOSTUNREACH: 'unreachable',
	EADDRNOTAVAIL: 'unreachable',
	ENETDOWN: 'unreachable',
	EHOSTDOWN: 'unreachable',
	ECONNRESET: 'interrupted',
	ECONNABORTED: 'interrupted',
	ENETRESET: 'interrupted',
	ENOTCONN: 'interrupted',
	EPIPE: 'interrupted',
	EOF: 'interrupted',
	UND_ERR_SOCKET: 'interrupted',
	SocketError: 'interrupted',
	ETIMEDOUT: 'timeout',
	ETIMEOUT: 'timeout',
	ESOCKETTIMEDOUT: 'timeout',
	UND_ERR_CONNECT_TIMEOUT: 'timeout',
	UND_ERR_HEADERS_TIMEOUT: 'timeout',
	UND_ERR_BODY_TIMEOUT: 'timeout',
	ERR_TLS_HANDSHAKE_TIMEOUT: 'timeout',
	TimeoutError: 'timeout',
	ConnectTimeoutError: 'timeout',
	HeadersTimeoutError: 'timeout',
	BodyTimeoutError: 'timeout',
	CERT_HAS_EXPIRED: 'tls',
	CERT_NOT_YET_VALID: 'tls',
	CERT_UNTRUSTED: 'tls',
	CERT_REJECTED: 'tls',
	CERT_SIGNATURE_FAILURE: 'tls',
	SELF_SIGNED_CERT_IN_CHAIN: 'tls',
	DEPTH_ZERO_SELF_SIGNED_CERT: 'tls',
	UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls',
	UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'tls',
	UNABLE_TO_GET_ISSUER_CERT: 'tls',
	UNABLE_TO_GET_CRL: 'tls',
	UNABLE_TO_DECRYPT_CERT_SIGNATURE: 'tls',
	UNABLE_TO_DECRYPT_CRL_SIGNATURE: 'tls',
	UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY: 'tls',
	CRL_SIGNATURE_FAILURE: 'tls',
	ERR_TLS_CERT_ALTNAME_INVALID: 'tls',
	UND_ERR_PRX_TLS: 'tls',
	SecureProxyConnectionError: 'tls',
	ABORT_ERR: 'aborted',
	AbortError: 'aborted',
	UND_ERR_ABORTED: 'aborted',
	ECANCELLED: 'aborted',
	UND_ERR_HEADERS_OVERFLOW: 'protocol',
	UND_ERR_RESPONSE: 'protocol',
	UND_ERR_REQ_CONTENT_LENGTH_MISMATCH: 'protocol',
	UND_ERR_RES_CONTENT_LENGTH_MISMATCH: 'protocol',
	UND_ERR_RES_EXCEEDED_MAX_SIZE: 'protocol',
	HTTPParserError: 'protocol',
	HeadersOverflowError: 'protocol',
	ResponseError: 'protocol',
	ResponseContentLengthMismatchError: 'protocol',
	ResponseExceededMaxSizeError: 'protocol',
	ERR_INVALID_URL: 'configuration',
	ERR_INVALID_ARG_TYPE: 'configuration',
	ERR_INVALID_ARG_VALUE: 'configuration',
	UND_ERR_INVALID_ARG: 'configuration',
	InvalidArgumentError: 'configuration',
};

type NetworkErrorCategory =
	| 'dns'
	| 'unreachable'
	| 'interrupted'
	| 'timeout'
	| 'tls'
	| 'aborted'
	| 'protocol'
	| 'configuration'
	| 'generic';

interface NetworkCauseInfo {
	code?: string;
	name?: string;
	message?: string;
	value: string;
}

/** A GLM request failure carrying both a user-facing summary and diagnostics. */
export class GLMRequestError extends Error {
	readonly kind: RequestErrorKind;
	readonly userSummary: string;
	readonly diagnosticMessage: string;
	readonly baseUrl: string;
	readonly status?: number;
	readonly code?: string;

	constructor(options: GLMRequestErrorOptions) {
		super(options.message, { cause: options.cause });
		this.name = 'GLMRequestError';
		this.kind = options.kind;
		this.userSummary = options.userSummary ?? options.message;
		this.diagnosticMessage = options.diagnosticMessage ?? options.message;
		this.baseUrl = options.baseUrl;
		this.status = options.status;
		this.code = options.code;
	}
}

export function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

/** Build a `GLMRequestError` from a non-OK HTTP response. */
export async function createHttpError(
	response: Response,
	context: { baseUrl: string },
): Promise<GLMRequestError> {
	const { baseUrl } = context;
	const responseText = await response.text();
	const serverMessage = extractServerMessage(responseText);
	const statusLabel = `HTTP ${response.status}`;
	const userSummary = getHttpErrorMessage(response.status, statusLabel, baseUrl);
	return new GLMRequestError({
		message: `GLM API request failed with HTTP ${response.status}`,
		userSummary,
		kind: 'http',
		baseUrl,
		status: response.status,
		code: `HTTP_${response.status}`,
		diagnosticMessage: joinDiagnosticParts(
			'kind=http',
			`status=${response.status}`,
			`baseUrl=${safeStringify(baseUrl)}`,
			`statusText=${safeStringify(response.statusText || 'unknown')}`,
			serverMessage ? `serverMessage=${safeStringify(serverMessage)}` : undefined,
			responseText && responseText !== serverMessage
				? `body=${safeStringify(truncateSingleLine(responseText))}`
				: undefined,
		),
	});
}

/** Categorize a thrown value into a `GLMRequestError`, or return it unchanged. */
export function normalizeRequestError(
	error: unknown,
	context: { baseUrl: string },
): GLMRequestError | Error {
	if (error instanceof GLMRequestError) {
		return error;
	}
	if (!(error instanceof Error)) {
		const value = truncateSingleLine(String(error));
		return new GLMRequestError({
			message: `GLM request failed with a non-Error value: ${value}`,
			userSummary: t('error.unknown', value),
			kind: 'unknown',
			baseUrl: context.baseUrl,
			diagnosticMessage: joinDiagnosticParts(
				'kind=unknown',
				`baseUrl=${safeStringify(context.baseUrl)}`,
				`error=${safeStringify(value)}`,
			),
		});
	}
	const causeInfo = getNetworkErrorCauseInfo(error);
	if (!causeInfo) {
		return error;
	}
	const code = causeInfo.code ?? causeInfo.name;
	const userSummary = getNetworkErrorMessage(code);
	const enhanced = new GLMRequestError({
		message: code
			? `GLM request failed due to network error ${code}`
			: 'GLM request failed due to a network error',
		userSummary,
		kind: 'network',
		baseUrl: context.baseUrl,
		code,
		cause: error,
		diagnosticMessage: joinDiagnosticParts(
			'kind=network',
			code ? `code=${code}` : undefined,
			`baseUrl=${safeStringify(context.baseUrl)}`,
			`message=${safeStringify(truncateSingleLine(error.message))}`,
			`cause=${causeInfo.value}`,
		),
	});
	enhanced.stack = error.stack;
	return enhanced;
}

/** Produce a plain `Error` whose message is markdown for display in chat. */
export function createUserFacingError(error: unknown): Error {
	const message =
		error instanceof GLMRequestError
			? formatMarkdownMessage(error.userSummary, getErrorActions(error))
			: t('error.unknown', String(error));
	const displayError = new Error(message);
	displayError.stack = undefined;
	return displayError;
}

/** Build a compact single-string diagnostic for logging. */
export function formatRequestError(error: unknown): string {
	if (error instanceof GLMRequestError) {
		return error.stack
			? `${error.diagnosticMessage}\n${error.stack}`
			: error.diagnosticMessage;
	}
	if (error instanceof Error) {
		const diagnostic = `message=${safeStringify(error.message)}`;
		return error.stack ? `${diagnostic}\n${error.stack}` : diagnostic;
	}
	return `error=${safeStringify(String(error))}`;
}

function getHttpErrorMessage(status: number, statusLabel: string, baseUrl: string): string {
	switch (status) {
		case 400:
			return t('error.http.400', statusLabel);
		case 401:
			return isOfficialBaseUrl(baseUrl)
				? t('error.http.401.withCreateApiKeyLink', statusLabel, resolveKeyPageUrl())
				: t('error.http.401', statusLabel);
		case 402:
			return t('error.http.402', statusLabel);
		case 404:
			return t('error.http.404', statusLabel);
		case 422:
			return t('error.http.422', statusLabel);
		case 429:
			return t('error.http.429', statusLabel);
		case 500:
			return t('error.http.500', statusLabel);
		case 503:
			return t('error.http.503', statusLabel);
		default:
			return t('error.http.generic', statusLabel);
	}
}

function getErrorActions(error: GLMRequestError): ErrorAction[] {
	const actions: ErrorAction[] = [];
	if (error.kind === 'http' && error.status === 401) {
		actions.push({ labelKey: 'error.action.setApiKey', url: SET_API_KEY_COMMAND });
	}
	actions.push({ labelKey: 'error.action.viewDetails', url: SHOW_LOGS_COMMAND });
	return actions;
}

function formatMarkdownMessage(summary: string, actions: ErrorAction[]): string {
	const formattedSummary = `**${escapeBoldText(summary)}**`;
	if (actions.length === 0) {
		return formattedSummary;
	}
	const actionLinks = actions.map(formatActionLink).join(' · ');
	return [`${formattedSummary}\\`, '\\', `**${actionLinks}**`].join('\n');
}

function formatActionLink(action: ErrorAction): string {
	return `[${t(action.labelKey)}](${action.url})`;
}

function isOfficialBaseUrl(baseUrl: string): boolean {
	try {
		return OFFICIAL_API_HOSTS.includes(new URL(baseUrl).hostname.toLowerCase());
	} catch {
		return false;
	}
}

function getNetworkErrorMessage(code: string | undefined): string {
	const errorCode = code ?? 'UNKNOWN';
	switch (getNetworkErrorCategory(code)) {
		case 'dns':
			return t('error.network.dns', errorCode);
		case 'unreachable':
			return t('error.network.unreachable', errorCode);
		case 'interrupted':
			return t('error.network.interrupted', errorCode);
		case 'timeout':
			return t('error.network.timeout', errorCode);
		case 'tls':
			return t('error.network.tls', errorCode);
		case 'aborted':
			return t('error.network.aborted', errorCode);
		case 'protocol':
			return t('error.network.protocol', errorCode);
		case 'configuration':
			return t('error.network.configuration', errorCode);
		case 'generic':
			return t('error.network.generic', errorCode);
	}
}

function getNetworkErrorCategory(code: string | undefined): NetworkErrorCategory {
	if (!code) {
		return 'generic';
	}
	if (Object.hasOwn(NETWORK_ERROR_CATEGORY_BY_CODE, code)) {
		return NETWORK_ERROR_CATEGORY_BY_CODE[code];
	}
	if (code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_')) {
		return 'tls';
	}
	return code.startsWith('HPE_') ? 'protocol' : 'generic';
}

function getNetworkErrorCauseInfo(error: Error): NetworkCauseInfo | undefined {
	const cause: unknown = error.cause;
	if (!cause) {
		return undefined;
	}
	if (cause instanceof Error) {
		const value: Record<string, unknown> = {
			name: cause.name,
			message: cause.message,
			...Object.fromEntries(Object.entries(cause)),
		};
		return {
			code: getStringProperty(value, 'code'),
			name: cause.name,
			message:
				cause.message && cause.message !== error.message
					? truncateSingleLine(cause.message)
					: undefined,
			value: stringifyDiagnosticCause(value),
		};
	}
	if (typeof cause === 'object') {
		return {
			code: getStringProperty(cause, 'code'),
			name: getStringProperty(cause, 'name'),
			message: truncateOptional(getStringProperty(cause, 'message')),
			value: stringifyDiagnosticCause(cause),
		};
	}
	return {
		message: truncateSingleLine(String(cause)),
		value: safeStringify(String(cause)),
	};
}

function extractServerMessage(responseText: string): string | undefined {
	const trimmed = responseText.trim();
	if (!trimmed) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(trimmed);
		const errorValue = getObjectProperty(parsed, 'error');
		const message =
			getStringProperty(errorValue, 'message') ??
			getStringProperty(parsed, 'message') ??
			(typeof errorValue === 'string' ? errorValue : undefined);
		return message ? truncateSingleLine(message) : undefined;
	} catch {
		return truncateSingleLine(trimmed);
	}
}

function getObjectProperty(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)[key]
		: undefined;
}

function getStringProperty(value: unknown, key: string): string | undefined {
	const property = getObjectProperty(value, key);
	return typeof property === 'string' && property.length > 0 ? property : undefined;
}

function joinDiagnosticParts(...parts: Array<string | undefined>): string {
	return parts.filter((part): part is string => Boolean(part)).join(' ');
}

function truncateSingleLine(value: string): string {
	const singleLine = value.replace(/\s+/gu, ' ').trim();
	return singleLine.length > MAX_DIAGNOSTIC_FIELD_LENGTH
		? `${singleLine.slice(0, MAX_DIAGNOSTIC_FIELD_LENGTH)}...`
		: singleLine;
}

function truncateOptional(value: string | undefined): string | undefined {
	return value ? truncateSingleLine(value) : undefined;
}

function stringifyDiagnosticCause(cause: unknown): string {
	try {
		return truncateSingleLine(safeStringify(cause));
	} catch {
		return safeStringify(String(cause));
	}
}

function escapeBoldText(value: string): string {
	return value.replace(/\*/gu, '\\*');
}
