/**
 * Contract for background jobs; the repository has exactly one scheduler.
 *
 * - No timer per job. Hand-rolled `setInterval`s each miss something (one has no distributed
 *   lock, one ignores the shutdown signal, one swallows exceptions) and the files are too far apart
 *   for review to notice. With one contract, locking, overlap prevention, shutdown, logging and
 *   failure isolation live in the runner and a job holds only its own domain.
 * - Jobs hold no rules. Each is a caller of an existing service function; a copied state machine,
 *   media-reference decision or retention calculation drifts silently and shows up as "a different
 *   conclusion only under the scheduler".
 *
 * ```text
 * scheduler -> runner -> registered jobs -> domain/service functions
 *              ^ locking, time, logging and isolation all live here
 * ```
 */

/** A run asks for the time once (see `JobContext.clock`). */
export interface Clock {
	now(): Date;
}

/** Tests pass a fixed clock instead. */
export const systemClock: Clock = { now: () => new Date() };

/**
 * Takes fields rather than a formatted string: job logs answer a fixed set of questions (what,
 * when, how much, why it failed) and free text would vary per run.
 *
 * Must not carry payment identifiers, prompts, message or mail bodies, tokens, provider secrets or
 * identity-verification originals; diagnostics need only our row ids and counts.
 * `lib/no-secret-logging.test.ts` scans for this.
 */
export interface JobLogger {
	debug(message: string, fields?: JobLogFields): void;
	info(message: string, fields?: JobLogFields): void;
	warn(message: string, fields?: JobLogFields): void;
	error(message: string, fields?: JobLogFields): void;
}

export type JobLogFields = Record<string, string | number | boolean | null>;

/**
 * What a job holds: only what it needs. Neither `db` nor `redis` is here, for opposite reasons.
 *
 * - `redis` is an optional dependency (`getRedis()` is `null` without `REDIS_URL`), which is also
 *   why the lock cannot sit on it, and no registered job reads it. An unused dependency on the
 *   context invites putting anything there (same call as `services/admin/overview.ts` drawing no
 *   Redis card).
 * - `db` is too powerful. Jobs are callers of service functions and `boundaries.test.ts` blocks
 *   them from importing `db/client.ts`; handing `db` through the context would pass that scan while
 *   doing the same work.
 *
 * Retention destruction is the one exception and it is visible as an import: its targets (auth
 * tokens, sessions, relays) have no domain service, and building one only for it would put the
 * destruction predicate in two places. The scan allows that one file by name.
 */
export interface JobContext {
	/** Groups this run's log lines; never stored. */
	readonly runId: string;
	readonly jobName: string;
	readonly logger: JobLogger;
	/**
	 * One clock per run; jobs do not call `new Date()` again. A drifting reference time would give
	 * each batch a different cutoff for "delete what expired", visible only on a boundary row.
	 */
	readonly clock: Clock;
	/** Shutdown started. Check only between batches; cutting mid-transaction commits half-done destruction. */
	readonly signal: AbortSignal;
	/** Count without changing anything; only destructive jobs read it. */
	readonly dryRun: boolean;
}

/**
 * `processed` need not equal `succeeded + failed`: items whose condition changed mid-scan may be
 * skipped, and that count goes in `details`.
 */
export interface JobResult {
	/** Items actually processed, not candidates. */
	processed: number;
	succeeded: number;
	failed: number;
	/** Counts, booleans and short vocabulary only; no bodies, identifiers or personal data. */
	details?: JobLogFields;
}

export const emptyResult = (): JobResult => ({
	processed: 0,
	succeeded: 0,
	failed: 0,
});

/** Owned by registration metadata, not the job: a period inside the job file hides "what runs when" and leaves deployments no place to change it. */
export type JobSchedule =
	| {
			kind: "interval";
			/** Minimum gap between run starts; the lock prevents overlap. */
			everyMs: number;
	  }
	| {
			kind: "daily";
			/** Set by deployment config (`BACKGROUND_JOBS_DAILY_AT`). */
			hour: number;
			minute: number;
			/** IANA zone; the host `TZ` is not read. */
			timeZone: string;
	  };

export interface BackgroundJob {
	/** Lock key and log axis. Renaming makes it a different job: during a rolling deploy the old and new names would each take a lock and overlap. */
	readonly name: string;
	readonly schedule: JobSchedule;
	/** Whether the job means anything in this deployment; if not, the scheduler does not register it at all (noise would bury real failures). */
	readonly enabled?: () => boolean;
	run(context: JobContext): Promise<JobResult>;
}

/** A job without a period; `registry.ts` attaches it so "what runs when" lives in one place. */
export type JobDefinition = Omit<BackgroundJob, "schedule" | "enabled">;

export type JobLockOutcome =
	| "acquired"
	/** Another run holds it; normal with several replicas or a still-running prior run. */
	| "held"
	/** The lock could not be queried (DB outage); a failure. */
	| "unavailable"
	/** Not asked because shutdown was under way. Not folded into `held`: operators read that as "another instance was running" when nobody was. */
	| "not-attempted";

/** Goes to the log and is returned as-is to a manual run. */
export interface JobRunRecord {
	jobName: string;
	runId: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	status: "completed" | "skipped" | "failed";
	lock: JobLockOutcome;
	result: JobResult;
	/** The failure kind only; the raw message goes to the log, never here. */
	errorName: string | null;
}
