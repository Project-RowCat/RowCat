import { afterAll, describe, expect, test } from "vitest";
import { closeDb } from "../db/client.ts";
import { connectTestDatabase } from "../test/database.ts";
import { withJobLock } from "./lock.ts";
import { runJob } from "./runner.ts";
import type {
	BackgroundJob,
	Clock,
	JobLogFields,
	JobLogger,
	JobResult,
} from "./types.ts";

/**
 * The runner never throws, whatever the job does. It is called from a timer callback, where an
 * escaped rejection becomes `unhandledRejection` and kills the process: one bug in orphan cleanup
 * would take the API down.
 */

const hasDb = await connectTestDatabase();

if (hasDb)
	afterAll(async () => {
		await closeDb();
	});

interface Captured {
	level: string;
	message: string;
	fields?: JobLogFields;
}

function recordingLogger(): { logger: JobLogger; lines: Captured[] } {
	const lines: Captured[] = [];
	const at =
		(level: string) =>
		(message: string, fields?: JobLogFields): void => {
			lines.push({ level, message, fields });
		};
	return {
		lines,
		logger: {
			debug: at("debug"),
			info: at("info"),
			warn: at("warn"),
			error: at("error"),
		},
	};
}

const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });

const job = (
	name: string,
	run: BackgroundJob["run"],
): BackgroundJob & { run: BackgroundJob["run"] } => ({
	name: `runner-test.${name}`,
	schedule: { kind: "interval", everyMs: 60_000 },
	run,
});

const ok = (over: Partial<JobResult> = {}): JobResult => ({
	processed: 0,
	succeeded: 0,
	failed: 0,
	...over,
});

describe.skipIf(!hasDb)("job runner", () => {
	test("a successful run is recorded with its result", async () => {
		const { logger, lines } = recordingLogger();
		const record = await runJob(
			job("success", async () => ok({ processed: 3, succeeded: 3 })),
			{ logger, clock: fixedClock("2026-08-25T00:00:00.000Z") },
		);

		expect(record.status).toBe("completed");
		expect(record.lock).toBe("acquired");
		expect(record.result.processed).toBe(3);
		expect(record.errorName).toBeNull();
		expect(record.startedAt).toBe("2026-08-25T00:00:00.000Z");
		expect(record.runId).toHaveLength(12);

		// A run that did nothing is info; error every 5 minutes would kill the alert.
		const completed = lines.find((l) => l.message === "done");
		expect(completed?.level).toBe("info");
	});

	test("catches and records a throwing job — the runner does not throw", async () => {
		const { logger, lines } = recordingLogger();
		const record = await runJob(
			job("throwing", async () => {
				throw new TypeError("the job blew up");
			}),
			{ logger },
		);

		expect(record.status).toBe("failed");
		// Not a lock failure; folding the two sends operators to the wrong place.
		expect(record.lock).toBe("acquired");
		expect(record.errorName).toBe("TypeError");
		expect(lines.some((l) => l.level === "error")).toBe(true);
	});

	test("item failures raise the completion to warn", async () => {
		const { logger, lines } = recordingLogger();
		const record = await runJob(
			job("partial", async () => ok({ processed: 2, succeeded: 1, failed: 1 })),
			{ logger },
		);

		expect(record.status).toBe("completed");
		expect(lines.find((l) => l.message.startsWith("done"))?.level).toBe("warn");
	});

	test("skips while the lock is held — not a failure", async () => {
		const target = job("locked", async () => ok({ processed: 99 }));
		const { logger } = recordingLogger();

		// Call the runner while holding the same lock from outside (= another replica is running).
		await withJobLock(target.name, async () => {
			const record = await runJob(target, { logger });
			expect(record.status).toBe("skipped");
			expect(record.lock).toBe("held");
			// A skipped run has an empty result: the job never ran.
			expect(record.result.processed).toBe(0);
		});
	});

	test("does not start with an already-aborted signal", async () => {
		let ran = false;
		const controller = new AbortController();
		controller.abort();

		const record = await runJob(
			job("aborted", async () => {
				ran = true;
				return ok();
			}),
			{ signal: controller.signal, logger: recordingLogger().logger },
		);

		expect(ran).toBe(false);
		expect(record.status).toBe("skipped");
		// Not `held`: the lock was never queried, and the two are different facts.
		expect(record.lock).toBe("not-attempted");
	});

	test("the context passes the signal, clock and dryRun to the job as is", async () => {
		const controller = new AbortController();
		let seen: { dryRun: boolean; now: string; aborted: boolean } | null = null;

		await runJob(
			job("context", async (ctx) => {
				seen = {
					dryRun: ctx.dryRun,
					now: ctx.clock.now().toISOString(),
					aborted: ctx.signal.aborted,
				};
				return ok();
			}),
			{
				dryRun: true,
				clock: fixedClock("2026-01-01T00:00:00.000Z"),
				signal: controller.signal,
				logger: recordingLogger().logger,
			},
		);

		expect(seen).toEqual({
			dryRun: true,
			now: "2026-01-01T00:00:00.000Z",
			aborted: false,
		});
	});

	test("the run id differs per run — it is the axis that ties log lines together", async () => {
		const target = job("run-id", async () => ok());
		const a = await runJob(target, { logger: recordingLogger().logger });
		const b = await runJob(target, { logger: recordingLogger().logger });
		expect(a.runId).not.toBe(b.runId);
	});
});
