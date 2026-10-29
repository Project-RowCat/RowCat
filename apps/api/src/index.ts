import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { closeDb } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { env, publicApiUrl } from "./env.ts";
import { startBackgroundJobs } from "./jobs/scheduler.ts";
import { closeRateLimit } from "./lib/rate-limit/index.ts";

/**
 * Listen only after migrations finish. Reversed, requests arriving while the schema is still old
 * hit missing columns, and that failure shows for a few seconds after deploy and never reproduces.
 */
await runMigrations();

const server = serve(
	{ fetch: app.fetch, hostname: env.HOST, port: env.PORT },
	(info) => {
		// Print both the bind address and the public one; they differ behind a proxy.
		console.log(
			`[api] listen http://${env.HOST}:${info.port} -> ${publicApiUrl} (${env.NODE_ENV})`,
		);
	},
);

/**
 * The scheduler starts only here, after migrations and listening. Not in `app.ts`: tests call the
 * app module directly via `app.request` and bundle analysis and type checking inspect it, so a
 * timer started there would make one import turn on destruction jobs. A static scan guards this
 * (`jobs/boundaries.test.ts`). `null` when off (`BACKGROUND_JOBS_ENABLED`, off by default).
 */
const jobs = startBackgroundJobs();

// Do not cut in-flight requests during a rolling replacement.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		/**
		 * Stop the scheduler first. Blocking new runs and telling in-flight ones to stop is independent
		 * of closing the socket and proceeds while the server drains. Reversed, a new job could start
		 * after the socket closes and immediately lose its connection to `closeDb()`.
		 */
		const stopped = jobs?.stop() ?? Promise.resolve();

		server.close(async () => {
			/**
			 * Wait for running jobs to finish before cleaning up the pool; closing first makes the last
			 * batch lose its connection, with the failure only in the shutdown log. (`stop()` has a cap, so
			 * this does not hang forever.)
			 */
			await stopped.catch(() => {});
			await closeRateLimit().catch(() => {});
			// Pool cleanup after the socket closes; reversed, in-flight requests lose their connection.
			await closeDb().catch(() => {});
			process.exit(0);
		});
	});
}
