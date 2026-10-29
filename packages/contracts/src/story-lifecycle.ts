import { z } from "zod";
import { StoryDto } from "./gallery.ts";

/**
 * Story lifecycle: moving an already published story between exposure states. It is not publishing
 * (publication.ts), which replaces the authored snapshot. Lifecycle never touches authored content,
 * so these requests have no body. The path names the story, and the action name says where it goes.
 *
 * There is no general PATCH { visibility }. That shape could express every vocabulary value as a
 * target, so forbidden transitions such as archived -> public would become expressible requests
 * that only a server branch could block. Named actions make them impossible to express.
 *
 * Allowed transitions:
 * - private or unlisted -> public (publish)
 * - private or public -> unlisted (unlist)
 * - public or unlisted -> private (unpublish)
 * - private, unlisted, or public -> archived (archive)
 * - archived -> private (restore; returns to private, not public)
 *
 * archived -> public and archived -> unlisted are absent on purpose. Archiving is a decision not to
 * publish for now. Undoing it and publishing again are two decisions, so one press must not do
 * both. Restore has one destination, and widening exposure is an explicit second action.
 *
 * `unlist` is the fifth action rather than a destination value, for the same reason: each added
 * value makes more forbidden transitions expressible.
 *
 * Not here: operator hiding (hidden). Another actor sets it (/v2/moderation/actions), and if
 * producer actions could toggle it, publishing could undo a moderation decision. Deletion is also
 * absent: archiving takes a story down rather than deleting it.
 */

/**
 * Named by operation, not by destination. A destination vocabulary would merge transitions that
 * land on the same value (unpublishing and restoring from archive are different acts), and the
 * screen would have to recheck reachability on every use. The SDK, query cache, and screen share
 * this list because each action evicts different cache entries. Only public stays in the discovery
 * surfaces.
 */
export const STORY_LIFECYCLE_ACTIONS = [
	"publish",
	"unlist",
	"unpublish",
	"archive",
	"restore",
] as const;
export const StoryLifecycleAction = z.enum(STORY_LIFECYCLE_ACTIONS);
export type StoryLifecycleAction = z.infer<typeof StoryLifecycleAction>;

/**
 * The story after the change, in the same shape as the cover write response. It is not a single
 * axis such as { visibility: "archived" }, because the screen would then build its own cache from
 * it. The server knows what changed. It is the public projection (StoryDto), not the owner
 * projection. It cannot rebuild a row in the `Published works` list, which has originDraftId and hidden, so
 * the cache policy invalidates that list instead (@rowcat/query).
 */
export const StoryLifecycleResponse = z.object({ story: StoryDto });
export type StoryLifecycleResponse = z.infer<typeof StoryLifecycleResponse>;

/**
 * Only forbidden transitions get a name here. Missing and other people's stories are not here: both
 * return the same 404, which hides existence. Successful retries are not here either. All four
 * actions treat a request for the state already in effect as success, because an error on a retry
 * after a lost response would show a failure for a state that is already true. The two codes below
 * are for requests that move to a different state.
 */
export const STORY_LIFECYCLE_ERROR_CODE = {
	/**
	 * The story is archived, so publish, public, link-share, and private transitions are rejected. The
	 * server never restores silently. Leaving archive is the creator's explicit decision, and if it
	 * happened as a side effect, the creator would not know when a withdrawn work came back. The
	 * screen can point to `Restore` when it sees this code.
	 */
	archived: "story_archived",
	/**
	 * Restore was requested for a story that is not archived. This comes back only for public or
	 * unlisted stories. Restoring a private story is a success, because the wanted state already
	 * holds. A publicly open work is not quietly set to private, since that would reduce exposure
	 * without being asked. That operation has its own action (unpublish).
	 */
	notArchived: "story_not_archived",
} as const;
export type StoryLifecycleErrorCode =
	(typeof STORY_LIFECYCLE_ERROR_CODE)[keyof typeof STORY_LIFECYCLE_ERROR_CODE];
