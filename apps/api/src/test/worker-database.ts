import { availableParallelism } from "node:os";
import pg from "pg";

/**
 * Database isolation so API tests can run in parallel per file.
 *
 * The suite ran sequentially in one worker because everything shared one database, so one file's
 * cleanup deleted rows another file created. That risk is real: several files sweep beyond their
 * own prefix (`db.delete(story).where(isNull(story.owner))`) and the ops-switch table is emptied
 * without a `where`. Rather than fix the tests, the sharing is removed: each worker has its own
 * database, so any delete inside it never reaches another worker's rows, and no test file changes
 * because isolation lives in the connection URL.
 *
 * Why a database rather than a schema: a `search_path` split looks lighter, but the drizzle
 * migrator keeps its own record (the `drizzle` schema) and generated SQL names schemas in places,
 * so that boundary leaks silently if one spot is off. A database boundary has no such spot.
 *
 * If databases cannot be created (no `CREATE DATABASE` permission, or no Postgres), this module
 * returns `null` and config turns parallelism off and falls back to the shared database
 * (`vitest.config.ts`). The decision is made at config time so "shared database but parallel" is
 * not representable.
 */

/**
 * The only channel carrying per-worker URLs from config to workers. Workers do not create their own
 * databases because config is read once per run while setup files run per test file; creating them
 * there would make 85 pointless connections, and the file that loses a race would fail alone.
 */
export const WORKER_DATABASE_URLS_ENV = "ROWCAT_TEST_WORKER_DATABASE_URLS";

/** An existing database (42P04) or one created at the same moment (23505) is not a failure. */
const ALREADY_EXISTS = new Set(["42P04", "23505"]);

/**
 * Worker count. Not all cores are used: the suite is bound by Postgres round trips and scrypt, not
 * CPU, so extra cores only wait on each other; and each worker holds a pool against Postgres's
 * default limit of 100 connections, so adding workers splits that budget.
 */
export function testWorkerCount(): number {
	return Math.max(1, Math.min(8, availableParallelism() - 2));
}

/** Swaps only the database name in a connection string; host and credentials stay. */
export function workerDatabaseUrl(baseUrl: string, name: string): string {
	const url = new URL(baseUrl);
	url.pathname = `/${encodeURIComponent(name)}`;
	return url.toString();
}

/**
 * Derives a worker database name from the base name. The identifier is sent quoted so any string
 * would parse, but such names are awkward in `psql` and backups; anything not safe-shaped falls
 * back to a fixed name so the connection string's shape never decides a test database's name.
 */
function workerDatabaseName(baseUrl: string, index: number): string {
	const raw = decodeURIComponent(new URL(baseUrl).pathname.replace(/^\//, ""));
	const base = /^[a-z_][a-z0-9_]{0,40}$/i.test(raw) ? raw : "rowcat";
	return `${base}_test_w${index}`;
}

/**
 * Creates one database per worker and returns their URLs. Idempotent: existing ones are reused.
 *
 * The schema is not created here; test files already migrate in `connectTestDatabase()`
 * (`database.ts`), and doing it twice would put the same work in two places that eventually
 * diverge. It does not connect to the maintenance database (`postgres`), which may not exist;
 * `CREATE DATABASE` runs from whichever database is connected.
 */
export async function provisionWorkerDatabases(
	baseUrl: string,
	count: number,
): Promise<string[] | null> {
	const client = new pg.Client({
		connectionString: baseUrl,
		connectionTimeoutMillis: 3_000,
	});

	try {
		await client.connect();
	} catch {
		// No Postgres: tests skip instead of failing (`database.ts`).
		return null;
	}

	try {
		const urls: string[] = [];
		for (let index = 1; index <= count; index++) {
			const name = workerDatabaseName(baseUrl, index);
			try {
				await client.query(`create database "${name}"`);
			} catch (error) {
				const code = (error as { code?: string }).code;
				if (!code || !ALREADY_EXISTS.has(code)) throw error;
			}
			urls.push(workerDatabaseUrl(baseUrl, name));
		}
		return urls;
	} catch (error) {
		console.warn(
			`[api.test] couldn't create a per-worker database, so running sequentially on the shared database — ${String(error)}`,
		);
		return null;
	} finally {
		await client.end().catch(() => {});
	}
}
