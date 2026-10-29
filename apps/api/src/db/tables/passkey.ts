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
 * Passkeys: a table owned by the Better Auth passkey plugin.
 *
 * Column names are camelCase, like the auth tables, because the adapter looks them up by that name.
 * "Tidying" them to snake_case would break registration at runtime, after the user has already
 * touched the sensor. The shape is transcribed from the plugin's `schema` declaration; do not add
 * or rename fields.
 *
 * Ownership is on the auth `user`, not `member.id`. A passkey is a way into the auth account;
 * product identity (`Viewer.id`) is a different axis derived from it, and a member id here would
 * make changing a login method touch product ownership. Deletion cascades so no ownerless
 * credential rows remain (which is also why account deletion does not enumerate this table).
 *
 * Indexes follow the plugin's real where-axes: `userId` for list and cleanup, `credentialID` on
 * every authentication ceremony. `credentialID` is not unique because the plugin does not declare
 * it so; a stronger constraint would turn the plugin's `PREVIOUSLY_REGISTERED` failure into a
 * driver uniqueness 500.
 */
export const passkey = pgTable(
	"passkey",
	{
		id: text("id").primaryKey(),
		/** User-chosen label, not a device name. May be absent; the screen then says `passkeys`. */
		name: text("name"),
		/** Base64 public key. Never sent in any response. */
		publicKey: text("publicKey").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** Credential id issued by the authenticator. Never sent in any response. */
		credentialID: text("credentialID").notNull(),
		/** Signature counter. Stays 0 when the authenticator does not use it; that is normal. */
		counter: integer("counter").notNull(),
		deviceType: text("deviceType").notNull(),
		backedUp: boolean("backedUp").notNull(),
		/** Comma-joined transports. Not shown on screen. */
		transports: text("transports"),
		createdAt: timestamp("createdAt", { withTimezone: true }),
		/**
		 * Authenticator model identifier. Identifies neither device nor person, and privacy-preserving
		 * platforms fill it with zeros; a display hint only, never shown as-is.
		 */
		aaguid: text("aaguid"),
	},
	(t) => [
		index("passkey_userId_idx").on(t.userId),
		index("passkey_credentialID_idx").on(t.credentialID),
	],
);
