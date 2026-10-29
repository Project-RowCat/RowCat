import { STORY_COMMENT_ERROR_CODE } from "@rowcat/contracts";
import { isStoryDirectlyViewable, type Story } from "@rowcat/domain";
import type { Context } from "hono";
import type { AppEnv } from "../../app.ts";
import type { Viewer } from "../../auth/viewer.ts";
import { ApiError, notFound } from "../../lib/errors.ts";
import { canViewAdult, isAdultVerified } from "../../lib/gates.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { listBlocked } from "../../services/social.ts";
import { getStory } from "../../services/story/index.ts";

/**
 * The exposure axis shared by every single-story path (detail, playback, cover, view log,
 * comments). It was lifted out of the route files when comments became the fourth consumer; a
 * hand-copied selector goes unnoticed when only one copy loosens (a cover route missing the adult
 * gate leaks covers by id alone).
 */
export async function lookupSelector(c: Context<AppEnv>): Promise<{
	viewer: Viewer | null;
	selector: Omit<
		Parameters<typeof getStory>[1],
		"favoritedBy" | "followingOf" | "creatorId"
	>;
}> {
	const viewer = await getViewer(c);
	return {
		viewer,
		selector: {
			orientation: null,
			adult: null,
			search: "",
			tag: null,
			viewerId: viewer?.id ?? null,
			/**
			 * The owner's own private story opens on single-story paths (including re-reading right after
			 * publishing). The only place this is false is the public profile grid (`routes/creators.ts`).
			 */
			ownPrivateVisible: true,
			/**
			 * Unlisted stories open here. This is where the discovery/viewing split lives: discovery
			 * surfaces (the list in `routes/stories/index.ts`, the profile grid in `routes/creators.ts`)
			 * pass false and never meet unlisted stories, while single-story paths open them exactly like
			 * public ones (detail, cover, comments, reports, playback refusal).
			 *
			 * Ownership is deliberately not asked: unlisted means "not in the list", not "owner only".
			 * Pairing it with `viewerId` would make it a second name for private.
			 */
			unlistedVisible: true,
			adultAllowed: canViewAdult(viewer),
			/**
			 * Own adult work opens regardless of the display opt-in, judged on the same axis as publishing
			 * eligibility (`isAdultVerified`). Without it, a verified member with display off could publish
			 * adult work and then get a 404 opening or playing it.
			 */
			ownAdultAllowed: isAdultVerified(viewer),
			blocked: viewer ? await listBlocked(viewer.id) : [],
		},
	};
}

/**
 * The single door for the comment boundary. Two checks, in this order:
 *
 * 1. Is the story visible to this viewer — the exact predicate the detail uses (`getStory`).
 *    Private, archived, operator-hidden, blocked and adult-gated stories give `null` and a 404. 403
 *    and 404 are not split, or the response would reveal that the story exists.
 * 2. Is it directly viewable by address — visible and "public discussion makes sense" are
 *    different questions. A private story is visible to its owner, but public comments on text only
 *    they can see is a meaningless state.
 *
 * Blocking acts on two axes here. A story by a blocked creator 404s at step 1; what remains is a
 * blocked member's comment on a visible story, which the list filters by author (`hiddenAuthors` in
 * `services/comments.ts`). So this returns the blocked list too.
 *
 * The step-2 404 has its own code (`story_comments_unavailable`) because only an owner who is
 * already looking at the story can reach it, so stating the reason leaks nothing and lets the
 * screen explain that private stories have no comments.
 */
export async function requireCommentableStory(c: Context<AppEnv>): Promise<{
	story: Story;
	/**
	 * Member ids this viewer blocked; the list filters by author once more. Already fetched while
	 * building the selector, so returned here to avoid a second `listBlocked` query per page.
	 */
	blocked: string[];
	/**
	 * The resolved viewer; null for a guest. Returned for the same reason as `blocked`: reactions need
	 * "did this person press it", and calling `getViewer(c)` again resolves the session twice. Not
	 * authorization — write paths still pass their own `requireActiveViewer` (folding the gate into
	 * this door would make read and write eligibility one axis).
	 */
	viewer: Viewer | null;
}> {
	/**
	 * Always present because the mount point is under `/:id`; only the type does not know that
	 * (sub-routers cannot see the parent's path pattern). A missing id folds into "no such story"
	 * rather than throwing, so this function has one failure shape.
	 */
	const storyId = c.req.param("id");
	const { selector, viewer } = await lookupSelector(c);
	const story = storyId ? await getStory(storyId, selector) : null;
	if (!story) throw notFound("Story not found.");
	/**
	 * Unlisted stories get comments. What is blocked here is not "visible" but "public discussion
	 * makes sense", which depends on whether anyone with the address can open it: private is
	 * owner-only, unlisted is no different from public. The predicate is not rewritten here because it
	 * is shared (`isStoryDirectlyViewable` — sharing and reporting ask the same question).
	 */
	if (!isStoryDirectlyViewable(story.visibility))
		throw new ApiError(
			404,
			STORY_COMMENT_ERROR_CODE.unavailable,
			"You can't comment on a private story.",
		);
	return { story, blocked: selector.blocked, viewer };
}
