import * as vscode from 'vscode';
import { getDebugLogging } from './config';

const IMAGE_DATA_URL_PATTERN = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/_=-]+/giu;
const REDACTED_IMAGE_DATA = 'data:image/[redacted]';

class Logger {
	private channel: vscode.LogOutputChannel | undefined;

	private get output(): vscode.LogOutputChannel {
		if (!this.channel) {
			this.channel = vscode.window.createOutputChannel('GLM', { log: true });
		}
		return this.channel;
	}

	info(message: string, ...args: unknown[]): void {
		this.output.info(format(message, args));
	}

	warn(message: string, ...args: unknown[]): void {
		this.output.warn(format(message, args));
	}

	error(message: string, ...args: unknown[]): void {
		this.output.error(format(message, args));
	}

	/** Verbose logs gated behind the `debugLogging` setting. */
	debug(message: string, ...args: unknown[]): void {
		if (getDebugLogging()) {
			this.output.debug(format(message, args));
		}
	}

	show(): void {
		this.output.show();
	}

	dispose(): void {
		this.channel?.dispose();
		this.channel = undefined;
	}
}

function format(message: string, args: unknown[]): string {
	if (args.length === 0) {
		return redactImageData(message);
	}
	const rendered = args
		.map((arg) => {
			if (arg instanceof Error) {
				return arg.stack ?? `${arg.name}: ${arg.message}`;
			}
			if (typeof arg === 'string') {
				return arg;
			}
			try {
				return JSON.stringify(arg);
			} catch {
				return String(arg);
			}
		})
		.join(' ');
	return redactImageData(`${message} ${rendered}`);
}

function redactImageData(value: string): string {
	return value.replace(IMAGE_DATA_URL_PATTERN, REDACTED_IMAGE_DATA);
}

export const logger = new Logger();
