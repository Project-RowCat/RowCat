import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { member } from "./member.ts";
import { story } from "./story.ts";

/**
 * A story comment: one line of public discussion. Replies are rows of this table too.
 *
 * The only user-authored content whose plaintext the server holds (conversations and drafts are
 * ciphertext, see @rowcat/sync), so it lives in neither IndexedDB nor the sync codec registry.
 *
 * Replies are not a second table: they need the same author, body, report, delete and reaction
 * rules, and two copies would let one drift loose unnoticed. The one-level thread rule is enforced
 * by the service's predicate (the parent must be top-level), not a column; a stored `depth` could
 * disagree with `parent_id`.
 *
 * ```text
 * story_id   cascade    deleting the story deletes its discussion
 * author     set null   the row may outlive the member; it is then a tombstone
 * parent_id  no action  a comment with replies cannot be deleted (checked at statement end)
 * ```
 *
 * `author` is `set null`, not cascade: physically deleting a top-level comment that has replies
 * would delete other people's replies. Only in that case the row stays with content and identity
 * erased (a tombstone), and a leftover is then a structural line nobody points at, not identifiable
 * personal data. Account deletion handles these rows explicitly (`services/account/deletion.ts`)
 * rather than leaning on cascade.
 *
 * `parent_id` is not cascade (the most important line here): cascade would turn deleting one's own
 * comment into deleting everyone else's replies, and `set null` would promote replies to top level.
 * `no action` is checked at statement end:
 *
 * ```text
 * delete a top-level comment that still has replies   fails, the database blocks it
 * story-delete cascade (parent and children together)  passes
 * ```
 *
 * Code that skips the tombstone path fails loudly instead of silently deleting others' writing.
 * `restrict` would check per row and block the story-delete cascade.
 *
 * No nickname/avatar snapshot is stored (a renamed author's old comments would keep the old name,
 * and one more personal identifier would need deleting); reads join `member`. Tombstones keep no
 * snapshot either (`deleted_body` and the like do not exist); the operator-deletion audit snapshot
 * belongs to `moderation_action`.
 *
 * There is no `updated_at`: V1 has no editing, and an always-equal column suggests an "edited"
 * state. `deleted_at` answers "is this row a tombstone now", not "when did it change".
 */
export const story_comment = pgTable(
	"story_comment",
	{
		id: text("id").primaryKey(),
		story_id: text("story_id")
			.notNull()
			.references(() => story.id, { onDelete: "cascade" }),
		/**
		 * Parent comment; null means top-level. Self-referencing, so drizzle cannot infer the return type
		 * and `AnyPgColumn` is explicit. The one-level rule is not an FK (and a trigger would escape the
		 * application's error vocabulary as a 500); the service locks the parent and checks it.
		 */
		parent_id: text("parent_id").references(
			(): AnyPgColumn => story_comment.id,
		),
		/** Author member id, filled from the session only. NULL means tombstone (always together with `deleted_at`). */
		author: text("author").references(() => member.id, {
			onDelete: "set null",
		}),
		/** Empty string on a tombstone: the original is erased, not moved to another column. */
		body: text("body").notNull(),

		/**
		 * Deletion time; non-NULL means tombstone. A timestamp rather than a boolean because the time is
		 * needed for operator inquiries and could not be backfilled later. A row with this set always has
		 * `author IS NULL` and `body = ''`; the single UPDATE in `services/comments.ts` writes all three.
		 */
		deleted_at: timestamp("deleted_at", {
			withTimezone: true,
			precision: 3,
		}),

		/**
		 * Millisecond precision on purpose. The cursor `(created_at, id)` passes through a JS `Date`, so
		 * a microsecond column would truncate the cursor and the next page's comparison would return the
		 * boundary row again. Reply lists use the same cursor.
		 */
		created_at: timestamp("created_at", { withTimezone: true, precision: 3 })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		/**
		 * Dominant path: top-level comments of a story, oldest first, after the cursor. The sort keys
		 * must match the index order, and `id` breaks ties within one millisecond. Partial index
		 * (top-level only) so replies never grow it.
		 */
		index("idx_story_comment_timeline")
			.on(t.story_id, t.created_at, t.id)
			.where(sql`${t.parent_id} is null`),
		/** Reply path: replies of a comment, oldest first. The reply-count aggregate (`parent_id in (…) group by`) uses it too. */
		index("idx_story_comment_replies").on(t.parent_id, t.created_at, t.id),
		/** Member axis for account-deletion cleanup and the write-rate check; `created_at` lets "last N seconds" be answered from the index. */
		index("idx_story_comment_author").on(t.author, t.created_at),
	],
);

/**
 * A comment reaction: one kind per member per comment.
 *
 * A table rather than a counter column (concurrent presses drift with no ledger to reconcile) or an
 * array (viewer lookups read the whole row and concurrent updates overwrite each other). The unique
 * constraint is the final authority, so a burst of presses ends as no-op inserts. Counts are read
 * at read time (`comment_id in (…) group by comment_id`, via the primary key); add a counter only
 * when profiling points here.
 *
 * `kind` is open in storage but the product vocabulary is exactly one
 * (`STORY_COMMENT_REACTION_KINDS`); the path narrows it, and it is text to avoid enum migrations
 * (same as `notification.kind`).
 *
 * Both FKs cascade, but a tombstone keeps its row, so the tombstoning service deletes that
 * comment's reactions explicitly (otherwise a tombstone would carry a like count).
 */
export const story_comment_reaction = pgTable(
	"story_comment_reaction",
	{
		comment_id: text("comment_id")
			.notNull()
			.references(() => story_comment.id, { onDelete: "cascade" }),
		member_id: text("member_id")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		/** Public vocabulary is `like` only (the contract owns the list). */
		kind: text("kind").notNull(),
		created_at: timestamp("created_at", { withTimezone: true, precision: 3 })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		/**
		 * Unique constraint and dominant index at once. `comment_id` first serves "reactions of these
		 * comments"; `member_id` next answers "did this viewer press" in the same index. No surrogate
		 * `id`: it would allow duplicate (comment, member, kind) rows.
		 */
		primaryKey({ columns: [t.comment_id, t.member_id, t.kind] }),
		/** Member axis for account-deletion cleanup; the primary key leads with `comment_id` and cannot serve it. */
		index("idx_story_comment_reaction_member").on(t.member_id),
	],
);
