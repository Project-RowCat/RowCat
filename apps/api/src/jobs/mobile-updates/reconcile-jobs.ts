import { reconcileMobileUpdateJobs } from "../../services/mobile-updates/jobs.ts";
import type { JobContext, JobDefinition, JobResult } from "../types.ts";

/**
 * Reconciles OTA publish jobs: finds lost CI reports. The main way a job ends is CI's report; this
 * ends jobs whose report never came (runner died, the callback failed on the network, CI never
 * started) using CI's run state. Without it such a job stays the only live job for its
 * channel/platform and every later publish gets 409 (why config resolution blocks a production
 * deployment that enables the CI connection without this job).
 *
 * The rules live in `services/mobile-updates/jobs.ts`. Results are not invented: a successful run
 * with no report is `ci_result_missing`, and the stream's latest release is not guessed as the
 * result.
 */
export const reconcileMobileUpdateJobsJob: JobDefinition = {
	name: "mobile-updates.reconcile-jobs",

	async run(ctx: JobContext): Promise<JobResult> {
		const result = await reconcileMobileUpdateJobs(ctx.clock.now());
		if (result.checked === 0) ctx.logger.debug("no live OTA jobs");
		if (result.errors > 0)
			ctx.logger.warn(
				"couldn't ask for the CI run status — the next run asks again",
				{
					errors: result.errors,
				},
			);
		return {
			processed: result.checked,
			succeeded: result.finished,
			failed: result.errors,
			details: { finished: result.finished },
		};
	},
};
