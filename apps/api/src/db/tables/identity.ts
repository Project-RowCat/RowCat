import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { member } from "./member.ts";

/**
 * Identity-verification attempt: the only record a member's own verification leaves, and it holds
 * no identity.
 *
 * Not `guardian_consent`, because that records a guardian's consent (third-party name/contact,
 * link hash) while this records only that this member completed verification. With a
 * `purpose` column folding the two, `member_id` would mean both "consent subject" and "verified
 * person", which are opposites (child vs adult guardian). Above all neither may be exchangeable for
 * the other: a guardian's verification opening a child's adult entitlement is the costliest defect
 * in this repository, and separate tables make that lookup impossible.
 *
 * `purpose` exists anyway (one value, `adult_eligibility`) so that it is part of the completion
 * lookup's predicate: when a second consumer starts using this table, old attempts are not silently
 * consumed by it.
 *
 * Absent on purpose: date of birth (the adapter folds it to a boolean and discards it), CI/DI (no
 * slot in the port type), name/contact (no retention basis for this consumer), gender, carrier,
 * foreigner flag and the raw provider response. What remains is one opaque reference, timestamps
 * and an "was 19 or older" boolean.
 *
 * ```text
 * pending     started, not yet verified; one per member (partial unique index)
 * verified    provider verified; `adult` holds the result
 * failed      provider could not verify
 * superseded  replaced by a newer attempt from the same member
 * ```
 *
 * No `expired`: expiry is the `expires_at` predicate. `superseded` is not folded into `failed` so
 * the audit trail does not lie; a superseded attempt never failed.
 */
export const identity_verification = pgTable(
	"identity_verification",
	{
		id: text("id").primaryKey(),
		/** The member who was verified; removed with them. */
		member_id: text("member_id")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),

		/**
		 * What the verification is for; currently only `adult_eligibility`. Part of the completion
		 * lookup's predicate so attempts for different purposes cannot consume each other, hence no
		 * default.
		 */
		purpose: text("purpose").notNull(),

		/** `pending | verified | failed | superseded`. */
		status: text("status").notNull(),

		/** Name of the provider (e.g. `portone`), needed for audit. */
		provider: text("provider").notNull(),
		/**
		 * Opaque provider reference that `verify` queries with. Never passes through the client: the
		 * completion request points at our attempt id and this value is read from that row, otherwise
		 * attaching someone else's verification to your own request would be expressible (same channel
		 * binding as guardian consent). NULL until the start step finishes.
		 */
		provider_ref: text("provider_ref"),

		/**
		 * Whether the verified person was 19 or older (the Korean Civil Act art. 4). Only this boolean is kept, not the
		 * birth date. NULL unless `verified`: `false` on an unverified attempt would assert "verified as
		 * a minor".
		 */
		adult: boolean("adult"),

		requested_at: timestamp("requested_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** Attempt lifetime; the sole basis for expiry (not a status column). */
		expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
		/** When the provider finished verifying, by their clock; stamping ours would not be evidence. */
		verified_at: timestamp("verified_at", { withTimezone: true }),
		/**
		 * When this attempt was applied to the member's state. Separate from `verified_at` (the
		 * provider's event vs ours); needed to answer which verification produced the current
		 * entitlement, which disputes do ask.
		 */
		consumed_at: timestamp("consumed_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		/**
		 * One open attempt per member and purpose. The partial unique index is the final authority: two
		 * tabs starting at the same instant could both supersede the old attempt and both create a new
		 * one, and two windows would then try to apply different verifications to the same member.
		 */
		uniqueIndex("identity_verification_open_idx")
			.on(t.member_id, t.purpose)
			.where(sql`${t.status} = 'pending'`),
		/**
		 * A provider reference cannot be reused across accounts. Collisions do not happen today because
		 * we mint the reference, but that is a property of the adapter, not this table; if a path ever
		 * takes a reference as input, this index makes one verification opening two accounts
		 * inexpressible.
		 */
		uniqueIndex("identity_verification_ref_idx")
			.on(t.provider_ref)
			.where(sql`${t.provider_ref} is not null`),
		/** Member attempt history (account-deletion cleanup, audit). */
		index("identity_verification_member_idx").on(t.member_id, t.requested_at),
	],
);
