import { sql } from "drizzle-orm";
import {
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { member } from "./member.ts";

/**
 * Guardian consent: the only key that opens a child account, and itself a legal record.
 *
 * Not a `member.guardian_approved` boolean. the Korean Personal Information Protection Act art. 22-2(1) requires both obtaining consent
 * and verifying that it was given. A boolean covers only the first (no who, how, what or when), and
 * it cannot express withdrawal, where "never consented" and "withdrew" need different follow-up.
 *
 * Deliberately absent:
 * - Resident registration number, CI, DI or the raw verification response. Only one opaque
 *   `verification_ref` from the provider is kept.
 * - The child's date of birth (see `member.age_status`).
 * - The raw token. Only its SHA-256 hash is stored, so a DB dump is not every open consent link.
 * - Anything identifying the child on the guardian side. `member_id` never appears in
 *   `GuardianConsentViewDto`.
 *
 * `status` has no `expired`. Expiry is a predicate on `expires_at`, so the cleanup sweep is not a
 * correctness condition.
 */
export const guardian_consent = pgTable(
	"guardian_consent",
	{
		id: text("id").primaryKey(),
		/**
		 * The child member the consent is for; removed with them. The guardian has no account and none is
		 * created, since that would make the guardian an identity with access to the child's data.
		 */
		member_id: text("member_id")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),

		/** `pending | verified | approved | declined | revoked`. */
		status: text("status").notNull(),

		/**
		 * SHA-256 hash (hex) of the single-use link token. Hashed for the same reason passwords are: it
		 * is a possession-based credential for the guardian screen. Also the only lookup axis, since a
		 * guardian request carries nothing but the token.
		 */
		token_hash: text("token_hash").notNull(),

		/** Which verification method from the Enforcement Decree art. 17-2 was used, for example `identity-verification`. */
		verification_method: text("verification_method"),
		/** Name of the verification provider this deployment used, needed for audit. */
		verification_provider: text("verification_provider"),
		/**
		 * Opaque reference from the provider, for reconciling with their records in a dispute. Never CI,
		 * DI or a resident number; the port type in `services/guardian/provider.ts` returns a single
		 * `reference` string with no identity fields.
		 */
		verification_ref: text("verification_ref"),
		/**
		 * Guardian's name: the minimum the Korean Personal Information Protection Act art. 22-2(2) allows collecting from the child, as
		 * answered by the provider. Nullable, since consent stands on `verification_ref` without it.
		 * Never returned in any response.
		 */
		guardian_name: text("guardian_name"),
		/** Guardian's contact: minimum data under the same clause, used only for consent notice and withdrawal inquiries; never for marketing or copied elsewhere. */
		guardian_contact: text("guardian_contact"),

		requested_at: timestamp("requested_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** Link lifetime; the sole basis for expiry (not a status column). */
		expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
		verified_at: timestamp("verified_at", { withTimezone: true }),
		/** When consent was confirmed; non-NULL means consent exists. */
		consented_at: timestamp("consented_at", { withTimezone: true }),
		declined_at: timestamp("declined_at", { withTimezone: true }),
		/** Withdrawal time; consent loses effect but the row stays as a record. */
		revoked_at: timestamp("revoked_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		/** Token to request. Unique because it is the guardian path's only lookup axis; duplicate hashes would make the opened request depend on ordering. */
		uniqueIndex("guardian_consent_token_idx").on(t.token_hash),
		/**
		 * One open request per member. The partial unique index is the final authority: two simultaneous
		 * requests could both close the old one and both create a new one, leaving a supposedly dead link
		 * alive.
		 */
		uniqueIndex("guardian_consent_open_idx")
			.on(t.member_id)
			.where(sql`${t.status} in ('pending', 'verified')`),
		/**
		 * One valid consent per member. Without it two consents could coexist and picking the current
		 * one would depend on ordering, making the gate flicker.
		 */
		uniqueIndex("guardian_consent_active_idx")
			.on(t.member_id)
			.where(sql`${t.consented_at} is not null and ${t.revoked_at} is null`),
		/** Member request history (status screen, account-deletion cleanup). */
		index("guardian_consent_member_idx").on(t.member_id, t.requested_at),
	],
);
