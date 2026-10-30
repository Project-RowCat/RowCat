import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { member } from "./member.ts";

/**
 * First-run setup: one row per deployment (`services/setup/index.ts`).
 *
 * The row holds a salt, not a code. The code is `HMAC(BETTER_AUTH_SECRET, salt)`, so every replica
 * and every restart prints the same one without the plaintext being stored anywhere, and neither a
 * leaked database nor the session secret alone is enough to compute it. Storing a random code
 * instead would leave each replica printing a different value and only the last one working.
 *
 * `completed_at` is the whole lifecycle. Setup is open only while it is NULL; once set, nothing in
 * the product resets it. A deployment that loses its last admin recovers through the database
 * (`DELETE FROM deployment_setup` and a restart opens setup again with a new salt), the same
 * authority the claim itself stands in for.
 */
export const deployment_setup = pgTable("deployment_setup", {
	/** Always `deployment`. A fixed key makes "the row" a primary-key lookup and a second row unrepresentable. */
	id: text("id").primaryKey(),
	salt: text("salt").notNull(),
	created_at: timestamp("created_at", { withTimezone: true, precision: 3 })
		.notNull()
		.defaultNow(),
	completed_at: timestamp("completed_at", {
		withTimezone: true,
		precision: 3,
	}),
	/**
	 * Who claimed it; NULL when an existing admin closed it at boot, or after that member deleted their
	 * account. The audit record of the claim is `admin_audit_log`; this column is not authority.
	 */
	completed_by: text("completed_by").references(() => member.id, {
		onDelete: "set null",
	}),
	/**
	 * The member a browser on this computer is signed in as without a password, when setup was claimed
	 * with "use without signing in" (`services/setup/local-owner.ts`). NULL means this deployment has
	 * no such member and the local sign-in door answers 404.
	 *
	 * Written in the claim's transaction and never by anything else, so the choice cannot be made
	 * later on a deployment that already has members. `set null` because deleting that account ends
	 * the arrangement rather than the setup record.
	 */
	local_owner_id: text("local_owner_id").references(() => member.id, {
		onDelete: "set null",
	}),
});
