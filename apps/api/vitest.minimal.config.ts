import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import {
	provisionWorkerDatabases,
	testWorkerCount,
	WORKER_DATABASE_URLS_ENV,
} from "./src/test/worker-database.ts";

/**
 * Test config for the deployment a fork gets by filling only the two required secrets: **no identity
 * verifier** (`IDENTITY_VERIFICATION_PROVIDER` empty) and the age gate at its default (off).
 *
 * A separate process for the same reason as `vitest.mail.config.ts`: the verifier choice is read
 * once at module load (`env.ts`), and the default config fills it with `dev` so the guardian and adult
 * procedures can run at all. That left the configuration most forks actually run — every procedure
 * refused with 503, adult content reachable only through an operator's manual grant — with no route
 * test. Only `*.minimal.test.ts` files run here; the default config excludes that pattern.
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
		include: ["src/**/*.minimal.test.ts"],
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
			/** The two lines this config exists for: nothing verifies identity, and age is not asked yet. */
			IDENTITY_VERIFICATION_PROVIDER: "",
			MEMBERSHIP_AGE_GATE: "",
		},
	},
});
