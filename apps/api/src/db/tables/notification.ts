import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { member } from "./member.ts";
import { moderation_action, moderation_appeal } from "./moderation.ts";
import { story } from "./story.ts";

/**
 * In-app notifications: a private ledger read only by its recipient.
 *
 * This table is neither of two things it is easy to drift toward:
 * - An audit record. The audit record of enforcement is the immutable `moderation_action` row; a
 *   notification is a deletable copy made to tell a person (blocking sweeps an actor's social
 *   notifications, account deletion drops the whole inbox). Reconstructing enforcement from
 *   notification history would turn those deletions into data loss.
 * - A delivery queue. Inserting here is not sending push or mail, which is why the row can be
 *   created inside the originating transaction. Any future outbound delivery must happen after
 *   commit (outbox + worker) and needs a different table beside this one.
 *
 * No content is stored: no comment body, finished copy or web URL. Only the meaning of the event is
 * kept; names, titles and reasons are joined from current source rows at read time. The cost is
 * that "the name at that time" cannot be reproduced; the gain is that renamed people's old
 * notifications do not freeze, deleted comment text does not survive in notifications, and account
 * deletion has fewer identifier locations to sweep. Storing Korean copy would also pin the web's
 * wording on the server where a later Expo client must build its own.
 *
 * FK direction is policy:
 * - recipient: `cascade`. A deleted account's inbox goes whole.
 * - actor: `set null`. The notification belongs to someone else and stays; only the departed
 *   actor's identity goes, and the screen draws a neutral placeholder.
 * - every other reference: `set null`. With `cascade`, an operator deleting one comment would
 *   silently remove a line from someone's inbox.
 */
export const notification = pgTable(
	"notification",
	{
		id: text("id").primaryKey(),
		/** Owner of this notification. Comes only from the session; requests have no slot for it. */
		recipient: text("recipient")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		/** The contract's `NotificationKind`. The server treats it as a plain string. */
		kind: text("kind").notNull(),

		/**
		 * Who caused a social event. Always NULL for moderation notifications: the enforcing operator's
		 * identity does not reach the enforced member.
		 */
		actor: text("actor").references(() => member.id, { onDelete: "set null" }),
		story_id: text("story_id").references(() => story.id, {
			onDelete: "set null",
		}),
		/**
		 * Comment reference for later anchor navigation. No FK: operator and author deletions break it
		 * often, and a `set null` FK would UPDATE this table on every comment delete (same call as
		 * `moderation_action.target_comment_id`). Dangling ids are folded at read time by an existence
		 * check.
		 */
		comment_id: text("comment_id"),
		moderation_action_id: text("moderation_action_id").references(
			() => moderation_action.id,
			{ onDelete: "set null" },
		),
		moderation_appeal_id: text("moderation_appeal_id").references(
			() => moderation_appeal.id,
			{ onDelete: "set null" },
		),

		/**
		 * Which event produced this notification: the idempotency key. Its format belongs to
		 * `services/notifications.ts` and never goes out in a response.
		 *
		 * Follow alone is keyed per actor (`follow:<actorId>`). Keyed per event, a follow/unfollow loop
		 * could fill someone's inbox without limit; per actor it is always one row, revived as new on a
		 * re-follow.
		 */
		source_key: text("source_key").notNull(),

		/**
		 * The app floor being announced; `app_update` only, NULL otherwise.
		 *
		 * A value, not an FK. The floor row (`ops_app_version_floor`) exists but is the operator's
		 * current setting, so one floor change would rewrite the meaning of every
		 * notification already sent, and with one row per platform there is no history to recover. Frozen
		 * at send time and never re-read. The platform vocabulary (`ios`, `android`) is not enforced by
		 * the column.
		 */
		app_platform: text("app_platform"),
		app_version: text("app_version"),

		/** NULL means unread. There is no path back to unread. */
		read_at: timestamp("read_at", { withTimezone: true }),

		/**
		 * Millisecond precision on purpose. The cursor carries `(created_at, id)` through a JS `Date`; at
		 * the default microsecond precision the cursor would be truncated and the boundary row would
		 * appear on two pages (see `lib/cursor.ts`).
		 *
		 * A re-follow moves this forward so the row returns to the top, making it "last happened" rather
		 * than "created" because that is what the list reads as.
		 */
		created_at: timestamp("created_at", { withTimezone: true, precision: 3 })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		// One row per person per event. SELECT-then-INSERT is not enough: a retried comment write would
		// read nothing twice. The loser bounces and `onConflictDoNothing` (or follow's `DoUpdate`) turns
		// the conflict into the right behaviour.
		unique("uq_notification_source").on(t.recipient, t.source_key),
		// Dominant path: my notifications newest first after the cursor. Both sort keys descend to match
		// the `(created_at, id)` row comparison.
		index("idx_notification_inbox").on(
			t.recipient,
			t.created_at.desc(),
			t.id.desc(),
		),
		// Unread count, polled by the header every 60s. Partial so read rows do not grow it.
		index("idx_notification_unread")
			.on(t.recipient)
			.where(sql`${t.read_at} is null`),
		// Axis blocking walks: "social notifications this person made for me".
		index("idx_notification_actor").on(t.recipient, t.actor),
		// App-update broadcast status ("how many received this version"). The unique constraint leads
		// with the recipient so it cannot answer this. Partial so only app-update notifications pay the
		// write cost.
		index("idx_notification_app_update")
			.on(t.app_platform, t.app_version)
			.where(sql`${t.kind} = 'app_update'`),
	],
);
