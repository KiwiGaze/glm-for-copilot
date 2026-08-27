import { beforeEach, describe, expect, it, vi } from 'vitest';

const output = vi.hoisted(() => ({
	messages: [] as string[],
}));

vi.mock('vscode', () => ({
	window: {
		createOutputChannel: () => ({
			info: (message: string) => output.messages.push(message),
			warn: (message: string) => output.messages.push(message),
			error: (message: string) => output.messages.push(message),
			debug: (message: string) => output.messages.push(message),
			show: vi.fn(),
			dispose: vi.fn(),
		}),
	},
}));
vi.mock('./config', () => ({ getDebugLogging: () => true }));

import { logger } from './logger';

describe('logger image-data redaction', () => {
	beforeEach(() => {
		logger.dispose();
		output.messages.length = 0;
	});

	it('redacts image data URLs reflected by endpoint diagnostics', () => {
		const secretPayload = 'VERYSECRETPAYLOAD';
		logger.error(
			'Endpoint rejected request',
			`{"message":"bad data:image/png;base64,${secretPayload} request"}`,
		);

		expect(output.messages).toEqual([
			'Endpoint rejected request {"message":"bad data:image/[redacted] request"}',
		]);
		expect(output.messages[0]).not.toContain(secretPayload);
	});
});
