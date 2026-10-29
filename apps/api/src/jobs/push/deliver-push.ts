import {
	claimPushDeliveries,
	claimPushReceipts,
	PUSH_RECEIPT_BATCH,
	PUSH_SEND_BATCH,
	sendClaimedPushDeliveries,
	settlePushReceipts,
} from "../../services/push/delivery.ts";
import type { JobContext, JobDefinition, JobResult } from "../types.ts";

/**
 * Native push delivery: the delivery plane that runs after notifications exist. The notification
 * transaction already wrote the delivery rows; this job walks them and calls Expo. The planes are
 * split because an outbound request inside the notification transaction would let that one request
 * roll back the event itself (`services/push/enqueue.ts` header).
 *
 * - The rules (who is a candidate, when it expires, what is retried, which registration is
 *   disabled) belong to `services/push/delivery.ts`; this file decides only how many and when to
 *   stop (`jobs/boundaries.test.ts`).
 * - Two ordered phases: (1) send, pending to accepted; (2) receipts, accepted to delivered or
 *   failed. They share one job because they use the same lease, cap and lock; two jobs would wait
 *   on each other over the same table. Sending comes first because users wait for the banner while
 *   receipts can be read next run.
 * - There is no terminal state: a run with no candidates is normal and logs one debug line. If
 *   this job logged error or info on a quiet app, those alerts would soon be muted.
 */

/**
 * Per-run send cap: five batches, since Expo takes 100 per request. Without a cap a large
 * deployment would hold the lock for minutes; the rest goes to the next run.
 */
const MAX_SENDS_PER_RUN = 500;

/**
 * Batch size comes from the provider's limit via the service. A number written here would go stale
 * when the adapter's limit changes, and the symptom would be a whole request rejected.
 */
const SEND_BATCH = PUSH_SEND_BATCH;

/**
 * Receipts checked per run. Smaller than sends: receipts are after-work that delays nothing, so
 * they must not take batch room when delivery is backed up.
 */
const MAX_RECEIPTS_PER_RUN = 200;

const RECEIPT_BATCH = PUSH_RECEIPT_BATCH;

export const deliverPushJob: JobDefinition = {
	name: "push.deliver",

	async run(ctx: JobContext): Promise<JobResult> {
		const now = ctx.clock.now();

		let sent = 0;
		let failed = 0;
		let retried = 0;
		let expired = 0;
		let disabled = 0;
		let delivered = 0;
		// Deliveries not sent because the registration lost eligibility when claimed.
		let inactive = 0;

		// Phase 1: send

		while (sent + failed + retried + expired < MAX_SENDS_PER_RUN) {
			if (ctx.signal.aborted) {
				ctx.logger.info(
					"shutdown signal — the next run sends the remaining deliveries",
					{ sent },
				);
				break;
			}

			// Claiming is one transaction (`for update skip locked` plus reservation), so replicas never
			// claim the same row twice and this loop needs no in-process lock.
			const claim = await claimPushDeliveries(SEND_BATCH, now);
			expired += claim.expired;
			failed += claim.exhausted + claim.unsupported + claim.inactive;
			inactive += claim.inactive;

			if (claim.deliveries.length === 0) {
				// Rows finished by expiry, attempt cap or lost eligibility may mean more candidates in the next
				// batch. Omitting the last term here would hide the later candidates for this whole cycle on
				// runs with many ineligible registrations.
				if (
					claim.expired +
						claim.exhausted +
						claim.unsupported +
						claim.inactive ===
					0
				)
					break;
				continue;
			}

			const report = await sendClaimedPushDeliveries(claim.deliveries, now);
			sent += report.accepted;
			retried += report.retried;
			failed += report.failed;
			disabled += report.disabled;
		}

		// Phase 2: receipts

		let checked = 0;
		while (checked < MAX_RECEIPTS_PER_RUN) {
			if (ctx.signal.aborted) break;

			const claim = await claimPushReceipts(RECEIPT_BATCH, now);
			failed += claim.exhausted;
			if (claim.receipts.length === 0) break;

			checked += claim.receipts.length;
			const report = await settlePushReceipts(claim.receipts, now);
			delivered += report.delivered;
			failed += report.failed;
			disabled += report.disabled;
		}

		const processed = sent + failed + retried + expired + delivered;
		if (processed === 0)
			// Nothing to send is the normal state.
			ctx.logger.debug("no pushes to send");

		if (inactive > 0)
			// The session expired or the user turned it off on that device: a normal path, one info line,
			// with neither member nor registration logged.
			ctx.logger.info(
				"did not send deliveries for registrations that lost entitlement",
				{ inactive },
			);

		if (disabled > 0)
			// Log only that registrations were disabled, never tokens or member ids: operators read this
			// log, and anyone who sees a token could push to that installation.
			ctx.logger.info("turned off registrations the provider doesn't know", {
				disabled,
			});

		return {
			processed,
			succeeded: sent + delivered,
			failed,
			details: { sent, delivered, retried, expired, disabled, inactive },
		};
	},
};
