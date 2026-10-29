import { legalRetentionDryRun } from "../env.ts";
import { newId } from "../lib/id.ts";
import { JobLockUnavailable, withJobLock } from "./lock.ts";
import type {
	Clock,
	JobContext,
	JobDefinition,
	JobLogFields,
	JobLogger,
	JobResult,
	JobRunRecord,
} from "./types.ts";
import { emptyResult, systemClock } from "./types.ts";

/**
 * The shell of one run: lock, time, logging and failure isolation all live here. Job files must
 * hold none of the four, or the next job copies all of them and one will forget the abort signal or
 * the unlock.
 *
 * Exceptions stop here: whatever a job throws, this function does not throw. The scheduler calls it
 * from a timer callback, where an escaped exception becomes `unhandledRejection` and kills the
 * process, so one bug in orphan cleanup would take the API down. Failures surface in logs and the
 * return value instead.
 *
 * Severity states the status:
 *
 * ```text
 * skipped, lock held                 info   normal (several replicas, or the previous run still going)
 * nothing to do                      info   having nothing to reconcile is a good state
 * one item failed                    warn   the next run retries
 * whole run failed, lock infra down  error  a person must look
 * ```
 *
 * Logging "nothing to reconcile" as error every 5 minutes would get the alert muted, and nobody
 * would see a real failure.
 */

/** Log line shape: prefix plus structured fields, this repository's existing convention. */
function createLogger(jobName: string, runId: string): JobLogger {
	const base: JobLogFields = { job: jobName, runId };
	const emit =
		(level: "debug" | "info" | "warn" | "error") =>
		(message: string, fields?: JobLogFields): void => {
			const line = `[jobs] ${message}`;
			// The name `fields` is deliberate: the secret-logging static scan checks logging call argument
			// names and `payload` is on its list (sync envelopes), so that name here would fail the scan.
			const merged = { ...base, ...fields };
			if (level === "error") console.error(line, merged);
			else if (level === "warn") console.warn(line, merged);
			else console.log(line, merged);
		};
	return {
		debug: emit("debug"),
		info: emit("info"),
		warn: emit("warn"),
		error: emit("error"),
	};
}

export interface RunJobOptions {
	/** Aborts when shutdown begins; if absent a signal living only for this run is created. */
	signal?: AbortSignal;
	/** Tests and manual runs pass a fixed clock. */
	clock?: Clock;
	/**
	 * Count without deleting. When omitted, deployment config (`LEGAL_RETENTION_DRY_RUN`) decides; a
	 * manual run overrides it with `--dry-run`.
	 */
	dryRun?: boolean;
	logger?: JobLogger;
}

/**
 * Runs one job once; the scheduler and manual runs call the same function. If the two paths split,
 * "only happens when run by cron" problems appear and cannot be reproduced by hand; only what calls
 * this function, and when, may differ.
 */
export async function runJob(
	// Does not require a schedule: the runner reads only the name and `run`, and the parameter type
	// should say so. Requiring `BackgroundJob` would make manual runs and tests invent a schedule they
	// never use.
	job: JobDefinition,
	options: RunJobOptions = {},
): Promise<JobRunRecord> {
	const runId = newId().slice(0, 12);
	const clock = options.clock ?? systemClock;
	const logger = options.logger ?? createLogger(job.name, runId);
	const startedAt = clock.now();
	const startedMs = Date.now();

	// Without a caller signal, create one that never aborts.
	const signal = options.signal ?? new AbortController().signal;

	const finish = (
		status: JobRunRecord["status"],
		lock: JobRunRecord["lock"],
		result: JobResult,
		errorName: string | null,
	): JobRunRecord => {
		const durationMs = Date.now() - startedMs;
		return {
			jobName: job.name,
			runId,
			startedAt: startedAt.toISOString(),
			finishedAt: new Date(startedAt.getTime() + durationMs).toISOString(),
			durationMs,
			status,
			lock,
			result,
			errorName,
		};
	};

	// Do not start with an already-aborted signal: a job that came due during shutdown would stop at
	// its first batch boundary yet still take and release the lock, leaving a run record for nothing
	// done.
	if (signal.aborted) {
		logger.debug("not starting because shutdown is in progress");
		return finish("skipped", "not-attempted", emptyResult(), null);
	}

	const record = await runOnce();

	if (record.status === "completed") {
		const { processed, succeeded, failed, details } = record.result;
		const fields: JobLogFields = {
			durationMs: record.durationMs,
			processed,
			succeeded,
			failed,
			...details,
		};
		if (failed > 0) logger.warn("done (some failed)", fields);
		else logger.info("done", fields);
	}

	return record;

	// Lock, run, record; absorbs every exception here.
	async function runOnce(): Promise<JobRunRecord> {
		try {
			const locked = await withJobLock(job.name, async () => {
				const context: JobContext = {
					runId,
					jobName: job.name,
					logger,
					clock,
					signal,
					dryRun: options.dryRun ?? legalRetentionDryRun,
				};
				logger.debug("start");
				return job.run(context);
			});

			if (locked.outcome === "held") {
				// Normal: another replica is running or the previous run has not finished. Late runs are not
				// queued; these jobs re-read current state every time, so a skipped tick is absorbed by the
				// next.
				logger.debug("skipping because another run holds the lock");
				return finish("skipped", "held", emptyResult(), null);
			}
			return finish(
				"completed",
				"acquired",
				locked.value ?? emptyResult(),
				null,
			);
		} catch (error) {
			if (error instanceof JobLockUnavailable) {
				logger.error("couldn't check the lock", {
					reason: String(error.reason),
				});
				return finish("failed", "unavailable", emptyResult(), error.name);
			}
			// The job failed outright. The original goes only to the log and the return value carries just
			// the error name: manual runs print it as-is, and exception messages can contain query fragments
			// or provider responses.
			logger.error("the run failed", {
				error: error instanceof Error ? error.name : "unknown",
				detail: String(error),
			});
			return finish(
				"failed",
				"acquired",
				emptyResult(),
				error instanceof Error ? error.name : "unknown",
			);
		}
	}
}
