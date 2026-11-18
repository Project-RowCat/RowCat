import {
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * Owned by the Better Auth device-authorization plugin (`auth/device-authorization.ts`): one row per
 * "sign this tool in" request (`@rowcat/contracts`' `device-authorization.ts` has the flow). As with
 * passkeys and two-factor, the shape is transcribed from the plugin's `schema` declaration and the
 * camelCase column names are what the adapter looks up; do not add or rename fields.
 *
 * ```text
 * deviceCode       the secret the tool polls with          40 random characters, never shown to a person
 * userCode         the code a person compares               8 characters from the contract's alphabet
 * userId           the account that opened the request      null until a signed-in person opens the page
 * status           pending → approved | denied
 * expiresAt        issue + 10 minutes
 * lastPolledAt · pollingInterval   the plugin's `slow_down` bookkeeping
 * clientId         `rowcat-mcp` — the only value the plugin accepts
 * scope            always empty (the request refuses one); the plugin writes the column regardless
 * ```
 *
 * A row is consumed when its session is issued and deleted when a poll finds it expired or denied. A
 * request nobody polls after it expires is left to the retention job (`auth.device-code`).
 *
 * `userId` references the auth user with cascade, as passkeys and two-factor rows do, so deleting an
 * account removes a request it opened instead of leaving one that redeems into a missing user. The
 * plugin declares no reference; the constraint changes no write it makes, because it only ever writes
 * the id of the session that is looking at the request.
 *
 * Both codes are unique because both are lookup keys (the tool polls by `deviceCode`, the page reads by
 * `userCode`); the plugin retries issuance on a uniqueness failure.
 */
export const deviceCode = pgTable(
	"deviceCode",
	{
		id: text("id").primaryKey(),
		deviceCode: text("deviceCode").notNull(),
		userCode: text("userCode").notNull(),
		userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
		expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
		status: text("status").notNull(),
		lastPolledAt: timestamp("lastPolledAt", { withTimezone: true }),
		pollingInterval: integer("pollingInterval"),
		clientId: text("clientId"),
		scope: text("scope"),
	},
	(t) => [
		uniqueIndex("deviceCode_deviceCode_idx").on(t.deviceCode),
		uniqueIndex("deviceCode_userCode_idx").on(t.userCode),
	],
);
