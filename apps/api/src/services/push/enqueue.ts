import { sql } from "drizzle-orm";
import {
	notification,
	push_delivery,
	push_registration,
} from "../../db/schema.ts";
import type { PushExecutor } from "./registrations.ts";
import { activePushRegistrationPredicate } from "./registrations.ts";

/**
 * Creates deliveries inside the transaction that created the notifications, as a set.
 *
 * - Inside the transaction: outside it, a crash between commit and delivery creation would leave
 *   a notification that is never pushed (idempotency blocks a second insert). Same reasoning as the
 *   notification ledger living inside the comment transaction.
 * - Expo call outside it: waiting on an outbound request inside would tie notification
 *   correctness to an external service and make "pushed but notification rolled back"
 *   representable. "Notification committed, push transiently failed" is always valid.
 * - One set, not one round trip per member: the app-update announcement notifies every
 *   member, so callers pass the notification INSERT's `returning` ids straight in.
 * - Created even with the transport off: this layer answers "is there something to deliver", not
 *   "can we send now" (the job's question). With no registrations the join yields 0 rows.
 */

/**
 * Returns the number of delivery rows created. 0 is normal: most members have no registration, and
 * a retried call also answers 0 through `on conflict do nothing`.
 */
export async function enqueuePushDeliveries(
	executor: PushExecutor,
	notificationIds: readonly string[],
	options: {
		/**
		 * The same notification row became a new event (follow revival). Notification idempotency reuses
		 * the row, so the unique `(notification_id, registration_id)` would silently swallow the second
		 * delivery. This deletes the earlier deliveries and recreates them; the deleted rows record the
		 * previous event.
		 */
		resetExisting?: boolean;
	} = {},
): Promise<number> {
	if (notificationIds.length === 0) return 0;

	const ids = sql.param(notificationIds as string[]);

	if (options.resetExisting)
		await executor.execute(sql`
			delete from ${push_delivery}
			where ${push_delivery.notification_id} = any(${ids}::text[])
		`);

	/**
	 * Recipients come from re-reading the notification rows, because a caller-supplied `(id,
	 * recipient)` pair could disagree. Rows written by this same transaction are visible before
	 * commit.
	 */
	const result = await executor.execute(sql`
		insert into ${push_delivery} (
			"id", "notification_id", "registration_id", "state", "next_attempt_at"
		)
		select
			replace(gen_random_uuid()::text, '-', ''),
			${notification.id},
			${push_registration.id},
			'pending',
			now()
		from ${notification}
		join ${push_registration}
			on ${push_registration.member_id} = ${notification.recipient}
		where ${notification.id} = any(${ids}::text[])
			and ${activePushRegistrationPredicate}
		on conflict ("notification_id", "registration_id") do nothing
	`);
	return result.rowCount ?? 0;
}
