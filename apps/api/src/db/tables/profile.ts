import { PROFILE_PINNED_STORY_LIMIT } from "@rowcat/contracts";
import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import { member } from "./member.ts";
import { story } from "./story.ts";

/**
 * Pinned works at the top of a public profile, at most three per member
 * (`PROFILE_PINNED_STORY_LIMIT`).
 *
 * Not an array column on `member`: the database cannot remove a deleted work's id from an array, so
 * screens would filter "missing pins" and one missed filter puts a 404 card at the top of a
 * profile. Rows let the `story_id` cascade do it, and `member` is a hot row on the auth path.
 *
 * What removes a row:
 *
 * ```text
 * story deletion (operator tool)   story_id cascade
 * account deletion                 member_id cascade; surviving public works stay, unpinned
 * visibility transition            not removed; republishing returns it to its slot
 * operator owner detachment        not removed; the read predicate requires `story.owner = member_id`,
 *                                  so the row never surfaces and the next pin write replaces it
 * ```
 *
 * The third line is intended: the lifecycle service touches only `story.visibility`, and deleting a
 * pin there would break that rule. Public reads go through `galleryWhere` and drop pins that are
 * not visible now.
 *
 * `position` is the 0-based display order. Writes always replace the whole list in one transaction,
 * so gaps do not appear. The unique `(member_id, position)` constraint is the final authority, and
 * the check constraint repeats the cap in case another write path appears.
 */
export const profile_pinned_story = pgTable(
	"profile_pinned_story",
	{
		member_id: text("member_id")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		story_id: text("story_id")
			.notNull()
			.references(() => story.id, { onDelete: "cascade" }),
		position: integer("position").notNull(),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.member_id, t.story_id] }),
		unique("uq_profile_pinned_story_position").on(t.member_id, t.position),
		// Reads lead with member (PK), but the cascade on story deletion finds rows by `story_id`. One
		// account deletion removes several private works, so without this each would scan the table.
		index("idx_profile_pinned_story_story").on(t.story_id),
		// The contract constant is inlined with `sql.raw` because DDL has no bind parameters, so raising
		// the constant also needs a migration.
		check(
			"ck_profile_pinned_story_position",
			sql`${t.position} >= 0 and ${t.position} < ${sql.raw(String(PROFILE_PINNED_STORY_LIMIT))}`,
		),
	],
);
