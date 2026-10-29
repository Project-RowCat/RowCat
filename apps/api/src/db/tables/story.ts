import { sql } from "drizzle-orm";
import {
	boolean,
	customType,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { member } from "./member.ts";

/** drizzle has no built-in bytea; this is the minimal Buffer-in/Buffer-out definition. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType: () => "bytea",
});

/**
 * Nullable; NULL means unspecified (same shape as `Orientation | null` in @rowcat/domain). Legacy
 * used `''`, which made "unspecified" a value and put an empty-string branch in every filter.
 */
export const orientation = pgEnum("orientation", ["female", "male", "all"]);

/**
 * The exposure state the creator chooses. It merges legacy's `is_private` and `archived` booleans,
 * which are mutually exclusive: two booleans leave an inexpressible `(private && archived)` in the
 * type and force every visibility query to check both columns. `unlisted` joined as a fourth value
 * for the same reason — a side `unlisted: boolean` would revive `(private && unlisted)`. Exposure
 * stays one state axis.
 *
 * `unlisted` means "absent from lists, opens by link". This column says what the story is, not who
 * may see it; that is the predicate's job (`galleryWhere` in `services/story/index.ts`, where the
 * discovery axis and the direct-view axis differ).
 *
 * Moderation hiding (`hidden`) is deliberately not a value here: it is the operator's axis, and
 * merging would let an unhide overwrite the creator's original choice. A hidden `unlisted` story is
 * closed even to people who hold the address.
 */
export const visibility = pgEnum("story_visibility", [
	"public",
	"unlisted",
	"private",
	"archived",
]);

export const story = pgTable(
	"story",
	{
		id: text("id").primaryKey(),
		/**
		 * Nullable; NULL means "a story whose identity was erased by account deletion". Public works are
		 * kept with identity erased. A shared "deleted member" account was rejected because every
		 * ownership path (own private view, publish idempotency, owner edit) would then treat different
		 * people's stories as one person's.
		 *
		 * `onDelete: cascade` stays on purpose: the deletion transaction first detaches the stories to
		 * keep and deletes the rest explicitly, and the cascade covers the case where a new state falls
		 * in no category. Deleting is the safer failure than leaving personal data ownerless
		 * (`services/account/deletion.ts`).
		 */
		owner: text("owner").references(() => member.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		description: text("description").notNull().default(""),
		/** The author name shown on the work; may differ from the owner account. */
		author: text("author").notNull().default(""),
		/** An array rather than legacy's CSV so a GIN index can serve tag lookups. */
		tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
		orientation: orientation("orientation"),
		adult: boolean("adult").notNull().default(false),
		visibility: visibility("visibility").notNull().default("public"),
		/** Operator hiding (moderation), independent of the creator's visibility. */
		hidden: boolean("hidden").notNull().default(false),
		/** Whether the body is prompt-protected; display badge only. */
		prompt_protected: boolean("prompt_protected").notNull().default(false),
		size_bytes: integer("size_bytes").notNull().default(0),

		/**
		 * The local draft (`StoryDraft.id` in @rowcat/authoring) that produced this story; the basis of
		 * publish idempotency. A round trip can lose only the response, leaving a story on the server
		 * that the browser never recorded; pressing publish again carries the same draft id and the
		 * unique index below rejects the second INSERT, so the server returns the existing story.
		 *
		 * Nullable because migrated rows and dev fixtures have no draft, and inventing an id would later
		 * collide with a real one. The member axis in the index matters: draft ids are device-made, so a
		 * global unique constraint would let another member block someone's publish by sending the same
		 * string first.
		 */
		origin_draft_id: text("origin_draft_id"),

		/**
		 * The playback payload a device takes when starting a conversation (scenario, characters, lore),
		 * kept as one validated versioned aggregate. The server reads and emits it whole and never
		 * queries inside it, so splitting it into tables would only add joins and migrations.
		 *
		 * Nullable: a story not yet migrated must fail acquisition explicitly (`story_play_unavailable`)
		 * rather than hand out a fake room from an empty payload. jsonb so a shape change can be surveyed
		 * in SQL (which stories are v1). Schema validation belongs to the boundary (@rowcat/contracts)
		 * and is applied again on read.
		 */
		play_payload: jsonb("play_payload"),

		/* Aggregate counters. They are derivable from the log tables but denormalized because
		 * "popular, all time" is the dominant path and counting the logs each time scales
		 * linearly with the catalogue. Only the day/week/month windows aggregate the logs. */
		/**
		 * ⚠️ Dead signal. The column, `download_log` and `recordDownload` exist, but no live path calls
		 * them, so the value is always 0 and neither popular ranking nor creator analytics reads it
		 * (`services/story/ranking.ts`). It stays only because migrated rows carry old values whose
		 * meaning cannot be re-explained, so it is neither renamed nor repurposed.
		 */
		downloads: integer("downloads").notNull().default(0),
		favorites: integer("favorites").notNull().default(0),
		views: integer("views").notNull().default(0),
		/**
		 * Cumulative play starts, derived from `story_play_log` like views: the all-time ranking and
		 * creator analytics totals read this counter, and period windows count the log. Authoritative
		 * only from when the column appeared; earlier plays were never recorded, so 0 is correct and it
		 * is not backfilled.
		 */
		play_starts: integer("play_starts").notNull().default(0),
		/**
		 * The engagement signal the popular ranking reads: distinct members who have started this story.
		 * Kept apart from `play_starts` because that counts sessions, and a session key means different
		 * things per playback mode (a local room id for chat, a library row for runtime), so adding the
		 * two at one weight biases the ranking toward chat works. People mean the same thing in both
		 * modes.
		 *
		 * Derived from `story_play_starter` and raised only in the transaction where a row is actually
		 * inserted. Account deletion only detaches identity (`set null`), so it does not decrease. The
		 * backfill came only from facts already held: identified `story_play_log` rows folded by (story,
		 * member); rows whose identity was already erased are not counted because distinctness cannot be
		 * known.
		 */
		unique_play_starters: integer("unique_play_starters").notNull().default(0),

		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/**
		 * notNull and initialized from creation time, so legacy's `''` (and every reader's fallback to
		 * created_at) is gone. Only publish and update move it. The cover does not: `story_cover.version`
		 * is its cache identity, and bumping this on a cover change would reshuffle the `updated_at desc`
		 * ordering of the published-works list for a picture swap.
		 */
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		/**
		 * The dominant path of the public gallery feed. A partial index over exposable rows only, so it
		 * stays small and serves created_at ordering directly. The owner's private view is served by
		 * idx_story_owner.
		 */
		index("idx_story_public")
			.on(t.created_at.desc())
			.where(sql`${t.hidden} = false and ${t.visibility} = 'public'`),
		// My-works list and the public profile grid.
		index("idx_story_owner").on(t.owner, t.created_at.desc()),
		/**
		 * The final authority for publish idempotency. SELECT-then-INSERT is not enough: two concurrent
		 * requests for one draft both read nothing and both insert. With the constraint the loser
		 * bounces, re-reads the winning row, and the results converge (member creation in
		 * `auth/viewer.ts` has the same shape). Partial so rows without an origin stay out of the index.
		 */
		uniqueIndex("uq_story_owner_origin_draft")
			.on(t.owner, t.origin_draft_id)
			.where(sql`${t.origin_draft_id} is not null`),
		// Tag lookup (containment operator @>).
		index("idx_story_tags").using("gin", t.tags),
		// Gallery search (title/author/description ILIKE '%q%'): a leading wildcard, so GIN pg_trgm.
		index("idx_story_title_trgm").using("gin", t.title.op("gin_trgm_ops")),
		index("idx_story_author_trgm").using("gin", t.author.op("gin_trgm_ops")),
		index("idx_story_description_trgm").using(
			"gin",
			t.description.op("gin_trgm_ops"),
		),
	],
);

/**
 * Cover bytes, split from the story row. Legacy stored a base64 data URL of up to 8MB in
 * `stories.cover_data`, which made even list queries that never select the cover drag TOAST along
 * and put megabytes of base64 into one gallery response. A separate bytea table keeps lists from
 * touching it and avoids the +33% base64 inflation.
 */
export const story_cover = pgTable("story_cover", {
	story_id: text("story_id")
		.primaryKey()
		.references(() => story.id, { onDelete: "cascade" }),
	bytes: bytea("bytes").notNull(),
	/**
	 * The actual format of the normalized stored bytes, never the request's claimed `Content-Type`.
	 * The upload boundary decodes and re-encodes into one format (`lib/cover-image.ts`); recording the
	 * client's claim would serve a JPEG labelled `image/png` and make browsers sniff bytes that
	 * disagree with the header.
	 */
	mime: text("mime").notNull(),
	/**
	 * The cover's content identity: the public URL's `?v=` and the ETag are both this value.
	 * `story.updated_at` used to be the cache buster and failed twice: atomicity (bytes and version
	 * live in two rows that a second write path would eventually desynchronize) and uniqueness (two
	 * replacements in the same millisecond would serve different bytes at the same immutable URL,
	 * cached for a year).
	 *
	 * A generated column makes both unrepresentable: the value derives from the bytes, so it changes
	 * in the same tuple and differs whenever the content differs (first 128 bits of SHA-256).
	 * Re-uploading the same picture yields the same value, which is correct. The DB computes it rather
	 * than the application so no future statement can omit it.
	 */
	version: text("version")
		.notNull()
		.generatedAlwaysAs(sql`left(encode(sha256(bytes), 'hex'), 32)`),
	/** Last write time for operations ("when was this cover uploaded"); not cache identity and never in a response. */
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * Source of truth for period popularity. The aggregate column (story.downloads) is all-time and
 * cannot answer day/week/month windows, which is the only reason this log exists, so only story_id
 * and time are kept (no who, for data minimization).
 */
export const download_log = pgTable(
	"download_log",
	{
		story_id: text("story_id")
			.notNull()
			.references(() => story.id, { onDelete: "cascade" }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("idx_download_log_story").on(t.story_id, t.created_at)],
);

/** What the device actually stood up: a chat room or a runtime session. */
export const story_play_kind = pgEnum("story_play_kind", ["chat", "runtime"]);

/**
 * One play start, reported by the device after it actually created a usable local session. It is
 * not the `/play` or `/playback` 200: that response means "the body was handed out", not "a
 * conversation began" (local storage can fail, the account can change in between), so the device
 * reports separately after local room creation (chat) or once the VM ran (runtime). Counting the
 * 200 would overstate by an unknown amount (`contracts/creator-analytics.ts`).
 *
 * The idempotency key is the device-made session identity: the room id for chat, the library row id
 * (story+slot derived) for runtime. The primary key `(story_id, session_key)` is the final
 * authority against lost-response retries, double effects and re-renders. The member is not in the
 * key so it stays unique after `member_id` is nulled by account deletion.
 *
 * `member_id` stays server-private: it serves the own-story exclusion and the entitlement check and
 * is never in creator-facing responses (analytics is aggregate, not surveillance). Deletion uses
 * `set null` so the event survives and a creator's cumulative numbers do not shrink. `session_key`
 * is a random device UUID and cannot be traced to an identity.
 */
export const story_play_log = pgTable(
	"story_play_log",
	{
		story_id: text("story_id")
			.notNull()
			.references(() => story.id, { onDelete: "cascade" }),
		member_id: text("member_id").references(() => member.id, {
			onDelete: "set null",
		}),
		session_key: text("session_key").notNull(),
		kind: story_play_kind("kind").notNull(),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.story_id, t.session_key] }),
		/** Period-window popularity and creator analytics count along this axis. */
		index("idx_story_play_log_story").on(t.story_id, t.created_at),
	],
);

/**
 * The people who have started a story, one row per story per member. `story_play_log` is the
 * session ledger and this is the people ledger; they cannot fold into one table because several
 * sessions per person are legitimate (three chat rooms for one story is a normal path) and a unique
 * constraint would make that telemetry false.
 *
 * ```text
 * story_play_log      (story, session key)   event    creator analytics' `playStarts`
 * story_play_starter  (story, member)        person   popular ranking
 * ```
 *
 * The unique index is the final authority against double counting: asking "is this the first start"
 * with a SELECT lets two concurrent requests both see nothing and both bump the counter, while with
 * the constraint the loser inserts 0 rows and the counter does not move.
 *
 * `member_id` is nullable with a partial unique index because of account deletion: `set null`
 * detaches identity only, so window counts and the counter stay put, and NULLs never equal each
 * other so several erased rows can coexist on one story.
 *
 * `first_started_at` is the person's first start, so a period window counts people who newly
 * started the story in it (the same shape as the favourite window).
 */
export const story_play_starter = pgTable(
	"story_play_starter",
	{
		story_id: text("story_id")
			.notNull()
			.references(() => story.id, { onDelete: "cascade" }),
		member_id: text("member_id").references(() => member.id, {
			onDelete: "set null",
		}),
		first_started_at: timestamp("first_started_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex("uq_story_play_starter")
			.on(t.story_id, t.member_id)
			.where(sql`${t.member_id} is not null`),
		/** Period-window popularity counts along this axis. */
		index("idx_story_play_starter_story").on(t.story_id, t.first_started_at),
	],
);

/**
 * Guards against view inflation: one count per (story, viewer, day). The primary key blocks
 * refreshes and bot repeats. The viewer key is `m:<member.id>` for members and `a:<ip+ua hash>` for
 * guests; raw IPs are never stored.
 */
export const story_view_log = pgTable(
	"story_view_log",
	{
		story_id: text("story_id")
			.notNull()
			.references(() => story.id, { onDelete: "cascade" }),
		viewer: text("viewer").notNull(),
		/** YYYY-MM-DD (UTC). */
		day: text("day").notNull(),
	},
	(t) => [primaryKey({ columns: [t.story_id, t.viewer, t.day] })],
);
