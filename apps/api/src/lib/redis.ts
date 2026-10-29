import Redis, { type RedisOptions } from "ioredis";
import { redisUrl } from "../env.ts";

/**
 * This deployment's Redis connection: one, created only here (same axis as `db/client.ts` owning a
 * single Postgres pool). Per-consumer clients would multiply connections and create two config
 * paths, making a deployment with TLS on for one and off for another representable.
 *
 * The current consumer is the rate limiter. A cross-process SSE broker (`services/sync/wake.ts`) or
 * a Better Auth secondary session store (`auth/index.ts`) would call this function too.
 *
 * ## A connection failure must not kill the process
 *
 * ioredis reports connection errors as an `error` event; with no listener Node raises it as an
 * unhandled exception, so one Redis blip would take the whole API down. A listener is mandatory and
 * reconnection is left to ioredis.
 *
 * ## Fail fast, but not through the offline queue
 *
 * Whether the policy is fail-open or fail-closed, the call must fail quickly; otherwise a dead
 * Redis stalls every request on the limiter line and amplifies the outage.
 *
 * An earlier version got that with `enableOfflineQueue: false`, which was wrong. Combined with
 * `lazyConnect`, a command arriving before the connection is established is rejected at once, and
 * that command is the first request after boot. Redis is healthy yet the first request of a
 * fail-closed policy gets a 503 (adult entitlement and guardian consent are those spots).
 *
 * So the queue stays on and fail-fast comes from:
 *
 * ```text
 * maxRetriesPerRequest: 0   reject commands issued while disconnected instead of holding them
 * commandTimeout            upper bound for a command that still hangs
 * ```
 *
 * While the connection is being established (normal boot) the queue covers that short window; with
 * no connection the two settings reject within milliseconds. The limiter has no reason to retry:
 * after one failure the policy decides that request's outcome.
 */

/** How quickly a command gives up when the connection is not alive. */
const COMMAND_TIMEOUT_MS = 500;

const OPTIONS: RedisOptions = {
	/** Connect on the first command; connecting eagerly makes Redis-less local dev log a reconnect loop on every boot, which hides real failures. */
	lazyConnect: true,
	/** Kept on: turned off, the first command before the connection exists is rejected (see header). Fail-fast comes from the two options below. */
	enableOfflineQueue: true,
	maxRetriesPerRequest: 0,
	commandTimeout: COMMAND_TIMEOUT_MS,
	connectTimeout: COMMAND_TIMEOUT_MS,
	/** Caps the reconnect backoff; uncapped, the interval keeps growing and the client reattaches long after Redis returns. */
	retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
};

let client: Redis | null = null;

/**
 * This process's Redis; `null` on a deployment where it is not configured. It is a value rather
 * than an exception because callers pick a fallback (the limiter drops to an in-process counter),
 * and a try/catch could not tell a real outage from "not configured".
 */
export function getRedis(): Redis | null {
	if (!redisUrl) return null;
	if (client) return client;

	const created = new Redis(redisUrl, OPTIONS);
	/** The raw message is omitted: ioredis error strings carry host and port, which is internal topology. */
	created.on("error", (error: Error) => {
		console.error(`[redis] connection error: ${error.name}`);
	});
	client = created;
	return created;
}

/** Called by tests and shutdown; the next `getRedis()` creates a new connection. */
export async function closeRedis(): Promise<void> {
	const current = client;
	client = null;
	if (!current) return;
	await current.quit().catch(() => current.disconnect());
}
