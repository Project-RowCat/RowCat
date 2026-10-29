import * as SQLite from "expo-sqlite";
import type { SqliteDriver, SqlValue } from "./sqlite.ts";

/**
 * Native implementation of `SqliteDriver`, backed by `expo-sqlite`.
 *
 * This file exists for the same reason as `secure-store.ts`: importing `expo-sqlite` means the
 * module cannot open under Node. All adapter SQL sits on the port, and only **four lines of
 * wiring** come through here, so the code tests cannot reach stays minimal.
 *
 * Transaction control (`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`) is not wrapped here. Swapping in
 * `withExclusiveTransactionAsync` would make its semantics `expo-sqlite`'s, and the test path would
 * diverge from the device path. Atomicity comes from the **same SQL statements** in both places.
 */
export async function openExpoSqliteDriver(
	name: string,
): Promise<SqliteDriver> {
	const db = await SQLite.openDatabaseAsync(name);
	return {
		exec: (sql) => db.execAsync(sql),
		run: async (sql, params) => {
			await db.runAsync(sql, params as SQLite.SQLiteBindValue[]);
		},
		all: <T>(sql: string, params: readonly SqlValue[]) =>
			db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]),
		close: () => db.closeAsync(),
	};
}

/** Deletes the whole file. Used by the account deletion and local reset paths (`purge.ts`). */
export const deleteExpoSqliteDatabase = (name: string): Promise<void> =>
	SQLite.deleteDatabaseAsync(name);
