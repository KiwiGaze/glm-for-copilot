import {
	createBusinessError,
	createHttpError,
	createResponseParseError,
	isAbortError,
} from './errors';

const SUCCESS_BUSINESS_CODES = new Set(['200']);

interface JsonResponseContext {
	baseUrl: string;
	operation: string;
}

interface BusinessFailure {
	code?: string;
	message?: string;
}

/** Parse and validate an HTTP JSON response, including its top-level business envelope. */
export async function readBusinessJson<T>(
	response: Response,
	context: JsonResponseContext,
): Promise<T> {
	if (!response.ok) {
		throw await createHttpError(response, { baseUrl: context.baseUrl });
	}

	let parsed: unknown;
	try {
		parsed = await response.json();
	} catch (error) {
		if (isAbortError(error)) {
			throw error;
		}
		throw createResponseParseError(context, error);
	}

	const failure = getBusinessFailure(parsed);
	if (failure) {
		throw createBusinessError({
			...context,
			code: failure.code,
			serverMessage: failure.message,
		});
	}
	return parsed as T;
}

function getBusinessFailure(value: unknown): BusinessFailure | undefined {
	const response = asRecord(value);
	if (!response) {
		return undefined;
	}

	const errorValue = response.error;
	const errorObject = asRecord(errorValue);
	const code = readCode(response.code) ?? readCode(errorObject?.code);
	const message =
		readString(response.msg) ??
		readString(response.message) ??
		readString(errorObject?.message) ??
		readString(errorValue);
	const failedBySuccess = response.success === false;
	const failedByCode = code !== undefined && !SUCCESS_BUSINESS_CODES.has(code);
	const failedByError = errorValue !== undefined && errorValue !== null;

	return failedBySuccess || failedByCode || failedByError
		? { code, message }
		: undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null
		? value as Record<string, unknown>
		: undefined;
}

function readCode(value: unknown): string | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return String(value);
	}
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function readString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
