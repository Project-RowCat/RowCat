import { createHash } from "node:crypto";
import { withPooledClient } from "../db/client.ts";
import type { JobLockOutcome } from "./types.ts";

/**
 * Distributed lock on Postgres advisory locks.
 *
 * Why not Redis: the Redis client's contract is `null` on an unconfigured deployment, and a lock
 * has no acceptable fallback. Falling back to "run without a lock" lets irreversible deletion run
 * in two processes on a two-replica deployment; throwing kills the jobs on a deployment that chose
 * not to use Redis. Postgres is always there (the API does not start without it), so no deployment
 * lacks the lock, "only one replica" is not an architectural assumption, and there is no new
 * infrastructure dependency.
 *
 * Why a session lock with no TTL: `pg_try_advisory_lock` is owned by the connection session, so
 * when the process dies, the container is replaced or the network drops, Postgres releases it.
 * There is no lease renewal, expiry guess or "looks dead but TTL remains" state. The cost is one
 * pooled connection held for the lock's lifetime, hence `try_`: overlapping runs skip instead of
 * queueing on a held connection.
 *
 * One lock per job: the key includes a hash of the job name. With a single lock, orphan cleanup
 * running would make other jobs skip, which looks only like "sometimes it does not run".
 */

/**
 * RowCat's advisory-lock namespace, the ASCII of `"ROWC"`. The two-integer form (`classid`,
 * `objid`) is used because a single bigint could collide with locks from other code on the same
 * database (migration tools, extensions, ops scripts), showing up as a job skipped forever.
 */
const LOCK_NAMESPACE = 0x524f5743; // 1381188419, within int4 range.

/**
 * Job name to a 32-bit integer: the first 4 bytes of SHA-256 as a signed int4.
 * `pg_try_advisory_lock` only takes integers, and hashing avoids hand-maintaining a name table that
 * would drift.
 */
export function jobLockId(jobName: string): number {
	const digest = createHash("sha256").update(jobName).digest();
	return digest.readInt32BE(0);
}

export interface LockedRun<T> {
	outcome: JobLockOutcome;
	/** `undefined` when the lock was not acquired (the callback did not run). */
	value?: T;
}

/**
 * Runs `fn` only when the lock is acquired. The three outcomes are different facts:
 *
 * ```text
 * acquired     we hold it and the callback ran
 * held         another run holds it: normal, skip
 * unavailable  the lock could not be queried: DB failure, counted as failure
 * ```
 *
 * Folding the last two would show "Postgres is down and nothing runs" as "another instance is
 * running".
 */
export async function withJobLock<T>(
	jobName: string,
	fn: () => Promise<T>,
): Promise<LockedRun<T>> {
	const objectId = jobLockId(jobName);

	try {
		return await withPooledClient(async (client) => {
			const acquired = await client.query<{ locked: boolean }>(
				"select pg_try_advisory_lock($1, $2) as locked",
				[LOCK_NAMESPACE, objectId],
			);
			if (!acquired.rows[0]?.locked) return { outcome: "held" as const };

			try {
				return { outcome: "acquired" as const, value: await fn() };
			} catch (error) {
				// Mark what the job threw before rethrowing; unmarked, the outer `catch` would report a domain
				// failure as lock infrastructure failure and send operators to Postgres.
				throw new JobBodyError(error);
			} finally {
				// Unlock explicitly: closing the session would release it, but the session returns to the pool,
				// so the next user would get a connection holding the lock. Swallow failures here: a throw
				// would overwrite the callback's result or exception with noise.
				await client
					.query("select pg_advisory_unlock($1, $2)", [
						LOCK_NAMESPACE,
						objectId,
					])
					.catch(() => undefined);
			}
		});
	} catch (error) {
		// Connection or lock statement failed; the callback did not run. Exceptions from the callback are
		// rethrown as-is (the runner records them as failures); folding them here would report a job's
		// domain failure as lock infrastructure failure.
		if (error instanceof JobBodyError) throw error.bodyError;
		throw new JobLockUnavailable(error);
	}
}

/**
 * The lock infrastructure itself could not answer: no connection, or the lock statement failed. No
 * parameter properties: `apps/api` is `erasableSyntaxOnly`.
 */
export class JobLockUnavailable extends Error {
	override readonly name = "JobLockUnavailable";
	readonly reason: unknown;
	constructor(reason: unknown) {
		super("couldn't check the advisory lock");
		this.reason = reason;
	}
}

/** Marker so the `catch` above does not mistake a job exception for a lock failure. */
class JobBodyError extends Error {
	override readonly name = "JobBodyError";
	readonly bodyError: unknown;
	constructor(bodyError: unknown) {
		super("job body failed");
		this.bodyError = bodyError;
	}
}
