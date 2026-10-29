import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	createLocalScopeController,
	type LocalScopeController,
	openScopeWith,
} from "../lib/local-data/activation.ts";
import type { SqliteDriver, SqlValue } from "../lib/local-data/sqlite.ts";
import type { SecureKeyStorage } from "../lib/local-sync/device-key.ts";

/**
 * Test harness. **`expo-sqlite` is not mocked.**
 *
 * What is plugged in is the real SQLite built into Node 22 (`node:sqlite`). So the adapter's SQL
 * (upserts, cursor comparisons, `BEGIN IMMEDIATE`, rollback, indexes) actually runs and actually
 * fails. A test that passes against a mock database does not prove the native SQLite works; that
 * claim is handled by simulator QA (`README.md`).
 *
 * Opening a file is also a decision. `:memory:` vanishes on close, so a check that closes and
 * reopens cannot be expressed. That is one of the most important checks in this slice: does the
 * same member get the same file after signing in again, and can a different member never get it?
 */

/** The directory this test file uses. One file means one member. */
export function createTempDirectory(): { path: string; dispose(): void } {
	const path = mkdtempSync(join(tmpdir(), "rowcat-mobile-"));
	return {
		path,
		dispose: () => rmSync(path, { recursive: true, force: true }),
	};
}

export interface NodeDriverHooks {
	/**
	 * Called just before each statement is sent. Throwing makes that statement fail. This is the only
	 * way to reproduce a failure in the middle of a transaction; the atomicity check in `applyPull`
	 * uses it.
	 */
	beforeStatement?(sql: string): void;
}

export function openNodeSqliteDriver(
	directory: string,
	name: string,
	hooks: NodeDriverHooks = {},
): SqliteDriver {
	const db = new DatabaseSync(join(directory, name));
	const guard = (sql: string): void => hooks.beforeStatement?.(sql);
	return {
		async exec(sql) {
			guard(sql);
			db.exec(sql);
		},
		async run(sql, params) {
			guard(sql);
			db.prepare(sql).run(...(params as SqlValue[]));
		},
		async all<T>(sql: string, params: readonly SqlValue[]) {
			guard(sql);
			return db.prepare(sql).all(...(params as SqlValue[])) as T[];
		},
		async close() {
			db.close();
		},
	};
}

/**
 * In-memory secret storage, standing in for the Keychain.
 *
 * The per-member key naming rule is not mocked (`device-key.ts` owns it). This is just a
 * string-to-string map, so whether Bob can read Alice's entry is decided by that naming rule alone;
 * the map does not help that decision.
 */
export function createMemorySecureStorage(): SecureKeyStorage & {
	entries(): Map<string, string>;
} {
	const map = new Map<string, string>();
	return {
		async get(key) {
			return map.get(key) ?? null;
		},
		async set(key, value) {
			map.set(key, value);
		},
		async remove(key) {
			map.delete(key);
		},
		entries: () => map,
	};
}

/** The controller opened by the same assembly the product uses, so tests do not take a shortcut. */
export function createTestScopeController(
	directory: string,
	secureStorage: SecureKeyStorage,
	hooks: NodeDriverHooks = {},
): LocalScopeController {
	return createLocalScopeController(
		openScopeWith(
			async (name) => openNodeSqliteDriver(directory, name, hooks),
			secureStorage,
			/**
			 * The cover **file** is not this harness's concern. What is verified here is whether the adapter
			 * keeps the shared port's contract; whether the file actually moves is the device QA's job. The
			 * address is still returned plausibly because the repository writes that value into a row
			 * (`StagedDraftCover.uri`).
			 */
			{
				uri: (dirName, fileName) => `file:///${dirName}/${fileName}`,
				stage: async (_dirName, draftId) => ({
					fileName: `${draftId}.jpg`,
					byteSize: 0,
				}),
				remove: () => undefined,
				candidates: (draftId) => [`${draftId}.jpg`],
			},
		),
	);
}
