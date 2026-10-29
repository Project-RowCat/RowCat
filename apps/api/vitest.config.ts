import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { configDefaults, defineConfig } from "vitest/config";
import {
	provisionWorkerDatabases,
	testWorkerCount,
	WORKER_DATABASE_URLS_ENV,
} from "./src/test/worker-database.ts";

/**
 * API test config.
 *
 * These tests use a real Postgres: auth is entirely what Better Auth and the drizzle adapter
 * actually read and write, so a mock cannot verify that a session resolves to a member. If there is
 * no DB the tests skip instead of failing (each test file decides), so changes unrelated to the
 * auth schema do not force a local Postgres.
 */

/**
 * Connection info comes from `apps/api/.env`. Reading only `process.env` left that file unseen by
 * tests while drizzle-kit (`db:generate`/`db:migrate`) reads it, so migrations would hit the
 * developer's DB and tests the default DB; a schema mismatch failure does not name configuration as
 * the cause.
 *
 * Mode `test` layers `.env`, `.env.local`, `.env.test`, `.env.test.local` in that order (later
 * wins), so a test-only DB needs just `.env.test`.
 *
 * `loadEnv` is imported from `vite` because `vitest/config` does not re-export it; pnpm forbids
 * importing undeclared packages, so vite is a devDependency.
 *
 * The prefix is empty because `VITE_` selects values to expose to the browser, while server
 * variables are needed here; the exposure boundary is replaced by listing keys one by one below.
 * Shell values override the file (the CI path).
 */
const envDir = fileURLToPath(new URL(".", import.meta.url));
const fileEnv = loadEnv("test", envDir, "");

const DATABASE_URL =
	fileEnv.DATABASE_URL || "postgres://rowcat:rowcat@127.0.0.1:5432/rowcat";

/**
 * Provisions per-worker databases at config time (`src/test/worker-database.ts`). The result also
 * decides `fileParallelism`: failed isolation with parallel runs makes one side's cleanup delete
 * the other's rows, an order-dependent failure. Deciding both here makes that combination
 * unrepresentable.
 */
const workerDatabaseUrls = await provisionWorkerDatabases(
	DATABASE_URL,
	testWorkerCount(),
);

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		/**
		 * Tests for deployments that require email ownership verification do not run here. That
		 * requirement derives from `MAIL_TRANSPORT` (`env.ts`), read once at module load, so one process
		 * cannot imitate two deployments; turning it on here would end every existing `sign-up/email`
		 * without a session and break tests for unrelated reasons. That axis runs in a separate process
		 * under `vitest.mail.config.ts`; both runs share the DB but run sequentially and each cleans only
		 * its own prefix.
		 */
		exclude: [...configDefaults.exclude, "src/**/*.verified.test.ts"],
		/**
		 * Parallel only when each worker has its own database. This was `false` while everything shared
		 * one database, where parallel cleanup deletes the other side's rows; that reason still stands,
		 * but the sharing is gone (`src/test/worker-database.ts`). Runs that could not isolate stay
		 * sequential, and deciding both values together makes parallel-on-shared unrepresentable.
		 */
		fileParallelism: workerDatabaseUrls !== null,
		/**
		 * Pins the worker count; more workers than databases would make two share one, which is no
		 * isolation.
		 */
		poolOptions: {
			forks: { minForks: 1, maxForks: testWorkerCount() },
		},
		setupFiles: ["./src/test/setup-worker-database.ts"],
		/**
		 * Empty strings count as unspecified, as in `env.ts`: a bare `DATABASE_URL=` line in a .env file
		 * passes `??`, making `""` the connection string instead of the default.
		 */
		env: {
			DATABASE_URL,
			/** The setup file picks its share from this list; empty means the shared URL as-is. */
			[WORKER_DATABASE_URLS_ENV]: JSON.stringify(workerDatabaseUrls ?? []),
			/**
			 * The connection budget is split across workers: the production default (10) would let eight
			 * workers hold 80 and approach Postgres's limit of 100, while a file's requests go out one at a
			 * time and need only a few.
			 */
			DATABASE_POOL_MAX: "4",
			/**
			 * Turns off Redis on the product path to preserve worker isolation. Per-worker databases are all
			 * the isolation this suite has, and Redis does not follow that axis: with the server cache, two
			 * workers seeding different stories in their own databases and querying the same guest gallery
			 * filter share a key, so one receives the other's result for 30 seconds. That failure depends on
			 * order and timing and only appears for developers who export `REDIS_URL` in the shell. Empty
			 * means the cache is disabled and rate limiting falls back to the in-process counter (CI has no
			 * Redis anyway). Adapter tests are unaffected: `lib/cache/redis-store.test.ts` and
			 * `lib/rate-limit/store-contract.test.ts` read `REDIS_TEST_URL` first and open their own
			 * connection, so only those two reach a real server.
			 */
			REDIS_URL: "",
			// With an empty dev default Better Auth cannot sign cookies. Test-only value; no deployment uses
			// this string.
			BETTER_AUTH_SECRET:
				fileEnv.BETTER_AUTH_SECRET || "rowcat-test-secret-not-for-deploy",
			/**
			 * Makes the generation endpoint "configured"; with an empty key the route returns 503 before
			 * assembling the policy, so the boundary under test never runs. The file value is deliberately
			 * not used here: tests intercept `fetch`, but a test missing the interception would send the
			 * .env's real key and silently bill; a fixed literal is rejected at auth instead.
			 */
			OPENROUTER_API_KEY: "test-key-not-used",
			/**
			 * Uses the dev identity verifier adapter; without it every guardian-consent path is cut with 503
			 * (fail-closed) and the state machine under test never runs. It cannot leak to production:
			 * `env.ts` blocks boot on production + `dev` and `resolveIdentityVerifier` checks again. The
			 * file value is not used for the same reason: real PortOne credentials in someone's .env must
			 * not receive requests (real verification records would remain on that account).
			 */
			IDENTITY_VERIFICATION_PROVIDER: "dev",
			/**
			 * The age gate stays off, the rollout default; turned on, every existing test's new member would
			 * meet the age gate first (that priority is checked as a matrix in `@rowcat/domain`'s
			 * `membership.test.ts`). The age-declaration endpoint works regardless of this switch, so
			 * membership tests create child state by actually declaring.
			 */
			MEMBERSHIP_AGE_GATE: "",
			/**
			 * Native push transport stays on because the delivery state machine sits behind it; off,
			 * sending, receipts, retries and expiry are all no-ops with nothing to test. No request actually
			 * goes out: delivery tests spy on `fetch` and answer with a stub, and other tests never call the
			 * delivery job (no scheduler starts). No access token is set, so secrets do not become a
			 * convention in test config; every adapter branch reproduces without one.
			 */
			PUSH_TRANSPORT: "expo",
		},
	},
});
