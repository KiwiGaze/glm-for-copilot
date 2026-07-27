import { mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
	VISION_MCP_PACKAGE_NAME,
	VISION_MCP_PACKAGE_VERSION,
} from '../consts';
import {
	buildNpmCiSpec,
	hasInstalledVisionMcp,
	VisionMcpPackageInstaller,
} from './mcp-package';

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'glm-vision-mcp-test-'));
	tempDirs.push(dir);
	return dir;
}

async function seedInstalledPackage(
	installDir: string,
	version = VISION_MCP_PACKAGE_VERSION,
): Promise<void> {
	const packageDir = join(installDir, 'node_modules', VISION_MCP_PACKAGE_NAME);
	await mkdir(join(packageDir, 'build'), { recursive: true });
	await writeFile(
		join(packageDir, 'package.json'),
		JSON.stringify({ name: VISION_MCP_PACKAGE_NAME, version }),
	);
	await writeFile(join(packageDir, 'build', 'index.js'), '#!/usr/bin/env node\n');
}

function fakeContext(extensionDir: string, storageDir: string): vscode.ExtensionContext {
	return {
		extensionUri: { fsPath: extensionDir },
		globalStorageUri: { fsPath: storageDir },
	} as unknown as vscode.ExtensionContext;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('buildNpmCiSpec', () => {
	it('disables lifecycle scripts and installs only the locked production graph', () => {
		expect(buildNpmCiSpec('darwin')).toEqual({
			command: 'npm',
			args: ['ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--no-progress'],
		});
	});

	it('runs the npm command shim through cmd.exe on Windows', () => {
		expect(buildNpmCiSpec('win32')).toEqual({
			command: 'cmd.exe',
			args: [
				'/d',
				'/s',
				'/c',
				'npm',
				'ci',
				'--ignore-scripts',
				'--omit=dev',
				'--no-audit',
				'--no-fund',
				'--no-progress',
			],
		});
	});
});

describe('hasInstalledVisionMcp', () => {
	it('accepts only the expected package name, version, and entry point', async () => {
		const root = makeTempDir();
		expect(hasInstalledVisionMcp(root)).toBe(false);

		await seedInstalledPackage(root, '0.1.3');
		expect(hasInstalledVisionMcp(root)).toBe(false);

		await seedInstalledPackage(root);
		expect(hasInstalledVisionMcp(root)).toBe(true);
	});
});

describe('VisionMcpPackageInstaller', () => {
	it('installs from the bundled lockfile and removes the entire local runtime', async () => {
		const root = makeTempDir();
		const extensionDir = join(root, 'extension');
		const assetDir = join(extensionDir, 'resources', 'vision-mcp');
		const storageDir = join(root, 'storage');
		await mkdir(assetDir, { recursive: true });
		await writeFile(join(assetDir, 'package.json'), '{"private":true}');
		await writeFile(join(assetDir, 'package-lock.json'), '{"lockfileVersion":3}');
		const installCommand = vi.fn(async (stagingDir: string) => {
			expect(readFileSync(join(stagingDir, 'package-lock.json'), 'utf8')).toContain(
				'"lockfileVersion":3',
			);
			await seedInstalledPackage(stagingDir);
		});
		const installer = new VisionMcpPackageInstaller(
			fakeContext(extensionDir, storageDir),
			installCommand,
		);

		await installer.install();

		expect(installCommand).toHaveBeenCalledOnce();
		expect(installer.isInstalled()).toBe(true);
		expect(installer.entryPoint).toContain(
			join('vision-mcp', 'node_modules', '@z_ai', 'mcp-server', 'build', 'index.js'),
		);

		await installer.uninstall();

		expect(installer.isInstalled()).toBe(false);
		expect(await readdir(storageDir)).toEqual([]);
	});

	it('does not publish an incomplete staged installation', async () => {
		const root = makeTempDir();
		const extensionDir = join(root, 'extension');
		const assetDir = join(extensionDir, 'resources', 'vision-mcp');
		const storageDir = join(root, 'storage');
		await mkdir(assetDir, { recursive: true });
		await writeFile(join(assetDir, 'package.json'), '{"private":true}');
		await writeFile(join(assetDir, 'package-lock.json'), '{"lockfileVersion":3}');
		const installer = new VisionMcpPackageInstaller(
			fakeContext(extensionDir, storageDir),
			async () => {},
		);

		await expect(installer.install()).rejects.toThrow('did not match');

		expect(installer.isInstalled()).toBe(false);
		expect(await readdir(storageDir)).toEqual([]);
	});
});

describe('bundled Vision MCP lockfile', () => {
	it('pins the MCP package and every transitive dependency with integrity hashes', () => {
		const lockPath = join(process.cwd(), 'resources', 'vision-mcp', 'package-lock.json');
		const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
			packages: Record<string, { version?: string; integrity?: string }>;
		};
		const server = lock.packages['node_modules/@z_ai/mcp-server'];
		expect(server.version).toBe(VISION_MCP_PACKAGE_VERSION);
		expect(server.integrity).toBe(
			'sha512-jPLBKJaTIy7HGYI0VuAaFJIjU3dq5z09CYZNr3QYoHYhCQ2dr5D6qp93oEVxNyvex643dICB7WloHbph2EzlVg==',
		);
		for (const [path, pkg] of Object.entries(lock.packages)) {
			if (path !== '') {
				expect(pkg.integrity, `${path} must have an integrity hash`).toMatch(/^sha512-/);
			}
		}
	});
});
