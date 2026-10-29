import { sql } from "drizzle-orm";
import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import { session } from "./auth.ts";
import { member } from "./member.ts";
import { notification } from "./notification.ts";

/**
 * Delivery plane of native push: two tables, neither an authority over notifications.
 *
 * ```text
 * push_registration   can this installation receive push now
 * push_delivery       which durable notification is still undelivered to which registration
 * ```
 *
 * The `notification` row is the source of truth; these record attempts to push that event outward.
 * Whatever fails here, the notification stays, and emptying both tables changes nothing in the
 * inbox.
 */

/**
 * Push registration, bound to one authenticated native session.
 *
 * Bound to the session rather than the member: with only a member id, a row would outlive Alice's
 * sign-out and the device would keep receiving her notifications whenever the client's best-effort
 * unregister fails. With the session FK and `on delete cascade`, signing out is unregistering and
 * the guarantee comes from the database (Better Auth's `signOut` and `revokeSession` delete the
 * session row). That also isolates account switching: Bob's login makes a different session, and
 * Alice's row is gone or expired.
 *
 * `member_id` is kept as a query axis, not duplication: delivery asks for "this member's live
 * registrations" and deriving that through a session join would add a join per notification. The
 * two cascades do not collide because deleting a member deletes their sessions too.
 *
 * A live session row is not the whole eligibility: session rows linger after expiry until cleanup,
 * so the predicate also checks `expiresAt > now()` (`services/push/registrations.ts`); copying it
 * into a column would drift from session renewal.
 *
 * The token is not the key. The unique key is `(session_id, installation_id)` and the token is a
 * value the row carries; as an identity it would create a new row per refresh and deliver twice.
 */
export const push_registration = pgTable(
	"push_registration",
	{
		id: text("id").primaryKey(),

		/** The member this registration receives for. */
		member_id: text("member_id")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),

		/** The authenticated session that created it; signing out takes this row with it. */
		session_id: text("session_id")
			.notNull()
			.references(() => session.id, { onDelete: "cascade" }),

		/** Opaque app-installation identity, not a device fingerprint (see the push header in `@rowcat/contracts`). */
		installation_id: text("installation_id").notNull(),

		platform: text("platform").notNull(),

		/** Currently only `expo`; the vocabulary is stored for the reason in the contract header. */
		provider: text("provider").notNull(),

		/**
		 * Expo push token. Never goes into responses, audit or logs. It is not an auth credential, but
		 * holding it lets someone push to that installation, so only the delivery job reads this column.
		 */
		token: text("token").notNull(),

		/**
		 * When the provider said the token is no longer valid (`DeviceNotRegistered`). Marked rather than
		 * deleted so the same installation can revive the row (refresh clears this) and so the
		 * undelivered deliveries made meanwhile can be explained.
		 */
		disabled_at: timestamp("disabled_at", { withTimezone: true }),

		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** When the token was last confirmed; rises on every refresh. */
		refreshed_at: timestamp("refreshed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		// One registration per installation per session. A token change alters the value instead of
		// adding a row; without this a refresh would deliver twice to that device.
		unique("uq_push_registration_installation").on(
			t.session_id,
			t.installation_id,
		),
		// Axis used when creating deliveries (member -> live registrations).
		index("idx_push_registration_member")
			.on(t.member_id)
			.where(sql`${t.disabled_at} is null`),
	],
);

/**
 * Push delivery: one notification times one registration.
 *
 * Per registration, not per member, because failures differ per device: the phone can succeed while
 * the tablet's token is dead, and folding them would let the tablet block the phone.
 *
 * State machine:
 *
 * ```text
 * pending  --sent--> accepted --receipt ok--> delivered      (success)
 *    |                  `--receipt error--> failed           (permanent failure)
 *    |--transient failure--> pending (backoff)
 *    |--permanent failure--> failed
 *    `--over lifetime--> expired                             (not sent)
 * ```
 *
 * `accepted` is not terminal: it means Expo took the request, not that APNs/FCM delivered, so the
 * receipt must be checked once more to learn about dead tokens.
 *
 * `next_attempt_at` has two meanings: the next send time in `pending` and the receipt-check time in
 * `accepted`. Two columns would let both be in the past and the row be picked by both phases.
 *
 * Notification content is not copied here (no title, body or kind). The kind is read from the
 * notification row at send time, so this table holds no user data and cannot become a second inbox.
 */
export const push_delivery = pgTable(
	"push_delivery",
	{
		id: text("id").primaryKey(),

		/** The event to deliver. A delivery is the notification's shadow and goes with it. */
		notification_id: text("notification_id")
			.notNull()
			.references(() => notification.id, { onDelete: "cascade" }),

		registration_id: text("registration_id")
			.notNull()
			.references(() => push_registration.id, { onDelete: "cascade" }),

		/** `pending` | `accepted` | `delivered` | `failed` | `expired` */
		state: text("state").notNull().default("pending"),

		/** Sends to the provider so far; the axis of backoff and the cap. */
		attempts: integer("attempts").notNull().default(0),

		/** See the two meanings in the header above. */
		next_attempt_at: timestamp("next_attempt_at", { withTimezone: true })
			.notNull()
			.defaultNow(),

		/** Ticket from Expo; the only key for asking about the receipt. */
		ticket_id: text("ticket_id"),

		/**
		 * Code of the last classified failure (`DeviceNotRegistered`, `network`, ...). The provider's
		 * original message is not stored because it can contain the token; diagnosis only needs which
		 * branch it was.
		 */
		last_error: text("last_error"),

		accepted_at: timestamp("accepted_at", { withTimezone: true }),
		/** When it ended (success, failure or expiry alike). */
		settled_at: timestamp("settled_at", { withTimezone: true }),

		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		// Never create the same notification twice for the same device. The notification's
		// `unique(recipient, source_key)` guards event idempotency and this guards delivery idempotency.
		unique("uq_push_delivery_target").on(t.notification_id, t.registration_id),
		// The job's candidate-picking axis. Partial so finished rows (most of them) are absent and
		// picking cost does not grow with history.
		index("idx_push_delivery_due")
			.on(t.next_attempt_at)
			.where(sql`${t.state} in ('pending', 'accepted')`),
	],
);
