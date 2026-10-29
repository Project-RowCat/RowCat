import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { pingDb } from "../db/client.ts";

export const health = new Hono<AppEnv>()
	/**
	 * Liveness probe; touches no dependency. Checking the DB here would let an orchestrator restart a
	 * healthy process during a brief DB wobble and worsen the outage.
	 */
	.get("/", (c) =>
		/**
		 * Only `ok`. `uptime` and `NODE_ENV` used to ride here in an unauthenticated response, but
		 * restart cadence and deployment stage are reconnaissance data and only the orchestrator reads
		 * it.
		 */
		c.json({ ok: true }),
	)
	/**
	 * Readiness probe; this one checks dependencies. A dead DB takes the instance out of rotation but
	 * does not restart it: restarting does not bring the DB back and only shrinks the pool of
	 * instances able to serve once it recovers.
	 */
	.get("/ready", async (c) => {
		try {
			await pingDb();
			return c.json({ ok: true });
		} catch (err) {
			console.error("[ready] db check failed", err);
			return c.json({ ok: false, code: "db_unavailable" }, 503);
		}
	});
