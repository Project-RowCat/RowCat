import { afterAll, describe, expect, test } from "vitest";
import { closeDb } from "../db/client.ts";
import { backgroundJobsEnabled } from "../env.ts";
import { connectTestDatabase } from "../test/database.ts";
import { startBackgroundJobs } from "./scheduler.ts";
import type { BackgroundJob, JobResult } from "./types.ts";

/**
 * Real timers, not fake ones: every property here is "the next tick arrived while a run was still
 * going", which fake time cannot reproduce. Tick intervals are made very short so overlap really
 * happens.
 */

const hasDb = await connectTestDatabase();

if (hasDb)
	afterAll(async () => {
		await closeDb();
	});

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

const result = (): JobResult => ({ processed: 0, succeeded: 0, failed: 0 });

/** The name prefix keeps this file's locks apart from other suites'. */
const job = (
	name: string,
	run: BackgroundJob["run"],
	everyMs = 20,
): BackgroundJob => ({
	name: `scheduler-test.${name}`,
	schedule: { kind: "interval", everyMs },
	run,
});

describe("scheduler start boundary", () => {
	test("with the setting off, turns nothing on", () => {
		// The test environment leaves `BACKGROUND_JOBS_ENABLED` unset (the repository default), so `pnpm
		// test` never runs destruction jobs.
		expect(backgroundJobsEnabled).toBe(false);
		expect(startBackgroundJobs()).toBeNull();
	});

	test("does not schedule jobs disabled in the deployment", async () => {
		let ran = 0;
		const scheduler = startBackgroundJobs({
			tickMs: 5,
			jobs: [
				{
					...job("disabled", async () => {
						ran += 1;
						return result();
					}),
					enabled: () => false,
				},
			],
		});
		// With nothing to schedule, no scheduler is created.
		expect(scheduler).toBeNull();
		await sleep(60);
		expect(ran).toBe(0);
	});
});

describe.skipIf(!hasDb)("scheduler runs", () => {
	test("runs when due", async () => {
		let ran = 0;
		const scheduler = startBackgroundJobs({
			tickMs: 5,
			jobs: [
				job(
					"runs",
					async () => {
						ran += 1;
						return result();
					},
					10,
				),
			],
		});

		await expect.poll(() => ran, { timeout: 3_000 }).toBeGreaterThan(0);
		await scheduler?.stop();
	});

	test("does not overlap even when a run is longer than the interval", async () => {
		let running = 0;
		let maxConcurrent = 0;
		let completed = 0;

		const scheduler = startBackgroundJobs({
			tickMs: 5,
			jobs: [
				job(
					"overlap",
					async () => {
						running += 1;
						maxConcurrent = Math.max(maxConcurrent, running);
						// Far longer than the 20ms period, so several ticks pass.
						await sleep(120);
						running -= 1;
						completed += 1;
						return result();
					},
					20,
				),
			],
		});

		await expect.poll(() => completed, { timeout: 5_000 }).toBeGreaterThan(0);
		await scheduler?.stop();

		// Overlapping ticks are skipped, not queued, so two runs never ran at once.
		expect(maxConcurrent).toBe(1);
	});

	test("one job failing does not stop the others", async () => {
		let healthy = 0;
		let broken = 0;

		const scheduler = startBackgroundJobs({
			tickMs: 5,
			jobs: [
				job(
					"broken",
					async () => {
						broken += 1;
						throw new Error("this job always blows up");
					},
					10,
				),
				job(
					"healthy",
					async () => {
						healthy += 1;
						return result();
					},
					10,
				),
			],
		});

		await expect.poll(() => healthy, { timeout: 3_000 }).toBeGreaterThan(1);
		expect(broken).toBeGreaterThan(0);
		await scheduler?.stop();
	});

	test("after shutdown no new run starts", async () => {
		let ran = 0;
		const scheduler = startBackgroundJobs({
			tickMs: 5,
			jobs: [
				job(
					"stops",
					async () => {
						ran += 1;
						return result();
					},
					10,
				),
			],
		});

		await expect.poll(() => ran, { timeout: 3_000 }).toBeGreaterThan(0);
		await scheduler?.stop();

		const afterStop = ran;
		await sleep(80);
		expect(ran).toBe(afterStop);
	});

	test("shutdown waits for the in-flight run — it leaves no half-finished batch", async () => {
		let finished = false;
		const scheduler = startBackgroundJobs({
			tickMs: 5,
			jobs: [
				job(
					"drains",
					async () => {
						await sleep(150);
						finished = true;
						return result();
					},
					10,
				),
			],
		});

		// Wait for the run to start before stopping.
		await sleep(40);
		await scheduler?.stop();
		expect(finished).toBe(true);
	});

	test("the shutdown signal reaches the in-flight job", async () => {
		let sawAbort = false;
		const scheduler = startBackgroundJobs({
			tickMs: 5,
			jobs: [
				job(
					"signal",
					async (ctx) => {
						// Mimics a batch boundary, the only place the signal is checked.
						for (let i = 0; i < 40; i++) {
							if (ctx.signal.aborted) {
								sawAbort = true;
								break;
							}
							await sleep(10);
						}
						return result();
					},
					10,
				),
			],
		});

		await sleep(40);
		await scheduler?.stop();
		expect(sawAbort).toBe(true);
	});
});
