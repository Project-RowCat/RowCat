import {
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { member } from "./member.ts";
import { story } from "./story.ts";

/**
 * Favorites. The (story, member) pair is one entry, so the PK gives idempotency for free; a
 * separate id column would allow the same person to save a work twice and drift the counter.
 */
export const favorite = pgTable(
	"favorite",
	{
		story_id: text("story_id")
			.notNull()
			.references(() => story.id, { onDelete: "cascade" }),
		member_id: text("member_id")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.member_id, t.story_id] }),
		// The PK leads with member because "my favorites" is more frequent; this is the opposite axis.
		// Period popularity narrows a time range per story, which the PK cannot do (it becomes a scan on
		// popular works).
		index("idx_favorite_story").on(t.story_id, t.created_at),
	],
);

/** Follow (follower -> creator). Both axes are queried: my following feed and the other side's follower count. */
export const follow = pgTable(
	"follow",
	{
		follower: text("follower")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		creator: text("creator")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.follower, t.creator] }),
		// Follower count: the PK leads with follower and cannot serve a creator-only filter.
		index("idx_follow_creator").on(t.creator),
	],
);

/** Block: hides a blocked creator's works on every gallery path (UGC safety net). */
export const block = pgTable(
	"block",
	{
		blocker: text("blocker")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		creator: text("creator")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	// Lookups are always "who I blocked", so the PK is enough.
	(t) => [primaryKey({ columns: [t.blocker, t.creator] })],
);
