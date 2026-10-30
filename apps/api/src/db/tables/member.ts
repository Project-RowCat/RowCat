import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
	boolean,
	date,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { media } from "./media.ts";

/**
 * Product member: 1:1 with the auth account (`user`) but a separate table. `user` is owned by
 * Better Auth, so our columns there would collide with adapter upgrades, and swapping auth would
 * take product data with it. Every ownership FK (story.owner etc.) references this `id`.
 *
 * Legacy's triple identity (code PK + unique id + public_id) is folded into one; a short public
 * address can be added as a column when needed.
 */
export const member = pgTable(
	"member",
	{
		id: text("id").primaryKey(),
		/** Auth identity. Deleting the account deletes the member (account deletion = data deletion). */
		user_id: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		nickname: text("nickname").notNull().default(""),
		/** approved | suspended | banned; the leading gate on write paths. */
		status: text("status").notNull().default("approved"),
		/**
		 * Operations role: user | staff | admin, owned by the product. It lives here rather than on
		 * Better Auth's `user` because adapter-owned tables can silently lose or rename product
		 * authorization columns on upgrade. Default is `user`: promotion is done by seed/ops scripts
		 * writing this column directly, since any role patch under `/me` would let anyone make themselves
		 * an operator. The one product route that writes it is first-run setup, which grants `admin` once
		 * per deployment to whoever holds the code from the API's log (`services/setup/`). A separate axis
		 * from `status`: a suspended operator
		 * cannot use the console (the gate checks both) but keeps the role.
		 */
		role: text("role").notNull().default("user"),

		// Adult gate axes: not merged because different parties decide them. verified/adult come from the
		// identity provider, show_adult is the user's own opt-in. Merging could not express "verified but
		// display off", which decides the gallery's 403 reason.
		/** Identity verification completed. */
		verified: boolean("verified").notNull().default(false),
		/** 19 or older. */
		adult: boolean("adult").notNull().default(false),
		/** Adult content display opt-in, off by default; only a verified adult can turn it on, and only on the web. */
		show_adult: boolean("show_adult").notNull().default(false),

		/**
		 * On the managed-generation allowlist; off by default. Managed generation runs unmetered on the
		 * operator's provider key; in allowlist mode (`MANAGED_GENERATION_ACCESS=allowlist`, the default)
		 * only members with this set, plus staff/admin, may use it. Decided in
		 * `services/generation/access.ts`, and changed only by one admin console action (audited).
		 * Default false is the safeguard: true would hand the key to every existing member when the
		 * column is added.
		 */
		managed_generation_allowed: boolean("managed_generation_allowed")
			.notNull()
			.default(false),

		// Age band, a different axis from the adult three (19, and the display setting). 14 is the
		// boundary where the Korean Personal Information Protection Act art. 22-2 requires guardian consent. Folding the two would give a
		// 15-year-old adult entitlement, or make verified adults special here too. There is no birth-date
		// column: the received value is folded into the two columns below and discarded
		// (`docs/membership/ARCHITECTURE.md`).
		/**
		 * `unknown | child | standard`. Default `unknown` is the safeguard: defaulting to `standard`
		 * would make the migration declare every existing member 14 or older, which we never verified.
		 * The entry gate clears the unknown state (`resolveMembershipGate`).
		 */
		age_status: text("age_status").notNull().default("unknown"),
		/**
		 * Date the member turns 14; filled only when `age_status = 'child'`. The only age information the
		 * server stores, needed to decide the transition. The transition is a predicate
		 * (`resolveAgeStatus`), not a batch, so a stopped sweep never leaves a past-birthday member a
		 * child. `date` rather than `timestamp` because the decision is a calendar date in the product
		 * timezone.
		 */
		age_threshold_date: date("age_threshold_date"),
		/** When the server recorded the age; NULL if never reported. A legal-state transition, so the time is the server's; a client timestamp would not be evidence. */
		age_recorded_at: timestamp("age_recorded_at", { withTimezone: true }),

		/**
		 * Current avatar media; the source of truth for the profile image. A record rather than a URL
		 * string because a string has no ownership and cannot distinguish an arbitrary remote address
		 * from bytes we validated (see `db/tables/media.ts`). `set null` is half the replace/delete
		 * discipline: a vanished media row empties the pointer, so a member pointing at missing media is
		 * unrepresentable and the profile falls back to the default avatar. Not cascade, since one
		 * picture must not delete a member. Null means no avatar; no fake default media row is created
		 * (the screen draws the default).
		 */
		/** The `: AnyPgColumn` return annotation is required: `member` and `media` reference each other, and TypeScript otherwise loops inferring both types (TS7022/TS7024). Runtime behaviour is unaffected (the FK is still generated). */
		avatar_media_id: text("avatar_media_id").references(
			(): AnyPgColumn => media.id,
			{ onDelete: "set null" },
		),
		/**
		 * Legacy avatar address, read-only; no new writes. Nothing writes it (there was no upload
		 * pipeline), so every row here is `""` today, but it is kept because what this code knows and
		 * what the database holds may differ (ops migrations, manual backfills, unreleased branches), and
		 * a drop migration would silently destroy them. Projections check media first and fall back to
		 * this (`avatarUrlOf` in `services/account/profile.ts`); drop the column only after a query
		 * confirms it is empty.
		 */
		avatar_url: text("avatar_url").notNull().default(""),
		bio: text("bio").notNull().default(""),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		/** Session to member resolution, hit on every authenticated request; unique (one member per account). */
		uniqueIndex("member_user_id_idx").on(t.user_id),
		/** Creator nickname substring search (gallery q). A leading wildcard cannot use btree, so GIN pg_trgm. */
		index("member_nickname_trgm_idx").using(
			"gin",
			t.nickname.op("gin_trgm_ops"),
		),
	],
);
