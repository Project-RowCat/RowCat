import {
	boolean,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Better Auth owned tables. The camelCase column names are what the adapter looks up; renaming them
 * to snake_case breaks sign-in silently at runtime.
 *
 * Indexes follow the where axes Better Auth's adapter actually uses (not the id PK); without them
 * every auth path is a sequential scan. They are unique because this is a fresh DB with no
 * duplicate rows to tolerate.
 */
export const user = pgTable(
	"user",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull(),
		emailVerified: boolean("emailVerified").notNull().default(false),
		image: text("image"),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
		/**
		 * Field of the two-factor plugin (`two-factor.ts`). Becomes true only once the first
		 * authenticator code verifies, so quitting setup midway never locks the account.
		 */
		twoFactorEnabled: boolean("twoFactorEnabled").default(false),
	},
	(t) => [uniqueIndex("user_email_idx").on(t.email)],
);

export const session = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
		ipAddress: text("ipAddress"),
		userAgent: text("userAgent"),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
	},
	(t) => [
		// Hit on every authenticated request (findSession).
		uniqueIndex("session_token_idx").on(t.token),
		// Per-account session revocation.
		index("session_userId_idx").on(t.userId),
	],
);

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("accountId").notNull(),
		providerId: text("providerId").notNull(),
		/**
		 * Issuer namespace of the auth method; the axis Better Auth looks accounts up by
		 * (`local:credential`, `local:oauth:google`). Unlike providerId it carries the namespace the
		 * label belongs to, so a social provider and an internal method with the same id stay separate
		 * accounts.
		 */
		issuer: text("issuer").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("accessToken"),
		refreshToken: text("refreshToken"),
		idToken: text("idToken"),
		accessTokenExpiresAt: timestamp("accessTokenExpiresAt", {
			withTimezone: true,
		}),
		refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", {
			withTimezone: true,
		}),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
	},
	(t) => [
		// Account resolution on every sign-in. Keyed on issuer, not providerId: Better Auth 1.7's adapter
		// looks accounts up by issuer, so a providerId index would go unused.
		uniqueIndex("account_issuer_idx").on(t.issuer, t.accountId),
		index("account_userId_idx").on(t.userId),
	],
);

export const verification = pgTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
		createdAt: timestamp("createdAt", { withTimezone: true }),
		updatedAt: timestamp("updatedAt", { withTimezone: true }),
	},
	(t) => [index("verification_identifier_idx").on(t.identifier)],
);
