import { z } from "zod";
import { StoryPlayMode } from "./story-runtime.ts";
import { StoryVisibility } from "./story-visibility.ts";

/**
 * Gallery protocol: what the /v2 API actually sends and receives.
 *
 * The previous version copied the legacy Next.js contract as a reference. That contract exposed DB
 * columns directly: snake_case, 'empty string means unset', tags as one CSV cell, and the cover as
 * base64 inside the JSON. The new server is ours, so there is no reason to inherit those
 * conventions. Cleaning them up here removes the conversion layer in @rowcat/sdk, leaving only
 * validation.
 *
 * The fields here match the @rowcat/domain model one to one. The two packages are not merged
 * because their roles differ. This file decides whether a value from outside can be trusted. domain
 * holds the types that screens and rules use. If the server contract ever diverges, screens stay
 * stable.
 */

export const Orientation = z.enum(["female", "male", "all"]);
export type Orientation = z.infer<typeof Orientation>;

/**
 * relevance only has meaning when there is a search term. Without one, the server folds relevance
 * into recent, which @rowcat/domain's effectiveGallerySort does too. It is not rejected, because a
 * hand-edited URL should not turn the gallery into an error page.
 */
export const StorySort = z.enum(["recent", "popular", "relevance"]);
export type StorySort = z.infer<typeof StorySort>;

/**
 * Search length cap. Gallery search is ILIKE '%q%' over a trigram index, plus relevance scoring.
 * With no cap, one request could scan the whole catalog with a multi-KB pattern. 100 characters is
 * longer than any work title.
 */
export const STORY_SEARCH_MAX_LENGTH = 100;

/**
 * Maximum length of one tag. It equals the publish limit (STORY_PUBLISH_LIMITS.tag). This file is
 * the source, and the publish contract reads this value. A filter longer than any storable tag
 * cannot match any work, so it is not accepted.
 */
export const STORY_TAG_MAX_LENGTH = 40;

/** Aggregation window for popularity sort. Meaningless for recent sort. */
export const StoryPeriod = z.enum(["all", "day", "week", "month"]);
export type StoryPeriod = z.infer<typeof StoryPeriod>;

/** any means no rating filter; sfw means all-ages works; adult means adult-rated works. */
export const StoryRating = z.enum(["any", "sfw", "adult"]);
export type StoryRating = z.infer<typeof StoryRating>;

export const StoryCreatorDto = z.object({
	id: z.string(),
	nickname: z.string(),
});
export type StoryCreatorDto = z.infer<typeof StoryCreatorDto>;

/**
 * Public list and detail item. Owner-only and moderation fields are cut by the server at
 * projection. They are never SELECTed, rather than deleted after the response is built.
 */
export const StoryDto = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string(),
	/** Author name as written on the work. It may differ from the creator's account name. */
	author: z.string(),
	/**
	 * Cover address, or null. Unlike the legacy API, no base64 goes into the list JSON. The query
	 * string carries the last modified time, so the cover can be cached permanently and a cover
	 * replacement still takes effect at once.
	 */
	coverUrl: z.string().nullable(),
	orientation: Orientation.nullable(),
	adult: z.boolean(),
	/**
	 * Owner-set visibility, as one canonical value. This field was once isPrivate: z.boolean(). Even
	 * with two or three values, that could not tell public from archived. Adding unlisted made the
	 * fold turn four states into one true/false. Rather than add isUnlisted and isArchived beside it,
	 * the canonical value is sent. Separate booleans would leave contradictory combinations in the
	 * contract that nothing validates.
	 *
	 * Nothing new leaks. Only values this viewer can actually see can appear. Others get public or
	 * unlisted. private goes only to the owner and archived to no one (galleryWhere in
	 * services/story/index.ts holds that boundary as a predicate).
	 */
	visibility: StoryVisibility,
	promptProtected: z.boolean(),
	tags: z.array(z.string()),
	/**
	 * Total favorites: a public aggregate. Whether the viewer has favorited the work is per-viewer, so
	 * it is not here. The /me/state batch endpoint answers that. Putting it here would make the work
	 * object differ from person to person.
	 */
	favorites: z.number().int().nonnegative(),
	/**
	 * Creator. null means the work's creator was erased by account deletion. No placeholder object
	 * such as a 'deleted member' is allowed in the contract. A placeholder has a normal shape, so the
	 * screen would draw a profile link to it, and the erased identity would become a live URL again.
	 * With null the branch cannot be forgotten, because the type enforces it.
	 */
	creator: StoryCreatorDto.nullable(),
	/**
	 * How this work is played, as projected by the server. The authority is the existence of one valid
	 * published runtime row (story_runtime), which only the server knows. The screen must not guess
	 * from the title, creator, draft metadata, or the runtime authoring files on the device. That
	 * guess is wrong across devices and accounts, and the symptom is that pressing `Start conversation` does
	 * nothing.
	 *
	 * It must arrive with the detail response. As a separate fetch, the primary action would draw `Start
	 * conversation` briefly and then switch to `Play`, and a press during that flicker would create a
	 * conversation that does not exist.
	 *
	 * There is no .default('chat') on purpose. If the server omits this value, parsing rejects the
	 * response rather than silently treating the work as chat.
	 */
	playMode: StoryPlayMode,
	/** ISO 8601. */
	createdAt: z.iso.datetime(),
	updatedAt: z.iso.datetime(),
	sizeBytes: z.number().int().nonnegative(),
});
export type StoryDto = z.infer<typeof StoryDto>;

/** Gallery grid page size. Client and server must agree so that prefetch matches the real query. */
export const DEFAULT_PAGE_SIZE = 24;
/** Largest requestable page size. Stops a hostile pageSize from dumping the whole result set. */
export const MAX_PAGE_SIZE = 100;
/** Last requestable page. Stops a large OFFSET from walking the entire sort. */
export const MAX_PAGE = 500;

export const StoriesQuery = z.object({
	orientation: Orientation.nullable().default(null),
	rating: StoryRating.default("any"),
	sort: StorySort.default("recent"),
	period: StoryPeriod.default("all"),
	/** Partial match on title, author, description, tags, and creator nickname. */
	q: z.string().max(STORY_SEARCH_MAX_LENGTH).default(""),
	/**
	 * Only works with this tag. It must match a work's tag exactly, after trimming whitespace. It is
	 * not a substring match: a tag is one word the creator chose, and someone who clicks a tag on a
	 * detail page expects works that carry that exact word. null means no tag axis.
	 */
	tag: z.string().max(STORY_TAG_MAX_LENGTH).nullable().default(null),
	/** Only works the viewer has favorited. Requires login. */
	favorited: z.boolean().default(false),
	/** Only works by creators the viewer follows. Requires login. */
	following: z.boolean().default(false),
	/**
	 * No creator filter. One existed before, but it was removed before any screen used it. The public
	 * profile's work grid is answered by /v2/creators/:id/stories. Keeping both paths means two
	 * predicates answer the same question, and they already differ: discovery includes the viewer's
	 * own private works (ownPrivateVisible), while the public profile does not. If the parameter
	 * stayed, someone would eventually move the profile onto it, and from then on only the profile's
	 * owner would see a different list, with no visible sign of the difference.
	 */
	/**
	 * The cap exists because of the guest cache condition (page <= 3). Beyond that, every request runs
	 * a window subquery, a sort, an OFFSET, and count(*) in Postgres. page=99999999 would trigger all
	 * of that without authentication, and the rate limiter does not key on IP. A cap of 500 pages
	 * times 100 items covers any gallery query.
	 */
	page: z.number().int().min(1).max(MAX_PAGE).default(1),
	pageSize: z
		.number()
		.int()
		.min(1)
		.max(MAX_PAGE_SIZE)
		.default(DEFAULT_PAGE_SIZE),
});
export type StoriesQuery = z.infer<typeof StoriesQuery>;

/**
 * Pagination envelope: always this shape. The legacy API returned the envelope only when page was
 * sent, and a bare array otherwise, to stay compatible with clients already shipped. /v2 is a new
 * path and does not inherit that debt. A reader that accepts both shapes would let a server
 * returning a bare array leave the gallery silently empty while HTTP stays 200, so monitoring would
 * record it as healthy.
 */
export const StoriesPage = z.object({
	items: z.array(StoryDto),
	total: z.number().int().nonnegative(),
	page: z.number().int().min(1),
	pageSize: z.number().int().min(1),
	pageCount: z.number().int().min(1),
});
export type StoriesPage = z.infer<typeof StoriesPage>;

/**
 * Defaults are omitted. Writing this per client splits cache keys, so one query can go out under
 * two URLs.
 */
export function toStoriesSearchParams(q: StoriesQuery): URLSearchParams {
	const sp = new URLSearchParams();
	if (q.orientation) sp.set("orientation", q.orientation);
	if (q.rating !== "any") sp.set("rating", q.rating);
	if (q.sort !== "recent") sp.set("sort", q.sort);
	if (q.period !== "all") sp.set("period", q.period);
	if (q.q.trim()) sp.set("q", q.q.trim());
	if (q.tag?.trim()) sp.set("tag", q.tag.trim());
	if (q.favorited) sp.set("favorited", "1");
	if (q.following) sp.set("following", "1");
	if (q.page !== 1) sp.set("page", String(q.page));
	if (q.pageSize !== DEFAULT_PAGE_SIZE) sp.set("pageSize", String(q.pageSize));
	return sp;
}

/** Error codes returned with 403 when the gallery gate blocks a request. */
export const GALLERY_ERROR_CODE = {
	adultVerificationRequired: "adult_verification_required",
	adultVisibilityOff: "adult_visibility_off",
	/**
	 * Eligible, but the last adult verification is more than one year old. Turning the display setting
	 * on does not clear this; identity verification must be done again (Enforcement Decree of the Juvenile Protection Act, article 17(2)).
	 */
	adultRecheckRequired: "adult_recheck_required",
	loginRequired: "login_required",
} as const;
export type GalleryErrorCode =
	(typeof GALLERY_ERROR_CODE)[keyof typeof GALLERY_ERROR_CODE];

/**
 * Related works (GET /v2/stories/:id/related). Same StoryDto list as the gallery, with no paging:
 * the limit is the page. No score and no reason such as 'shares two tags' is sent. If it were, the
 * screen would start drawing it, and the ranking formula would become part of the contract. The
 * exposure boundary uses the same predicate as the discovery screen (services/story/index.ts).
 */
export const RELATED_STORIES_LIMIT = 8;

export const RelatedStoriesResponse = z.object({
	items: z.array(StoryDto).max(RELATED_STORIES_LIMIT),
});
export type RelatedStoriesResponse = z.infer<typeof RelatedStoriesResponse>;
