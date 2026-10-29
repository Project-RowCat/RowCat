import { count, getTableName, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import type { JobContext, JobDefinition, JobResult } from "../types.ts";
import type { RetentionPolicy } from "./retention-policies.ts";
import {
	RETENTION_POLICIES,
	UNRESOLVED_RETENTION,
} from "./retention-policies.ts";

/**
 * Retention enforcement for records that have no use once they expire. PIPA art. 21 requires
 * deleting personal data whose purpose is gone; not doing so raises no error, so this job is the
 * only thing that makes it true.
 *
 * - It interprets no law: what may be deleted is whatever `retention-policies.ts` registers.
 *   Unresolved categories have no predicate at all, so no setting can make this job touch them.
 * - One cutoff per run. With `now()` in SQL the cutoff would drift between batches, so a boundary
 *   row's fate would depend on its batch, and tests could not pin the boundary by value.
 * - No single large DELETE: on hundreds of thousands of rows it locks the table for long and a
 *   failure rolls back everything. Small batches are each a commit unit, so earlier ones survive an
 *   interruption.
 */

/** Rows deleted per batch. */
const BATCH_SIZE = 500;

/** Per-policy cap on rows deleted in one run. */
const MAX_PER_POLICY = 20_000;

/**
 * Narrows each batch by `ctid` rather than by primary key, because some tables have a composite key
 * (`sync_pairing` is `(owner, code_hash)`). `ctid` can change under VACUUM or UPDATE, but the
 * window is milliseconds and expired rows are not updated; if it does change, the row survives this
 * batch and the next run finds it again, which errs on the safe side.
 */
async function deleteBatch(
	policy: RetentionPolicy,
	now: Date,
	limit: number,
): Promise<number> {
	const table = sql.identifier(getTableName(policy.table));
	const result = await db.execute(sql`
		delete from ${table}
		where ctid = any (array(
			select ctid from ${table}
			where ${policy.expired(now)}
			limit ${limit}
		))
	`);
	return result.rowCount ?? 0;
}

/** Counts candidates without deleting. */
async function countCandidates(
	policy: RetentionPolicy,
	now: Date,
): Promise<number> {
	const [row] = await db
		.select({ value: count() })
		.from(policy.table)
		.where(policy.expired(now));
	return row?.value ?? 0;
}

export const cleanupExpiredRetentionJob: JobDefinition = {
	name: "legal.cleanup-expired-retention",

	async run(ctx: JobContext): Promise<JobResult> {
		// One clock read per run so every policy judges against the same instant.
		const now = ctx.clock.now();

		let processed = 0;
		let deleted = 0;
		let failed = 0;
		const perPolicy: Record<string, number> = {};

		for (const policy of RETENTION_POLICIES) {
			if (ctx.signal.aborted) {
				ctx.logger.info(
					"shutdown signal — the next run handles the remaining policies",
					{
						stoppedAt: policy.id,
					},
				);
				break;
			}

			try {
				if (ctx.dryRun) {
					// Deletion is irreversible, so after a deploy the candidate counts can be checked first.
					const candidates = await countCandidates(policy, now);
					perPolicy[policy.id] = candidates;
					processed += candidates;
					ctx.logger.info("candidates (dry-run)", {
						policy: policy.id,
						candidates,
						period: policy.period,
						source: policy.source,
					});
					continue;
				}

				let removed = 0;
				// Truncation must be reported, never silent.
				let truncated = false;
				while (removed < MAX_PER_POLICY) {
					if (ctx.signal.aborted) break;
					const batch = await deleteBatch(
						policy,
						now,
						Math.min(BATCH_SIZE, MAX_PER_POLICY - removed),
					);
					removed += batch;
					// A short batch means nothing is left.
					if (batch < BATCH_SIZE) break;
					if (removed >= MAX_PER_POLICY) truncated = true;
				}

				// Unlogged, a cap reads as "everything deleted" while only 20,000 rows/day go for months.
				if (truncated)
					ctx.logger.warn(
						"cut off at the cap — the next run handles the rest",
						{
							policy: policy.id,
							limit: MAX_PER_POLICY,
						},
					);

				perPolicy[policy.id] = removed;
				processed += removed;
				deleted += removed;

				if (removed > 0)
					ctx.logger.info("retention expiry destruction", {
						policy: policy.id,
						deleted: removed,
						period: policy.period,
					});
			} catch (error) {
				// Keep going: stopping here would leave later policies unenforced, with no error.
				failed += 1;
				ctx.logger.error("policy enforcement failed", {
					policy: policy.id,
					error: error instanceof Error ? error.name : "unknown",
					detail: String(error),
				});
			}
		}

		// Log only the count: the list's existence should be visible, its contents live in code and the
		// reconciliation doc.
		ctx.logger.debug("unresolved retention categories (not destroyed)", {
			count: UNRESOLVED_RETENTION.length,
		});

		return {
			processed,
			succeeded: ctx.dryRun ? 0 : deleted,
			failed,
			details: {
				dryRun: ctx.dryRun,
				policies: RETENTION_POLICIES.length,
				unresolved: UNRESOLVED_RETENTION.length,
				...perPolicy,
			},
		};
	},
};

/**
 * Operator inspection: reports what is eligible without deleting. No public route; the callers are
 * the manual-run CLI and tests, both already inside the server process.
 */
export async function inspectRetention(now: Date): Promise<
	{
		id: string;
		period: string;
		source: string;
		action: string;
		candidates: number;
	}[]
> {
	const rows: {
		id: string;
		period: string;
		source: string;
		action: string;
		candidates: number;
	}[] = [];
	for (const policy of RETENTION_POLICIES) {
		rows.push({
			id: policy.id,
			period: policy.period,
			source: policy.source,
			action: policy.action,
			candidates: await countCandidates(policy, now),
		});
	}
	return rows;
}

export type { RetentionPolicy };
