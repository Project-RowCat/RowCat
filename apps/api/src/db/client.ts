import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

/**
 * Connection pool. `max` is a per-instance cap: scaling to 4 containers quadruples the connections
 * Postgres sees, and exceeding `max_connections` (usually 100) kills a new instance with "too many
 * clients" as soon as it starts, hence the env variable.
 */
const pool = new pg.Pool({
	connectionString: env.DATABASE_URL,
	max: env.DATABASE_POOL_MAX,
	// Idle connections would otherwise keep dead sockets after a proxy (PgBouncer) or DB restart.
	idleTimeoutMillis: 30_000,
	// Keeps requests from hanging forever when the DB is unresponsive; every request waiting
	// indefinitely behind a live health check is the hardest state to diagnose.
	connectionTimeoutMillis: 10_000,
});

/**
 * Errors on idle pool connections belong to no query. Without a handler Node treats them as
 * uncaught exceptions and kills the process, taking the whole API down over a brief DB restart. The
 * pool makes a new connection on the next request.
 */
pool.on("error", (err) => {
	console.error("[db] idle client error", err);
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;

/**
 * Borrows one pooled connection and runs only on it.
 *
 * Needed only for session-bound state. Postgres advisory locks (`pg_try_advisory_lock`) belong to
 * the connection session, so lock and unlock must go out on the same session. drizzle's
 * `db.execute()` takes an arbitrary pool connection per statement, so the unlock could go out on
 * another session and the lock would stay until the process dies.
 *
 * Because session lifetime is lock lifetime, a crashed process closes its socket and Postgres
 * releases its locks: no TTL or lease renewal is needed.
 */
export async function withPooledClient<T>(
	fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	try {
		return await fn(client);
	} finally {
		// Always return it, even on failure; an unreleased connection is gone from the pool for good.
		client.release();
	}
}

/** Dependency probe for `/ready`: the cheapest query that really round-trips. */
export async function pingDb(): Promise<void> {
	await db.execute(sql`select 1`);
}

/** On shutdown, finishes in-flight queries and closes sockets. */
export async function closeDb(): Promise<void> {
	await pool.end();
}
