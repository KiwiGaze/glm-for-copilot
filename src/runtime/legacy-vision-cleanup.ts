import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';

const CLEANUP_COMPLETE_KEY = 'glm-copilot.flashImageMigration.v1';
const LEGACY_VISION_SECRET = 'glm-copilot.visionApiKey';
const LEGACY_GLOBAL_STATE_KEYS = ['glm-copilot.visionMcp.installed'] as const;
const LEGACY_STORAGE_DIRECTORIES = ['vision-mcp', 'vision-tmp'] as const;

interface CleanupDependencies {
	removeDirectory?: (path: string) => Promise<void>;
}

/** Remove only state owned by the retired Vision integration. */
export async function cleanupLegacyVisionState(
	context: vscode.ExtensionContext,
	dependencies: CleanupDependencies = {},
): Promise<void> {
	const failures: unknown[] = [];
	const runCleanup = async (
		label: string,
		operation: () => PromiseLike<unknown>,
	): Promise<void> => {
		try {
			await operation();
		} catch (error) {
			failures.push(error);
			logger.warn(label, error);
		}
	};

	let globalCleanupComplete = false;
	try {
		globalCleanupComplete = context.globalState.get<boolean>(CLEANUP_COMPLETE_KEY) === true;
	} catch (error) {
		failures.push(error);
		logger.warn('Failed to read retired image-analysis cleanup state', error);
	}
	if (!globalCleanupComplete) {
		await cleanupGlobalVisionState(context, dependencies, runCleanup);
		if (failures.length === 0) {
			await runCleanup('Failed to record retired image-analysis cleanup', () =>
				context.globalState.update(CLEANUP_COMPLETE_KEY, true),
			);
		}
	}

	if (failures.length > 0) {
		void vscode.window.showWarningMessage(t('migration.visionCleanupFailed'));
	}
}

type CleanupRunner = (
	label: string,
	operation: () => PromiseLike<unknown>,
) => Promise<void>;

async function cleanupGlobalVisionState(
	context: vscode.ExtensionContext,
	dependencies: CleanupDependencies,
	runCleanup: CleanupRunner,
): Promise<void> {
	await runCleanup('Failed to remove the retired image-analysis credential', () =>
		context.secrets.delete(LEGACY_VISION_SECRET),
	);
	for (const key of LEGACY_GLOBAL_STATE_KEYS) {
		await runCleanup(`Failed to remove retired image-analysis state ${key}`, () =>
			context.globalState.update(key, undefined),
		);
	}

	const removeDirectory =
		dependencies.removeDirectory ?? ((path) => rm(path, { recursive: true, force: true }));
	for (const directory of LEGACY_STORAGE_DIRECTORIES) {
		const path = join(context.globalStorageUri.fsPath, directory);
		await runCleanup(
			`Failed to remove retired image-analysis directory ${directory}`,
			() => removeDirectory(path),
		);
	}
}
