import { afterAll } from "vitest";
import { WORKER_DATABASE_URLS_ENV } from "./worker-database.ts";

/**
 * Picks this worker's database and returns its connections when the file ends.
 *
 * This lives in a setup file for ordering: `db/client.ts` creates the pool and reads
 * `env.DATABASE_URL` once at module load, so the URL can only change before that module is first
 * imported. Setup files run before the test file's imports.
 */

const urls = JSON.parse(
	process.env[WORKER_DATABASE_URLS_ENV] ?? "[]",
) as string[];

if (urls.length > 0) {
	/**
	 * `VITEST_POOL_ID` counts from 1. The modulo keeps the URL defined if config and the real worker
	 * count disagree; picking a missing slot would turn `undefined` into the connection string, and
	 * that failure would not name configuration as the cause.
	 */
	const poolId = Number(process.env.VITEST_POOL_ID ?? "1");
	const index = (Number.isFinite(poolId) ? Math.max(1, poolId) : 1) - 1;
	process.env.DATABASE_URL = urls[index % urls.length];
}

/**
 * Closes the pool when the file ends.
 *
 * Each file gets a fresh module graph (`isolate`) and so a fresh pool; unclosed, the previous
 * file's idle connections linger for 30 seconds. Sequentially that accumulation never hit the
 * limit, but with eight workers it multiplies into `too many clients`, and the failure shows up in
 * the next file to connect, not the one holding the connections.
 *
 * The import is inside the cleanup on purpose: a static import above would create the pool before
 * the URL is changed, and importing it eagerly here would make setup wait for a module the test
 * file loads anyway (per file). By cleanup time it is already cached.
 */
afterAll(async () => {
	/**
	 * Some files have nothing to close: tests that mock this module wholesale
	 * (`services/guardian-rate-limit.test.ts`) never have a pool, and throwing here would make cleanup
	 * fail that file. A missing mock key cannot be skipped with `?.` because vitest mocks are proxies
	 * that throw on the read itself. A second `end()` after a test closed the pool itself is rejected
	 * too, meaning it already ended. Both are swallowed.
	 */
	try {
		const { closeDb } = await import("../db/client.ts");
		await closeDb();
	} catch {
		// Only those two cases; failing to close a connection does not change test results.
	}
});
