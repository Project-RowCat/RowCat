import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../db/client.ts";
import { env } from "../env.ts";
import { connectTestDatabase } from "../test/database.ts";
import { JobLockUnavailable, jobLockId, withJobLock } from "./lock.ts";

/**
 * Distributed lock, tested against real Postgres advisory locks. A mocked lock would only verify
 * our imitation; what matters is that `pg_try_advisory_lock`'s actual semantics (session scope,
 * non-blocking, release on session end) match this code's assumptions. The second runner is
 * therefore a different connection: locking twice in one session is re-entrant in Postgres and says
 * nothing about two replicas.
 */

const hasDb = await connectTestDatabase();

if (hasDb)
	afterAll(async () => {
		await closeDb();
	});

/** Lock names used here, prefixed so they cannot collide with other suites' job names. */
const jobName = (suffix: string): string => `lock-test.${suffix}`;

/** Same value as the constant in `lock.ts`. */
const NAMESPACE = 0x524f5743;

/** Whether a lock for that name is currently held in this database. */
async function isLocked(name: string): Promise<boolean> {
	const rows = await db.execute<{ n: number }>(sql`
		select count(*)::int as n
		from pg_locks
		where locktype = 'advisory'
		  and classid = ${NAMESPACE}
		  and objid = ${jobLockId(name) >>> 0}
	`);
	return Number(rows.rows[0]?.n ?? 0) > 0;
}

describe.skipIf(!hasDb)("distributed job lock", () => {
	test("the run that comes first takes it, and runs arriving meanwhile skip", async () => {
		const name = jobName("mutual-exclusion");
		let secondOutcome = "";

		const first = await withJobLock(name, async () => {
			// Try the second while the first holds the lock; it goes out on another connection, the same
			// situation as two replicas.
			const second = await withJobLock(name, async () => "must not run");
			secondOutcome = second.outcome;
			expect(second.value).toBeUndefined();
			return "the first run's result";
		});

		expect(first.outcome).toBe("acquired");
		expect(first.value).toBe("the first run's result");
		expect(secondOutcome).toBe("held");
	});

	test("released on success — the next run takes it right away", async () => {
		const name = jobName("release-on-success");
		await withJobLock(name, async () => "ok");
		expect(await isLocked(name)).toBe(false);

		const again = await withJobLock(name, async () => "second");
		expect(again.outcome).toBe("acquired");
		expect(again.value).toBe("second");
	});

	test("released even when the job throws — and that exception propagates as is", async () => {
		const name = jobName("release-on-failure");
		const boom = new Error("domain failure");

		// Must not surface as `JobLockUnavailable`, which would send operators to Postgres when only that
		// job broke.
		await expect(
			withJobLock(name, async () => {
				throw boom;
			}),
		).rejects.toBe(boom);
		expect(boom).not.toBeInstanceOf(JobLockUnavailable);
		expect(await isLocked(name)).toBe(false);

		const again = await withJobLock(name, async () => "taken again");
		expect(again.outcome).toBe("acquired");
	});

	test("the lock releases itself when the session drops — crash recovery needs no TTL", async () => {
		const name = jobName("crash-recovery");

		// Simulates another process dying while holding the lock. A separate client is connected directly
		// rather than borrowing a pooled connection, so a session this code cannot touch disappears.
		const rogue = new pg.Client({ connectionString: env.DATABASE_URL });
		await rogue.connect();
		const locked = await rogue.query<{ locked: boolean }>(
			"select pg_try_advisory_lock($1, $2) as locked",
			[NAMESPACE, jobLockId(name)],
		);
		expect(locked.rows[0]?.locked).toBe(true);

		// We cannot acquire it while that session is alive.
		expect((await withJobLock(name, async () => "ok")).outcome).toBe("held");

		// "The process died": the socket closes without releasing the lock.
		await rogue.end();

		// No expiry or lease renewal: Postgres releases all of a session's locks when it vanishes.
		await expect
			.poll(async () => (await withJobLock(name, async () => "ok")).outcome, {
				timeout: 5_000,
			})
			.toBe("acquired");
	});

	test("a different lock per job — orphan cleanup does not block payment reconciliation", async () => {
		const a = jobName("independent-a");
		const b = jobName("independent-b");
		expect(jobLockId(a)).not.toBe(jobLockId(b));

		let inner = "";
		await withJobLock(a, async () => {
			const other = await withJobLock(b, async () => "b runs too");
			inner = `${other.outcome}:${other.value}`;
		});
		expect(inner).toBe("acquired:b runs too");
	});

	test("the lock id derives deterministically from the name — it does not vary by deployment", () => {
		expect(jobLockId("push.deliver")).toBe(jobLockId("push.deliver"));
		expect(jobLockId("media.cleanup-orphans")).not.toBe(
			jobLockId("legal.cleanup-expired-retention"),
		);
	});

	test("the three registered jobs' lock ids do not collide", () => {
		const ids = [
			"push.deliver",
			"media.cleanup-orphans",
			"legal.cleanup-expired-retention",
		].map(jobLockId);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
