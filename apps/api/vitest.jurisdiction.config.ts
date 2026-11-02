import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import {
	provisionWorkerDatabases,
	testWorkerCount,
	WORKER_DATABASE_URLS_ENV,
} from "./src/test/worker-database.ts";

/**
 * Test config for a deployment that runs another jurisdiction's ages: guardian consent under 13 and
 * adulthood at 18 (`MEMBERSHIP_GUARDIAN_CONSENT_AGE`, `MEMBERSHIP_ADULT_AGE`). Separate for the same
 * reason as the minimal config: the ages are read once at module load (`env.ts`). What runs here is
 * the wiring — that the configured number, not the Korean default, decides a declaration, reaches the
 * runtime config, and is what the refusals say. Only `*.jurisdiction.test.ts` files run here.
 */
const envDir = fileURLToPath(new URL(".", import.meta.url));
const fileEnv = loadEnv("test", envDir, "");

const DATABASE_URL =
	fileEnv.DATABASE_URL || "postgres://rowcat:rowcat@127.0.0.1:5432/rowcat";

/**
 * Uses the same worker databases as the default config. The two runs are chained with `&&` and so
 * sequential with no overlap window, and each still cleans only its own prefix.
 */
const workerDatabaseUrls = await provisionWorkerDatabases(
	DATABASE_URL,
	testWorkerCount(),
);

export default defineConfig({
	test: {
		include: ["src/**/*.jurisdiction.test.ts"],
		fileParallelism: workerDatabaseUrls !== null,
		poolOptions: {
			forks: { minForks: 1, maxForks: testWorkerCount() },
		},
		setupFiles: ["./src/test/setup-worker-database.ts"],
		env: {
			DATABASE_URL,
			[WORKER_DATABASE_URLS_ENV]: JSON.stringify(workerDatabaseUrls ?? []),
			DATABASE_POOL_MAX: "4",
			BETTER_AUTH_SECRET:
				fileEnv.BETTER_AUTH_SECRET || "rowcat-test-secret-not-for-deploy",
			OPENROUTER_API_KEY: "test-key-not-used",
			/** The two lines this config exists for. */
			MEMBERSHIP_GUARDIAN_CONSENT_AGE: "13",
			MEMBERSHIP_ADULT_AGE: "18",
			IDENTITY_VERIFICATION_PROVIDER: "dev",
			MEMBERSHIP_AGE_GATE: "",
		},
	},
});
