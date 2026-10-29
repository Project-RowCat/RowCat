import { APP_NAME } from "@rowcat/domain";
import { closeDb } from "../db/client.ts";
import { closeRateLimit } from "../lib/rate-limit/index.ts";
import { inspectRetention } from "./legal/cleanup-expired-retention.ts";
import { backgroundJobs, findBackgroundJob } from "./registry.ts";
import { runJob } from "./runner.ts";
import { describeSchedule } from "./schedule.ts";
import { systemClock } from "./types.ts";

/**
 * Manual run: a process, not HTTP.
 *
 * No route (e.g. `POST /v2/admin/jobs/:name/run`) because it would be an address that can start
 * destruction from outside, authorized by one session. Everything needed (immediate run during
 * development, forced reconciliation during an incident) is for someone who can already reach the
 * server process and run commands in the container.
 *
 * No arbitrary parameters either: the only choices are which job to run now and whether to count
 * instead of destroy. A retention cutoff argument would express "delete the next 100 years' worth
 * now".
 *
 * `BACKGROUND_JOBS_ENABLED` is not consulted. That switch turns on the scheduler; a manual run is a
 * deliberate act and must work on deployments with the scheduler off, or an incident would wait on
 * flipping the switch and redeploying.
 *
 * ```bash
 * pnpm --filter @rowcat/api jobs:list
 * pnpm --filter @rowcat/api jobs:run media.cleanup-orphans
 * pnpm --filter @rowcat/api jobs:retention:inspect
 * ```
 *
 * In the deploy image, call the bundled entry point (the dev image's `tsx` is absent):
 *
 * ```bash
 * docker compose exec api node dist/jobs/cli.mjs run media.cleanup-orphans
 * ```
 */

function usage(): void {
	console.log(`${APP_NAME} background jobs

  list                      registered jobs and their schedules
  run <name> [--dry-run]    runs one job now
  retention:inspect         only counts retention destruction candidates (deletes nothing)
`);
	for (const job of backgroundJobs())
		console.log(`  · ${job.name} — ${describeSchedule(job.schedule)}`);
}

async function main(): Promise<number> {
	const [command, ...rest] = process.argv.slice(2);

	if (!command || command === "help" || command === "--help") {
		usage();
		return 0;
	}

	if (command === "list") {
		for (const job of backgroundJobs()) {
			const enabled = job.enabled?.() ?? true;
			console.log(
				`${job.name}\t${describeSchedule(job.schedule)}\t${enabled ? "enabled" : "disabled in this deployment"}`,
			);
		}
		return 0;
	}

	if (command === "retention:inspect") {
		/**
		 * Never takes the destruction path. The result equals a dry-run, but this code never calls a
		 * delete statement, so no typo can turn it into destruction.
		 */
		const rows = await inspectRetention(systemClock.now());
		for (const row of rows)
			console.log(
				`${row.id}\t${row.candidates} candidates\t${row.action}\t${row.period}\t(${row.source})`,
			);
		return 0;
	}

	if (command !== "run") {
		console.error(`unknown command: ${command}`);
		usage();
		return 2;
	}

	const name = rest.find((arg) => !arg.startsWith("--"));
	if (!name) {
		console.error("a job name is required");
		usage();
		return 2;
	}

	const job = findBackgroundJob(name);
	if (!job) {
		console.error(`not a registered job: ${name}`);
		usage();
		return 2;
	}

	/**
	 * Not blocked when `enabled` is false: that predicate keeps the scheduler quiet, and naming a job
	 * by hand is a different intent. The warning states it so a deployment missing configuration shows
	 * the cause of a failure right away.
	 */
	if (!(job.enabled?.() ?? true))
		console.warn(
			`[jobs] ${job.name} is disabled in this deployment's config — running it anyway`,
		);

	const record = await runJob(job, { dryRun: rest.includes("--dry-run") });

	/**
	 * The result is not dumped with `JSON.stringify`: the secret-logging static scan blocks
	 * serialization inside logging calls because code that prints a whole object also prints any field
	 * added to it later. Listing fields means a new one stays unprinted until someone edits this line;
	 * that friction is intended.
	 */
	console.log(`job        ${record.jobName}`);
	console.log(`runId      ${record.runId}`);
	console.log(`status     ${record.status}`);
	console.log(`lock       ${record.lock}`);
	console.log(`started    ${record.startedAt}`);
	console.log(`finished   ${record.finishedAt}`);
	console.log(`duration   ${record.durationMs}ms`);
	console.log(`processed  ${record.result.processed}`);
	console.log(`succeeded  ${record.result.succeeded}`);
	console.log(`failed     ${record.result.failed}`);
	if (record.errorName) console.log(`error      ${record.errorName}`);
	for (const [key, value] of Object.entries(record.result.details ?? {}))
		console.log(`  ${key}: ${String(value)}`);

	return record.status === "failed" ? 1 : 0;
}

/** The exit code is the point: ops scripts and CI branch on it, so a failed run never looks like success. */
const code = await main().catch((error) => {
	console.error("[jobs] the run failed", error);
	return 1;
});

await closeDb().catch(() => {});
await closeRateLimit().catch(() => {});
process.exit(code);
