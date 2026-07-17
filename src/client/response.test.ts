import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
	workspace: { getConfiguration: () => ({ get: () => undefined }) },
	env: { language: 'en' },
}));

import { formatRequestError, isAuthenticationRequestError } from './errors';
import { readBusinessJson } from './response';

const CONTEXT = {
	baseUrl: 'https://open.bigmodel.cn',
	operation: 'account report',
};

describe('readBusinessJson', () => {
	it.each([
		401,
		403,
		1000,
		1001,
		1002,
		1003,
		1004,
		1005,
	])('classifies documented authentication business code %s', async (code) => {
		const response = Response.json({
			code,
			msg: 'Authentication failed',
			success: false,
		});

		let error: unknown;
		try {
			await readBusinessJson(response, CONTEXT);
		} catch (caught) {
			error = caught;
		}

		expect(isAuthenticationRequestError(error)).toBe(true);
	});

	it('does not classify an unrecognized business code as authentication', async () => {
		const response = Response.json({
			code: 9999,
			msg: 'Business request failed',
			success: false,
		});

		let error: unknown;
		try {
			await readBusinessJson(response, CONTEXT);
		} catch (caught) {
			error = caught;
		}

		expect(isAuthenticationRequestError(error)).toBe(false);
	});

	it('preserves cancellation while reading the response body', async () => {
		const abortError = new DOMException('The operation was aborted.', 'AbortError');
		const response = {
			ok: true,
			json: vi.fn(async () => {
				throw abortError;
			}),
		} as unknown as Response;

		await expect(readBusinessJson(response, CONTEXT)).rejects.toBe(abortError);
	});

	it('preserves a success-false business code and message in diagnostics', async () => {
		const response = Response.json({
			code: 1001,
			msg: 'Authentication parameter not received in Header, unable to authenticate',
			success: false,
		});

		let error: unknown;
		try {
			await readBusinessJson(response, CONTEXT);
		} catch (caught) {
			error = caught;
		}

		expect(isAuthenticationRequestError(error)).toBe(true);
		expect(formatRequestError(error)).toContain('businessCode="1001"');
		expect(formatRequestError(error)).toContain(
			'serverMessage="Authentication parameter not received in Header, unable to authenticate"',
		);
	});

	it('recognizes the official nested business-error shape', async () => {
		const response = Response.json({
			error: {
				code: '1002',
				message: 'Authorization Token is invalid',
			},
		});

		await expect(readBusinessJson(response, CONTEXT)).rejects.toMatchObject({
			kind: 'business',
			code: '1002',
		});
	});

	it('accepts business code 200', async () => {
		const body = { code: 200, data: { limits: [] } };
		const response = Response.json(body);

		await expect(readBusinessJson(response, CONTEXT)).resolves.toEqual(body);
	});
});
