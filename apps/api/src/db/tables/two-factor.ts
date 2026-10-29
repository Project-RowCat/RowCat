import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * Owned by the Better Auth two-factor plugin. As with passkeys (`passkey.ts`), the shape comes from
 * the plugin's schema declaration (`schema` in `better-auth/plugins/two-factor`) and the camelCase
 * column names are what the adapter looks up; do not add or rename fields.
 *
 * ```text
 * secret        the authenticator's TOTP secret   encrypted with the server secret (BETTER_AUTH_SECRET)
 * backupCodes   ten backup codes                  encrypted JSON with the same key; plaintext exists only in the issuing response
 * verified      setup confirmed                   false until the first authenticator code is entered
 * ```
 *
 * Neither secret is returned again by any response (the plugin declares `returned: false`, and
 * `viewBackupCodes` is serverOnly with no HTTP surface), so our routes never read these rows; the
 * account screen knows only the `user.twoFactorEnabled` boolean.
 *
 * Owned by the auth user and deleted by cascade, as with passkeys, so account deletion does not
 * enumerate this table (`services/account/deletion.ts`).
 */
export const twoFactor = pgTable(
	"twoFactor",
	{
		id: text("id").primaryKey(),
		secret: text("secret").notNull(),
		backupCodes: text("backupCodes").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		verified: boolean("verified").default(true),
		/** Consecutive failures in the sign-in challenge, the basis of lockout; written by the plugin only. */
		failedVerificationCount: integer("failedVerificationCount").default(0),
		lockedUntil: timestamp("lockedUntil", { withTimezone: true }),
	},
	(t) => [
		index("twoFactor_userId_idx").on(t.userId),
		index("twoFactor_secret_idx").on(t.secret),
	],
);
