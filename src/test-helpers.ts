/**
 * Shared fakes for unit tests. Excluded from the extension build via the
 * `exclude` list in tsconfig.json, like the `*.test.ts` files.
 */

/** Map-backed `vscode.Memento` fake; as in real VS Code, `update(key, undefined)` deletes the key. */
export interface FakeMemento {
	readonly store: Map<string, unknown>;
	get<T>(key: string): T | undefined;
	update(key: string, value: unknown): Thenable<void>;
}

export function fakeMemento(): FakeMemento {
	const store = new Map<string, unknown>();
	return {
		store,
		get<T>(key: string): T | undefined {
			return store.get(key) as T | undefined;
		},
		update(key: string, value: unknown): Thenable<void> {
			if (value === undefined) {
				store.delete(key);
			} else {
				store.set(key, value);
			}
			return Promise.resolve();
		},
	};
}
