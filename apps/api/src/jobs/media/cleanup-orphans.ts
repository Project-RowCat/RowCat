import {
	findOrphanedAvatarMedia,
	isAvatarMediaOrphaned,
	ORPHAN_AVATAR_GRACE_HOURS,
	purgeMedia,
} from "../../services/media.ts";
import type { JobContext, JobDefinition, JobResult } from "../types.ts";

/**
 * Orphaned avatar media cleanup: the scheduler `findOrphanedAvatarMedia`'s header anticipated. The
 * reference check, grace period and deletion order are not rebuilt here.
 *
 * It sweeps `avatar` only, and that narrowness is the safeguard. The other kinds' references are
 * unknown to the server:
 *
 * ```text
 * scene_image   referenced from devices' E2EE drafts and published playback snapshots, so a
 *               server-side join cannot say "nobody points at this"; deleting anyway makes a
 *               live work's picture vanish
 * story_cover   lives in its own table (`story_cover`), not as a media row
 * ```
 *
 * A test pins the single kind. A new kind may be swept only when the server can answer its
 * references authoritatively, which is that domain's question, not this file's.
 *
 * Grace period: being unreferenced now is not enough to delete. Upload is three non-transactional
 * steps (store bytes, media row, move pointer), so media created but not yet linked is a normal
 * moment; without grace the cleanup would kill live uploads. The value (24 hours) is one service
 * constant.
 */

/**
 * Per-run delete cap, so no run sweeps the whole store. Orphans stay orphans, so deleting late is
 * harmless.
 */
const MAX_PER_RUN = 200;

const BATCH_SIZE = 50;

export const cleanupOrphanMediaJob: JobDefinition = {
	name: "media.cleanup-orphans",

	async run(ctx: JobContext): Promise<JobResult> {
		const now = ctx.clock.now();

		let processed = 0;
		let purged = 0;
		let failed = 0;
		// Candidates dropped by the re-check just before deletion.
		let requeued = 0;
		let truncated = false;

		// Failed items stay listed; this keeps them from being picked again in the same run.
		const seen = new Set<string>();

		while (processed < MAX_PER_RUN) {
			if (ctx.signal.aborted) {
				ctx.logger.info(
					"shutdown signal — the next run handles the remaining candidates",
					{
						processed,
					},
				);
				break;
			}

			const candidates = await findOrphanedAvatarMedia({
				limit: Math.min(BATCH_SIZE, MAX_PER_RUN - processed),
				olderThanHours: ORPHAN_AVATAR_GRACE_HOURS,
				now,
			});
			const fresh = candidates.filter((record) => !seen.has(record.id));
			if (fresh.length === 0) break;

			for (const record of fresh) {
				if (ctx.signal.aborted) break;
				seen.add(record.id);

				// Re-check right before deleting: a batch's worth of time passes after candidate selection. No
				// path re-points an avatar at an existing row today (replacement always creates a new one), but
				// irreversible deletion does not rely on "no such path now".
				if (!(await isAvatarMediaOrphaned(record.id))) {
					requeued += 1;
					continue;
				}

				processed += 1;

				// `purgeMedia` deletes bytes first, rows second; that order is what makes retry work. If the
				// byte delete fails the row stays and the next run finds it again; the reverse order would
				// leave bytes as unrecorded orphans nobody can find. Hence no direct storage calls in this
				// file. The function returns `false` instead of throwing (cleanup failure must not fail the
				// user's operation), and here `false` means "try again next time".
				if (await purgeMedia(record)) purged += 1;
				else {
					failed += 1;
					// `purgeMedia` already logged the cause with its step; only note the retry, so the same error
					// is not logged twice.
					ctx.logger.warn(
						"failed to delete orphan media — the next run retries",
						{
							mediaId: record.id,
						},
					);
				}
			}

			if (processed >= MAX_PER_RUN) truncated = true;
		}

		if (processed === 0 && requeued === 0)
			// No orphans is the normal state: replace and delete paths already clean up immediately.
			ctx.logger.debug("no orphan media to delete");

		if (truncated)
			ctx.logger.info("cut off at the cap — the next run handles the rest", {
				limit: MAX_PER_RUN,
			});

		return {
			processed,
			succeeded: purged,
			failed,
			details: {
				purged,
				requeued,
				graceHours: ORPHAN_AVATAR_GRACE_HOURS,
				truncated,
			},
		};
	},
};
