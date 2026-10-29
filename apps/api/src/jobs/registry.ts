import {
	backgroundJobsDailyAt,
	backgroundJobsTimeZone,
	mobileUpdateCiConfig,
	pushEnabled,
} from "../env.ts";
import { cleanupExpiredRetentionJob } from "./legal/cleanup-expired-retention.ts";
import { cleanupOrphanMediaJob } from "./media/cleanup-orphans.ts";
import { reconcileMobileUpdateJobsJob } from "./mobile-updates/reconcile-jobs.ts";
import { deliverPushJob } from "./push/deliver-push.ts";
import type { BackgroundJob, JobSchedule } from "./types.ts";

/**
 * Every job this deployment runs; the schedule lives here, not in the job files, so "what runs
 * when" needs one file. Deployment-tunable values (time, time zone) come from `env.ts`; the
 * intervals stay code, each with its reason beside it.
 *
 * Adding a job is one line here plus one implementation file; the scheduler, runner and lock stay
 * untouched, and if they must change the boundary was drawn wrong.
 */

/**
 * Push delivery interval: 30 seconds, far shorter than the other interval jobs, because users wait
 * for it. A comment banner arriving after 5 minutes is a
 * recap, not a notification. The cost is 2,880 lock attempts a day, and a run with no candidates is
 * one query (the delivery index is partial and excludes finished rows). The worst remaining delay
 * is 30 seconds; if real time is needed the answer is another layer, not a smaller value.
 */
const PUSH_DELIVERY_INTERVAL_MS = 30 * 1000;

/**
 * Mobile OTA job reconciliation interval: 5 minutes. It re-reads from GitHub the jobs CI could not
 * report (dead run or lost report). Operators wait on that state in the console, so an hourly
 * interval would draw "publishing is stuck" reports first; shorter multiplies GitHub API calls.
 */
const MOBILE_UPDATE_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Daily schedule: time and zone come from deployment config, and jobs are offset slightly. There
 * are two daily jobs, and starting both at the same instant would push the pool and DB with two
 * batch deletions for no reason beyond "one config value". Running either later reaches the same
 * conclusion (expiry is a cutoff comparison), so the offset is free. Still within the early-morning
 * hour: 03:00 and 03:30 by default.
 */
function daily(offsetMinutes = 0): JobSchedule {
	const total =
		backgroundJobsDailyAt.hour * 60 +
		backgroundJobsDailyAt.minute +
		offsetMinutes;
	// Wraps past midnight: 23:50 + 30 min is 00:20 the next day, not 24:20.
	const wrapped = ((total % 1440) + 1440) % 1440;
	return {
		kind: "daily",
		hour: Math.floor(wrapped / 60),
		minute: wrapped % 60,
		timeZone: backgroundJobsTimeZone,
	};
}

/**
 * The registered jobs. Order is meaningless: each has its own lock and none waits on another, so a
 * failing orphan cleanup does not stop push delivery (failure isolation is the runner's).
 */
export function backgroundJobs(): BackgroundJob[] {
	return [
		{
			...deliverPushJob,
			schedule: { kind: "interval", everyMs: PUSH_DELIVERY_INTERVAL_MS },
			// Not registered without a transport: when on, it claims candidates and calls Expo, so plain
			// local development must not push to users' real devices (`lib/push-config.ts`).
			enabled: () => pushEnabled,
		},

		{
			...reconcileMobileUpdateJobsJob,
			schedule: {
				kind: "interval",
				everyMs: MOBILE_UPDATE_RECONCILE_INTERVAL_MS,
			},
			// No CI connection means no job rows are created. The opposite direction is enforced by config
			// resolution: a production deployment with the CI connection on cannot boot without this
			// periodic job.
			enabled: () => mobileUpdateCiConfig !== null,
		},
		{ ...cleanupOrphanMediaJob, schedule: daily() },
		{ ...cleanupExpiredRetentionJob, schedule: daily(30) },
	];
}

/** Manual runs look jobs up by name. */
export function findBackgroundJob(name: string): BackgroundJob | undefined {
	return backgroundJobs().find((job) => job.name === name);
}
