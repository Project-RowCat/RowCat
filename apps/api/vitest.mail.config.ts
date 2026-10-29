import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import {
	provisionWorkerDatabases,
	testWorkerCount,
	WORKER_DATABASE_URLS_ENV,
} from "./src/test/worker-database.ts";

/**
 * Test config for deployments that require email ownership verification.
 *
 * There are two configs because `requireEmailVerification` derives from `MAIL_TRANSPORT`
 * (`env.ts`), read once at module load, so one process cannot imitate two deployments. Turning that
 * derivation into a runtime switch would make "required but cannot send" representable, which is
 * exactly what the derivation exists to prevent, so it is not loosened for test convenience. Only
 * `*.verified.test.ts` files run here; the default config excludes that pattern.
 *
 * The transport is `dev` but never actually used: tests swap in the capture transport on their
 * first line (`setMailTransport`). `dev` is chosen because it makes `mailEnabled` true and so turns
 * verification on; its real behavior (console output) never happens. Nothing reaches the network:
 * not picking `smtp` is half the guarantee (no credentials, so the connection fails) and the
 * capture transport is the other half.
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
		include: ["src/**/*.verified.test.ts"],
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
			/**
			 * This line is the whole point of the config: with a delivery mechanism, email verification is
			 * required, signup grants no session and unverified sign-in is a 403.
			 */
			MAIL_TRANSPORT: "dev",
			MAIL_FROM: "RowCat <no-reply@rowcat.test>",
			/**
			 * Password reset opens only with both a delivery mechanism and this switch
			 * (`passwordResetEnabled` in `env.ts`). It is closed under the default config, so tests
			 * exercising that flow run only here (`routes/password-reset.verified.test.ts`).
			 */
			PASSWORD_RESET_ENABLED: "on",
		},
	},
});
