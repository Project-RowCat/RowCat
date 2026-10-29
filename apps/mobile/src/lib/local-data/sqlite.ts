/**
 * SQLite port. Adapters depend on only four driver methods.
 *
 * The port exists for verifiability, not abstraction taste. `expo-sqlite` is a native module that
 * does not open in Node, and mocking it would let tests pass without anyone checking that the SQL
 * actually runs. With the driver narrowed to four methods, the same adapter code runs unchanged on
 * `expo-sqlite` on the device and on Node 22's `node:sqlite` in tests, so what gets verified is the
 * adapter's SQL itself.
 *
 * Do not widen it beyond the four. Convenience methods such as `prepare`, `withTransactionAsync`,
 * or `getFirstAsync` would make the port take `expo-sqlite`'s shape, and a second implementation
 * would then imitate that shape and blur what matters most, the transaction boundary.
 */

/** A value SQLite can store. Booleans are absent: folding them to 0|1 is the mapping layer's job. */
export type SqlValue = string | number | null;

/**
 * The driver: the only place the platform plugs in.
 *
 * `exec` and `run` are split because of `expo-sqlite`: it handles parameterless DDL and transaction
 * control through `execAsync`, and statements with bindings through `runAsync`. Merging them would
 * force either implementation to bypass its own API.
 */
export interface SqliteDriver {
	/** A statement with no parameters (migration DDL, `BEGIN`, `COMMIT`). */
	exec(sql: string): Promise<void>;
	/** A write with bindings. */
	run(sql: string, params: readonly SqlValue[]): Promise<void>;
	/** A read with bindings. */
	all<T>(sql: string, params: readonly SqlValue[]): Promise<T[]>;
	close(): Promise<void>;
}

/** Anything that can issue statements: an autocommit connection or an open transaction. */
export interface SqlRunner {
	exec(sql: string): Promise<void>;
	run(sql: string, params?: readonly SqlValue[]): Promise<void>;
	all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
	first<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
}

export interface MobileDatabase extends SqlRunner {
	/**
	 * One write transaction. Atomicity comes from the database itself.
	 *
	 * Always open with `BEGIN IMMEDIATE`. The default `BEGIN` (deferred) takes its lock only at the
	 * first write, so if another connection slips in between a read-then-decide and the write, the
	 * transaction fails with `SQLITE_BUSY` right before commit. Locking up front moves that failure to
	 * the start.
	 *
	 * The callback receives this connection's **direct handle**, one that does not re-enter the queue.
	 * The serialization below holds the whole transaction, so going through the queue would make the
	 * callback's first statement wait on the transaction that is waiting for it: a deadlock.
	 */
	transaction<T>(task: (tx: SqlRunner) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

/**
 * Wraps the driver as a database. Serialization here provides batching, not atomicity.
 *
 * SQLite cannot nest transactions on one connection ("cannot start a transaction within a
 * transaction"). JavaScript `await` lets two `transaction()` calls overlap freely, so preventing
 * the overlap is this layer's job. Atomicity itself is not simulated: `BEGIN IMMEDIATE` / `COMMIT`
 * / `ROLLBACK` are the real transaction, and this queue only lines them up so they do not enter
 * each other.
 *
 * Autocommit statements also go through the same queue. If they did not, they would run in the
 * middle of an open transaction on the same connection, become part of that transaction, and vanish
 * with its rollback.
 */
export function createMobileDatabase(driver: SqliteDriver): MobileDatabase {
	let tail: Promise<unknown> = Promise.resolve();

	const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
		const next = tail.then(task, task);
		tail = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	};

	const direct: SqlRunner = {
		exec: (sql) => driver.exec(sql),
		run: (sql, params = []) => driver.run(sql, params),
		all: (sql, params = []) => driver.all(sql, params),
		async first<T>(sql: string, params: readonly SqlValue[] = []) {
			const rows = await driver.all<T>(sql, params);
			return rows[0] ?? null;
		},
	};

	return {
		exec: (sql) => enqueue(() => direct.exec(sql)),
		run: (sql, params) => enqueue(() => direct.run(sql, params)),
		all: (sql, params) => enqueue(() => direct.all(sql, params)),
		first: (sql, params) => enqueue(() => direct.first(sql, params)),

		transaction: (task) =>
			enqueue(async () => {
				await direct.exec("BEGIN IMMEDIATE");
				try {
					const result = await task(direct);
					await direct.exec("COMMIT");
					return result;
				} catch (error) {
					/**
					 * If the rollback itself fails, **still throw the original error.** Callers need to know "this
					 * page was not applied", and a rollback failure does not change that fact. Replacing it with
					 * the rollback error would hide the real cause.
					 */
					await direct.exec("ROLLBACK").catch(() => undefined);
					throw error;
				}
			}),

		close: () => enqueue(() => driver.close()),
	};
}

/** A boolean column. SQLite has no booleans: fold at the boundary and unfold at the boundary. */
export const toFlag = (value: boolean): number => (value ? 1 : 0);
export const fromFlag = (value: unknown): boolean =>
	value === 1 || value === true;
