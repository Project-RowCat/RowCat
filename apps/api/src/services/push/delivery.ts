import { PUSH_ANDROID_CHANNEL_ID } from "@rowcat/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
	notification,
	push_delivery,
	push_registration,
} from "../../db/schema.ts";
import { pushTransportConfig } from "../../env.ts";
import { type PushCopy, pushCopyFor } from "./copy.ts";
import {
	EXPO_RECEIPT_BATCH,
	EXPO_SEND_BATCH,
	type PushMessage,
	readPushReceipts,
	sendPushMessages,
} from "./expo.ts";
import {
	activePushRegistrationPredicate,
	disablePushRegistration,
} from "./registrations.ts";

/**
 * Delivery execution: the only surface the job calls. The job file holds "how many, when to stop";
 * every rule (candidates, expiry, failure folding, which registration to disable) lives here.
 *
 * Delivery is not exactly-once. If the process dies after Expo accepted a message but before we
 * record it, the lease expires and the delivery goes out a second time. The window cannot be
 * removed, so it is narrowed: short lease, attempt cap, and a duplicate only costs one banner
 * appearing twice (the inbox stays one row).
 *
 * Nothing here UPDATEs a `notification` row. A permanently failed delivery leaves read state,
 * timestamps and existence untouched; that is what "push is not authority" means.
 */

/**
 * A delivery lives 24 hours. Push is transient and the inbox is durable; a banner for a
 * three-day-old comment after a job outage is noise. A device that was off overnight still reads
 * last night's event as "happened while away"; older than that, opening the app and the inbox
 * answers. An expired delivery ends as `expired` and the notification is untouched.
 */
export const PUSH_DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * After a claim, other runs do not see the row for this long. An expiring lease rather than a lock
 * so a dead process cannot stall that delivery forever.
 */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

/**
 * Wait before reading receipts. Expo needs time to prepare them; asking too early mostly returns
 * `pending` and only adds round trips.
 */
const RECEIPT_DELAY_MS = 15 * 60 * 1000;

/**
 * Attempt cap. Past it the delivery is `failed` (the inbox is unchanged). With the backoff the cap
 * is reached inside the lifetime; whichever comes first wins.
 */
const MAX_ATTEMPTS = 8;

/** Transient-failure backoff; the last value repeats. */
const BACKOFF_MS = [
	30_000,
	2 * 60_000,
	10 * 60_000,
	30 * 60_000,
	60 * 60_000,
] as const;

const backoffFor = (attempts: number): number =>
	BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1] ??
	BACKOFF_MS[BACKOFF_MS.length - 1];

/**
 * Reason when a registration lost eligibility at claim time. It shares `last_error` with provider
 * failures but means "chose not to attempt", so operations logs can answer "why did it not go".
 */
export const PUSH_REGISTRATION_INACTIVE = "registration_inactive";

/**
 * Batch sizes derive from the provider's limits. A job-side constant would go stale when the
 * adapter's limit changes, and the symptom is a whole request rejected.
 */
export const PUSH_SEND_BATCH = EXPO_SEND_BATCH;
export const PUSH_RECEIPT_BATCH = EXPO_RECEIPT_BATCH;

export interface ClaimedPushDelivery {
	deliveryId: string;
	notificationId: string;
	registrationId: string;
	token: string;
	copy: PushCopy;
}

export interface PushClaim {
	deliveries: ClaimedPushDelivery[];
	/** Settled without sending because the lifetime passed. */
	expired: number;
	/** Settled because the attempt cap was reached. */
	exhausted: number;
	/** Settled because no copy can be built (unknown notification kind). */
	unsupported: number;
	/** Settled without sending because the registration lost eligibility. */
	inactive: number;
}

/**
 * Eligibility at creation time does not mean it is fine to send now. A delivery can stay `pending`
 * arbitrarily long (backoff, stopped job), and meanwhile the session may expire or the user may
 * turn the device off:
 *
 * ```text
 * 12:00  notification + delivery created   registration eligible
 * 12:01  session expires / device off      registration loses eligibility
 * 12:02  job claims the delivery           without re-asking it goes out anyway
 * ```
 *
 * So the same predicate (`activePushRegistrationPredicate`, shared with the creating side; two
 * copies would loosen one silently) runs again inside the claiming transaction. Such rows are
 * settled as `registration_inactive`, not just filtered out: a merely excluded row stays `pending`
 * and occupies batch slots until the cap or lifetime takes it, and an ineligible registration never
 * comes back (a returning one is a new registration and a new delivery). The notification row is
 * untouched.
 */

/**
 * Claims deliveries to send and reserves them in one transaction.
 *
 * `for update skip locked` is the whole concurrency story: two replicas never claim the same row,
 * with no in-process mutex. The reservation is pessimistic, bumping attempts and the next time
 * before sending; an optimistic one would make a delivery that died mid-provider-call a candidate
 * again immediately, with no bound. The eligibility check sits inside this transaction for the same
 * reason: asking beforehand opens a window between asking and claiming.
 */
export async function claimPushDeliveries(
	limit: number,
	now: Date,
): Promise<PushClaim> {
	return db.transaction(async (tx) => {
		const claimed = await tx.execute<{
			id: string;
			state: string;
			lastError: string | null;
		}>(sql`
			with due as (
				select
					${push_delivery.id} as id,
					exists (
						select 1
						from ${push_registration}
						where ${push_registration.id} = ${push_delivery.registration_id}
							and ${activePushRegistrationPredicate}
					) as active
				from ${push_delivery}
				where ${push_delivery.state} = 'pending'
					and ${push_delivery.next_attempt_at} <= ${now}
				order by ${push_delivery.next_attempt_at}
				limit ${limit}
				for update skip locked
			)
			update ${push_delivery} as d
			set
				"attempts" = d."attempts" + 1,
				"state" = case
					when not due.active then 'failed'
					when d."created_at" + ${sql.raw(`interval '${PUSH_DELIVERY_TTL_MS} milliseconds'`)} <= ${now} then 'expired'
					when d."attempts" + 1 > ${MAX_ATTEMPTS} then 'failed'
					else 'pending'
				end,
				"settled_at" = case
					when not due.active
						or d."created_at" + ${sql.raw(`interval '${PUSH_DELIVERY_TTL_MS} milliseconds'`)} <= ${now}
						or d."attempts" + 1 > ${MAX_ATTEMPTS} then ${now}
					else d."settled_at"
				end,
				"last_error" = case
					when not due.active then ${PUSH_REGISTRATION_INACTIVE}
					when d."created_at" + ${sql.raw(`interval '${PUSH_DELIVERY_TTL_MS} milliseconds'`)} <= ${now} then 'expired'
					when d."attempts" + 1 > ${MAX_ATTEMPTS} then 'attempts_exhausted'
					else d."last_error"
				end,
				"next_attempt_at" = ${new Date(now.getTime() + CLAIM_LEASE_MS)}
			from due
			where d."id" = due.id
			returning d."id" as id, d."state" as state, d."last_error" as "lastError"
		`);

		const rows = claimed.rows;
		const sendable = rows.filter((row) => row.state === "pending");

		const detail = sendable.length
			? await tx
					.select({
						deliveryId: push_delivery.id,
						notificationId: push_delivery.notification_id,
						registrationId: push_delivery.registration_id,
						token: push_registration.token,
						kind: notification.kind,
					})
					.from(push_delivery)
					.innerJoin(
						push_registration,
						eq(push_registration.id, push_delivery.registration_id),
					)
					.innerJoin(
						notification,
						eq(notification.id, push_delivery.notification_id),
					)
					.where(
						inArray(
							push_delivery.id,
							sendable.map((row) => row.id),
						),
					)
			: [];

		const deliveries: ClaimedPushDelivery[] = [];
		const unsupported: string[] = [];
		for (const row of detail) {
			const copy = pushCopyFor(row.kind);
			if (!copy) {
				unsupported.push(row.deliveryId);
				continue;
			}
			deliveries.push({
				deliveryId: row.deliveryId,
				notificationId: row.notificationId,
				registrationId: row.registrationId,
				token: row.token,
				copy,
			});
		}

		/**
		 * A kind with no copy is settled here; re-claiming gives the same result and would hold batch
		 * slots until the cap. The notification stays.
		 */
		if (unsupported.length)
			await tx
				.update(push_delivery)
				.set({
					state: "failed",
					settled_at: now,
					last_error: "unsupported_kind",
				})
				.where(inArray(push_delivery.id, unsupported));

		/**
		 * Ineligible-registration rows and cap-exhausted rows are both `failed`; the reason in
		 * `last_error` tells them apart, since this is why the result happened, not a result.
		 */
		const inactive = rows.filter(
			(row) => row.lastError === PUSH_REGISTRATION_INACTIVE,
		).length;

		return {
			deliveries,
			expired: rows.filter((row) => row.state === "expired").length,
			exhausted: rows.filter((row) => row.state === "failed").length - inactive,
			unsupported: unsupported.length,
			inactive,
		};
	});
}

export interface PushSendReport {
	accepted: number;
	retried: number;
	failed: number;
	/** Registrations disabled because the provider said it does not know the token. */
	disabled: number;
}

/**
 * Sends claimed deliveries and records results. One registration's failure does not block
 * another's: each delivery is recorded separately and a dead token disables only its registration.
 */
export async function sendClaimedPushDeliveries(
	claimed: readonly ClaimedPushDelivery[],
	now: Date,
): Promise<PushSendReport> {
	const report: PushSendReport = {
		accepted: 0,
		retried: 0,
		failed: 0,
		disabled: 0,
	};
	if (claimed.length === 0) return report;

	const transport = pushTransportConfig;
	if (!transport) return report;

	const messages: PushMessage[] = claimed.map((delivery) => ({
		token: delivery.token,
		title: delivery.copy.title,
		body: delivery.copy.body,
		data: { version: 1, notificationId: delivery.notificationId },
		channelId: PUSH_ANDROID_CHANNEL_ID,
	}));

	const outcomes = await sendPushMessages(messages, transport.accessToken);

	for (const [index, delivery] of claimed.entries()) {
		const outcome = outcomes[index] ?? {
			status: "retry" as const,
			code: "missing_result",
		};
		switch (outcome.status) {
			case "accepted":
				await db
					.update(push_delivery)
					.set({
						/**
						 * Without a ticket there is no key to ask for a receipt, so settle here (acceptance by the
						 * provider is all we can know).
						 */
						state: outcome.ticketId ? "accepted" : "delivered",
						ticket_id: outcome.ticketId,
						accepted_at: now,
						settled_at: outcome.ticketId ? null : now,
						last_error: null,
						next_attempt_at: new Date(now.getTime() + RECEIPT_DELAY_MS),
					})
					.where(eq(push_delivery.id, delivery.deliveryId));
				report.accepted += 1;
				break;
			case "retry":
				await scheduleRetry(delivery.deliveryId, outcome.code, now);
				report.retried += 1;
				break;
			case "unregistered":
				await disablePushRegistration({
					registrationId: delivery.registrationId,
					now,
				});
				report.disabled += 1;
				await settleFailed(delivery.deliveryId, outcome.code, now);
				report.failed += 1;
				break;
			default:
				await settleFailed(delivery.deliveryId, outcome.code, now);
				report.failed += 1;
		}
	}
	return report;
}

export interface ClaimedPushReceipt {
	deliveryId: string;
	registrationId: string;
	ticketId: string;
}

/**
 * Claims deliveries awaiting receipts, with the same reservation rule as sending. Rows past the cap
 * end as `failed`: some tickets never get a receipt (the provider never creates the key), and
 * asking forever would hold the batch.
 */
export async function claimPushReceipts(
	limit: number,
	now: Date,
): Promise<{ receipts: ClaimedPushReceipt[]; exhausted: number }> {
	return db.transaction(async (tx) => {
		const claimed = await tx.execute<{ id: string; state: string }>(sql`
			with due as (
				select ${push_delivery.id} as id
				from ${push_delivery}
				where ${push_delivery.state} = 'accepted'
					and ${push_delivery.ticket_id} is not null
					and ${push_delivery.next_attempt_at} <= ${now}
				order by ${push_delivery.next_attempt_at}
				limit ${limit}
				for update skip locked
			)
			update ${push_delivery} as d
			set
				"attempts" = d."attempts" + 1,
				"state" = case
					when d."attempts" + 1 > ${MAX_ATTEMPTS} then 'failed'
					else 'accepted'
				end,
				"settled_at" = case
					when d."attempts" + 1 > ${MAX_ATTEMPTS} then ${now}
					else d."settled_at"
				end,
				"last_error" = case
					when d."attempts" + 1 > ${MAX_ATTEMPTS} then 'receipt_unavailable'
					else d."last_error"
				end,
				"next_attempt_at" = ${new Date(now.getTime() + CLAIM_LEASE_MS)}
			from due
			where d."id" = due.id
			returning d."id" as id, d."state" as state
		`);

		const rows = claimed.rows;
		const live = rows.filter((row) => row.state === "accepted");
		const detail = live.length
			? await tx
					.select({
						deliveryId: push_delivery.id,
						registrationId: push_delivery.registration_id,
						ticketId: push_delivery.ticket_id,
					})
					.from(push_delivery)
					.where(
						inArray(
							push_delivery.id,
							live.map((row) => row.id),
						),
					)
			: [];

		return {
			receipts: detail.flatMap((row) =>
				row.ticketId
					? [
							{
								deliveryId: row.deliveryId,
								registrationId: row.registrationId,
								ticketId: row.ticketId,
							},
						]
					: [],
			),
			exhausted: rows.filter((row) => row.state === "failed").length,
		};
	});
}

export interface PushReceiptReport {
	delivered: number;
	pending: number;
	retried: number;
	failed: number;
	disabled: number;
}

/** Reads receipts and records results. */
export async function settlePushReceipts(
	claimed: readonly ClaimedPushReceipt[],
	now: Date,
): Promise<PushReceiptReport> {
	const report: PushReceiptReport = {
		delivered: 0,
		pending: 0,
		retried: 0,
		failed: 0,
		disabled: 0,
	};
	if (claimed.length === 0) return report;

	const transport = pushTransportConfig;
	if (!transport) return report;

	const outcomes = await readPushReceipts(
		claimed.map((row) => row.ticketId),
		transport.accessToken,
	);

	for (const receipt of claimed) {
		const outcome = outcomes.get(receipt.ticketId) ?? {
			status: "retry" as const,
			code: "missing_receipt",
		};
		switch (outcome.status) {
			case "delivered":
				await db
					.update(push_delivery)
					.set({ state: "delivered", settled_at: now, last_error: null })
					.where(eq(push_delivery.id, receipt.deliveryId));
				report.delivered += 1;
				break;
			case "pending":
				await db
					.update(push_delivery)
					.set({
						state: "accepted",
						next_attempt_at: new Date(now.getTime() + RECEIPT_DELAY_MS),
					})
					.where(eq(push_delivery.id, receipt.deliveryId));
				report.pending += 1;
				break;
			case "retry":
				await db
					.update(push_delivery)
					.set({
						state: "accepted",
						last_error: outcome.code,
						next_attempt_at: new Date(now.getTime() + RECEIPT_DELAY_MS),
					})
					.where(eq(push_delivery.id, receipt.deliveryId));
				report.retried += 1;
				break;
			case "unregistered":
				await disablePushRegistration({
					registrationId: receipt.registrationId,
					now,
				});
				report.disabled += 1;
				await settleFailed(receipt.deliveryId, outcome.code, now);
				report.failed += 1;
				break;
			default:
				await settleFailed(receipt.deliveryId, outcome.code, now);
				report.failed += 1;
		}
	}
	return report;
}

async function scheduleRetry(
	deliveryId: string,
	code: string,
	now: Date,
): Promise<void> {
	const [row] = await db
		.select({ attempts: push_delivery.attempts })
		.from(push_delivery)
		.where(eq(push_delivery.id, deliveryId))
		.limit(1);
	const attempts = row?.attempts ?? 1;
	if (attempts >= MAX_ATTEMPTS) {
		await settleFailed(deliveryId, code, now);
		return;
	}
	await db
		.update(push_delivery)
		.set({
			state: "pending",
			last_error: code,
			next_attempt_at: new Date(now.getTime() + backoffFor(attempts)),
		})
		.where(
			and(
				eq(push_delivery.id, deliveryId),
				// Do not revive a row another run already settled.
				eq(push_delivery.state, "pending"),
			),
		);
}

async function settleFailed(
	deliveryId: string,
	code: string,
	now: Date,
): Promise<void> {
	await db
		.update(push_delivery)
		.set({ state: "failed", settled_at: now, last_error: code })
		.where(eq(push_delivery.id, deliveryId));
}
