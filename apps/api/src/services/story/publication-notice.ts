import type { StoryVisibility } from "@rowcat/domain";
import {
	notificationSourceKey,
	notifyFollowersOfSocialEvent,
} from "../notifications.ts";
import type { Tx } from "./index.ts";

/**
 * New-public-story notification for a creator's audience.
 *
 * Comments here avoid the relation-table vocabulary on purpose: `publication-notice.test.ts` scans
 * this file's source to prove it never touches those tables.
 *
 * Three paths make a story public, in different files: `publishStory` and `updatePublishedStory`
 * (`services/story/publication.ts`) and `publishStoryPublicly` (`services/story/lifecycle.ts`).
 * Writing the "first time public" decision in three places would eventually miss one with no
 * symptom, so the rule is one pure function (`enteredPublicVisibility`) and callers only pass both
 * ends of the transition. Notifying on every update would be worse: editing an already public story
 * would reach people who joined the audience since as a "new story".
 *
 * Deliberately excluded:
 * - Choosing recipients. Who is in the audience, exclusions and already-received are answered
 *   inside the ledger's set INSERT (`notifyFollowersOfSocialEvent`); filtering here would pass the
 *   recipient list through application memory and duplicate the exclusion predicate.
 * - Sending outward. The push delivery row is an INSERT in the same transaction; the Expo call
 *   belongs to post-commit work.
 * - Undoing. A rolled-back publish rolls the notification back too, which is why callers pass
 *   `Tx`.
 */

/**
 * Whether this operation put the story into the public state for the first time.
 *
 * `before` null means the row did not exist yet (first publication); it is kept distinct from
 * "private" so a reader can see what the caller passed.
 *
 * The test is not `after === "public"` alone because republishing an already public story is a
 * normal path. The ledger's idempotency stops a second row for existing recipients, but nothing
 * would stop a month-old story reaching someone who joined the audience since. `unlisted` and
 * `archived` are not destinations: neither means "a new story is out".
 */
export function enteredPublicVisibility(
	before: StoryVisibility | null,
	after: StoryVisibility,
): boolean {
	return after === "public" && before !== "public";
}

export interface NewPublicStoryNotice {
	storyId: string;
	/** Story owner = the notification's target creator; resolved from the session, not carried by the request. */
	creatorId: string;
	/** Visibility before this operation; null if the row did not exist. */
	before: StoryVisibility | null;
	after: StoryVisibility;
}

/**
 * Writes one notification per recipient when the story became public for the first time; otherwise
 * nothing (returns 0), so every publishing path can call it unconditionally.
 *
 * The return value is the number of rows created, for logs and tests. It is never put in a
 * response: how many people received it is an operational value, not the publisher's.
 */
export async function notifyFollowersOfNewPublicStory(
	tx: Tx,
	notice: NewPublicStoryNotice,
): Promise<number> {
	if (!enteredPublicVisibility(notice.before, notice.after)) return 0;
	return notifyFollowersOfSocialEvent(tx, {
		actorId: notice.creatorId,
		kind: "creator_story_published",
		sourceKey: notificationSourceKey.storyPublished(notice.storyId),
		storyId: notice.storyId,
	});
}
