import { backgroundJobsEnabled } from "../env.ts";
import { backgroundJobs } from "./registry.ts";
import { runJob } from "./runner.ts";
import { describeSchedule, nextRunAt } from "./schedule.ts";
import type { BackgroundJob, Clock } from "./types.ts";
import { systemClock } from "./types.ts";

/**
 * Scheduler lifecycle, started explicitly by `index.ts`. This module has no top-level side effects:
 * if importing it started timers, migration scripts, seeds, tests and bundle analysis would each
 * get a scheduler, and one of the jobs performs irreversible destruction.
 *
 * One tick looks at every job instead of one timer per job. Per-job `setInterval` would leave many
 * handles to clear on shutdown, and a 24-hour timer only fires if the process survives that long,
 * which never happens when deploys occur several times a day. Instead each job holds a due time and
 * the tick asks "has it passed"; a new process recomputes its own due times, and a late run is just
 * late (the jobs all re-inspect current state, so lateness does not change the outcome).
 */

/** Due-time check interval; also the upper bound on timing error for daily jobs. */
const TICK_MS = 30_000;

/** Cap on how long shutdown waits for in-flight runs. */
const SHUTDOWN_GRACE_MS = 15_000;

interface ScheduledJob {
	job: BackgroundJob;
	dueAt: Date;
	lastStartedAt: Date | null;
	running: boolean;
}

export interface BackgroundJobScheduler {
	stop(): Promise<void>;
}

export interface StartSchedulerOptions {
	clock?: Clock;
	tickMs?: number;
	/**
	 * Test seam: supplying jobs bypasses `BACKGROUND_JOBS_ENABLED`. Otherwise tests of overlap,
	 * isolation and shutdown would have to enable that variable, which starts the real jobs
	 * (destruction included) in the test process.
	 *
	 * Product code calls this with no arguments; `boundaries.test.ts` pins `src/index.ts` as the only
	 * caller.
	 */
	jobs?: BackgroundJob[];
}

/** Returns `null` when jobs are off; that is the normal state (dev and test default), not an error. */
export function startBackgroundJobs(
	options: StartSchedulerOptions = {},
): BackgroundJobScheduler | null {
	if (!backgroundJobsEnabled && !options.jobs) return null;

	const clock = options.clock ?? systemClock;
	const tickMs = options.tickMs ?? TICK_MS;
	const controller = new AbortController();

	const scheduled: ScheduledJob[] = (options.jobs ?? backgroundJobs())
		.filter((job) => job.enabled?.() ?? true)
		.map((job) => ({
			job,
			// No run right after boot: instances started together would all be due at once and one lock
			// winner would make the rest skip. Putting the first due time a period out spreads them.
			dueAt: nextRunAt(job.schedule, clock.now(), null),
			lastStartedAt: null,
			running: false,
		}));

	if (scheduled.length === 0) {
		console.log("[jobs] no registered jobs — not starting the scheduler");
		return null;
	}

	for (const entry of scheduled) {
		console.log(
			`[jobs] scheduled ${entry.job.name} — ${describeSchedule(entry.job.schedule)} (next ${entry.dueAt.toISOString()})`,
		);
	}

	// In-flight runs, which shutdown waits for.
	const inFlight = new Set<Promise<unknown>>();

	const tick = (): void => {
		if (controller.signal.aborted) return;
		const now = clock.now();

		for (const entry of scheduled) {
			if (entry.dueAt.getTime() > now.getTime()) continue;

			// First overlap gate (same process); the lock covers other processes. Checking here keeps a tick
			// that would skip anyway from borrowing a pool connection.
			if (entry.running) {
				// Push the due time forward, or the entry reads as due every tick and logs every 30s. Skipped
				// runs are never queued.
				entry.dueAt = nextRunAt(entry.job.schedule, now, entry.lastStartedAt);
				continue;
			}

			entry.running = true;
			entry.lastStartedAt = now;
			entry.dueAt = nextRunAt(entry.job.schedule, now, now);

			const run = runJob(entry.job, {
				signal: controller.signal,
				clock,
			})
				.catch(() => {
					// `runJob` does not throw; this guards the day that breaks, since a rejection escaping a timer
					// callback is an `unhandledRejection`.
				})
				.finally(() => {
					entry.running = false;
					inFlight.delete(run);
				});
			inFlight.add(run);
		}
	};

	const timer = setInterval(tick, tickMs);
	// Do not keep the process alive; the server socket already does, and a lingering timer would delay
	// shutdown.
	timer.unref?.();

	console.log(
		`[jobs] scheduler started — ${scheduled.length} jobs, checking due times every ${Math.round(tickMs / 1000)} seconds`,
	);

	return {
		async stop(): Promise<void> {
			clearInterval(timer);
			// Block new runs and signal running ones. Jobs check the signal only at batch boundaries, so the
			// item in progress finishes, which is what avoids half-processed destruction.
			controller.abort();
			if (inFlight.size === 0) return;

			console.log(`[jobs] waiting to shut down — ${inFlight.size} in flight`);
			// Capped: without it one hung request stalls the deploy until the orchestrator sends `SIGKILL`,
			// which is worse (locks release when the session closes, so giving up leaves none).
			await Promise.race([
				Promise.allSettled([...inFlight]),
				new Promise((resolve) => {
					const t = setTimeout(resolve, SHUTDOWN_GRACE_MS);
					t.unref?.();
				}),
			]);
		},
	};
}
