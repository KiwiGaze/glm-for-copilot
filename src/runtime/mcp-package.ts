import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type * as vscode from 'vscode';
import {
	VISION_MCP_ENTRYPOINT_PARTS,
	VISION_MCP_INSTALL_DIR_NAME,
	VISION_MCP_PACKAGE_NAME,
	VISION_MCP_PACKAGE_VERSION,
} from '../consts';
import { logger } from '../logger';

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

export interface IVisionMcpPackageInstaller {
	readonly entryPoint: string;
	isInstalled(): boolean;
	install(): Promise<void>;
	uninstall(): Promise<void>;
}

export interface NpmCiSpec {
	command: string;
	args: string[];
}

export function buildNpmCiSpec(platform: NodeJS.Platform): NpmCiSpec {
	const args = ['ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--no-progress'];
	return {
		command: platform === 'win32' ? 'cmd.exe' : 'npm',
		args: platform === 'win32' ? ['/d', '/s', '/c', 'npm', ...args] : args,
	};
}

export function hasInstalledVisionMcp(installDir: string): boolean {
	const packageJsonPath = join(
		installDir,
		'node_modules',
		VISION_MCP_PACKAGE_NAME,
		'package.json',
	);
	const entryPoint = join(installDir, ...VISION_MCP_ENTRYPOINT_PARTS);
	if (!existsSync(packageJsonPath) || !existsSync(entryPoint)) {
		return false;
	}
	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
			name?: unknown;
			version?: unknown;
		};
		return (
			packageJson.name === VISION_MCP_PACKAGE_NAME &&
			packageJson.version === VISION_MCP_PACKAGE_VERSION &&
			lstatSync(entryPoint).isFile()
		);
	} catch {
		return false;
	}
}

function runNpmCi(cwd: string, platform: NodeJS.Platform): Promise<void> {
	const spec = buildNpmCiSpec(platform);
	return new Promise((resolve, reject) => {
		execFile(
			spec.command,
			spec.args,
			{
				cwd,
				timeout: INSTALL_TIMEOUT_MS,
				windowsHide: true,
				maxBuffer: 1024 * 1024,
				env: {
					...process.env,
					npm_config_audit: 'false',
					npm_config_fund: 'false',
					npm_config_ignore_scripts: 'true',
					npm_config_update_notifier: 'false',
				},
			},
			(error, _stdout, stderr) => {
				if (!error) {
					resolve();
					return;
				}
				const detail = stderr.trim();
				reject(new Error(detail || error.message));
			},
		);
	});
}

export class VisionMcpPackageInstaller implements IVisionMcpPackageInstaller {
	private readonly installDir: string;
	private readonly assetDir: string;

	constructor(
		context: vscode.ExtensionContext,
		private readonly installCommand: (cwd: string) => Promise<void> = (cwd) =>
			runNpmCi(cwd, process.platform),
		private readonly renamePath: typeof rename = rename,
		private readonly removePath: typeof rm = rm,
	) {
		this.installDir = join(context.globalStorageUri.fsPath, VISION_MCP_INSTALL_DIR_NAME);
		this.assetDir = join(context.extensionUri.fsPath, 'resources', 'vision-mcp');
	}

	get entryPoint(): string {
		return join(this.installDir, ...VISION_MCP_ENTRYPOINT_PARTS);
	}

	isInstalled(): boolean {
		return hasInstalledVisionMcp(this.installDir);
	}

	async install(): Promise<void> {
		const parentDir = dirname(this.installDir);
		const stagingDir = `${this.installDir}.installing-${randomUUID()}`;
		const backupDir = `${this.installDir}.backup-${randomUUID()}`;
		await mkdir(parentDir, { recursive: true });
		await mkdir(stagingDir, { recursive: true });
		try {
			await Promise.all([
				copyFile(join(this.assetDir, 'package.json'), join(stagingDir, 'package.json')),
				copyFile(join(this.assetDir, 'package-lock.json'), join(stagingDir, 'package-lock.json')),
			]);
			await this.installCommand(stagingDir);
			if (!hasInstalledVisionMcp(stagingDir)) {
				throw new Error('The installed package did not match the pinned GLM Vision version.');
			}
			const hasPreviousInstallation = existsSync(this.installDir);
			if (hasPreviousInstallation) {
				await this.renamePath(this.installDir, backupDir);
			}
			try {
				await this.renamePath(stagingDir, this.installDir);
			} catch (promotionError) {
				if (hasPreviousInstallation) {
					try {
						await this.renamePath(backupDir, this.installDir);
					} catch (restoreError) {
						await this.removePath(backupDir, { recursive: true, force: true }).catch(
							(cleanupError) =>
								logger.warn('Failed to remove the stranded GLM Vision package backup', cleanupError),
						);
						throw new AggregateError(
							[promotionError, restoreError],
							'Failed to promote the new GLM Vision package and restore the previous installation.',
						);
					}
				}
				throw promotionError;
			}
			if (hasPreviousInstallation) {
				try {
					await this.removePath(backupDir, { recursive: true, force: true });
				} catch (error) {
					logger.warn('Failed to remove the previous GLM Vision package backup', error);
				}
			}
		} catch (error) {
			await this.removePath(stagingDir, { recursive: true, force: true });
			throw error;
		}
	}

	async uninstall(): Promise<void> {
		await this.removePath(this.installDir, { recursive: true, force: true });
	}
}
