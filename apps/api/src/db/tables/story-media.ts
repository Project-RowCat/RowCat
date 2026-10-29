import { index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { media } from "./media.ts";
import { story } from "./story.ts";

/**
 * Which media a published story depends on, recorded outside the JSON.
 *
 * `story.play_payload`'s `sceneImages[*].assetId` is a reference the database did not know as one.
 * When a creator deleted their account, the work and payload survived (`story.owner = null`) but
 * the image's media row cascaded away, so the work opened with its text and a 404 where the picture
 * was.
 *
 * Two shorter fixes were rejected:
 * - Keeping every scene image of a deleted creator (dropping `kind <> 'scene_image'` from
 *   deletion cleanup) also keeps images nothing points at (draft-only, removed in a later version,
 *   uploaded and never used), selling the "erase this account's traces" promise to one kind name.
 * - Having deletion parse `play_payload` makes the deletion path know the snapshot's shape; when
 *   the contract changes the parser silently returns an empty list and viewers lose pictures. As a
 *   relation the answer is a query, which breaks at compile or constraint level when the schema
 *   moves.
 *
 * The two FKs have different delete policies; the second is this table's invariant:
 *
 * ```text
 * story_id -> cascade    a reference is a property of the story
 * media_id -> restrict   media with a live reference cannot be deleted
 * ```
 *
 * A media-deleting path that misses a reference makes the whole transaction bounce, which is better
 * than a surviving work silently losing its picture, and tests see it before deployment.
 *
 * The key is `(story_id, media_id, role)`: a story references several images, one image can serve
 * several stories (one story going away must not release media another still uses), and the same
 * pair twice means nothing. `role` is `scene_image` or `runtime_asset`; it was keyed from the
 * start, so managed runtime images, which let the same media serve one story in different roles,
 * needed a new value instead of a migration.
 *
 * Callers split on role: publication sync must delete only its own role (otherwise a runtime
 * publication removes the same story's scene-image dependencies), while the retention query ignores
 * role because it asks "who still uses this media".
 *
 * Not here: draft references (drafts are device-owned and unknown to the server, so draft-only
 * images are still removed by account deletion), order, triggers and coordinates (the snapshot's),
 * and the owner (`media.owner` holds it). The one question this table answers is whether the story
 * stands without this media.
 */
export const story_media = pgTable(
	"story_media",
	{
		story_id: text("story_id")
			.notNull()
			.references(() => story.id, { onDelete: "cascade" }),
		media_id: text("media_id")
			.notNull()
			.references(() => media.id, { onDelete: "restrict" }),
		/** What the media does in this story: `scene_image` or `runtime_asset`. */
		role: text("role").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.story_id, t.media_id, t.role] }),
		// Reverse axis, "who still uses this media". Account deletion asks exactly this when picking
		// media to keep; without the index deleting one member scans this table.
		index("idx_story_media_media").on(t.media_id),
	],
);
