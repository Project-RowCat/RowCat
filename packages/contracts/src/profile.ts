import { z } from "zod";
import { CreatorWorkDto } from "./creator-work.ts";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, StoryDto } from "./gallery.ts";

/**
 * Public profile protocol: what /v2/creators/* sends.
 *
 * - Projection, not removal. Only the four listed fields leave the member row. A removal list
 *   would leak any new column silently; an addition list cannot.
 * - Named PublicProfile, not Creator. A commenter can have a profile without publishing any work,
 *   and a Creator name would imply that isCreator gates profiles.
 * - Never sent: email, birth date, age, verification, adult flags, member status, login methods,
 *   sessions, devices, sync keys, BYO links, signup date, last visit. Status is operator-internal.
 *   Signup date enables impersonation and targeting. Last visit is not stored.
 * - Never sent: whether the viewer follows this person. That relation differs per viewer and
 *   would stop the response from being shared-cached. /me/state answers it
 *   (PersonalizationStateDto). The follower count is public and is included.
 */

/**
 * Bio length cap. This value is the only source of truth.
 *
 * The screen (character count, save lock) and the server must read the same value. If each kept its
 * own copy, a bio the screen accepted could bounce with a 400 that the user cannot explain.
 *
 * 300 because a bio is one paragraph, not a cover letter. A product need for longer text would mean
 * a different screen.
 */
export const BIO_LIMITS = { max: 300 } as const;

/**
 * Public projection of a member, as an allowlist.
 *
 * displayName is not nickname on purpose. The account screen edits the nickname. This field is the
 * name the profile is called by on screen. It is neither unique nor an identity. Identity is id
 * alone, and addresses are built from it.
 */
export const PublicProfileDto = z.object({
	/**
	 * RowCat member id. Immutable, and the only value used as an address.
	 *
	 * Nicknames are not used for addresses. They have no uniqueness constraint and no change cooldown
	 * (NicknameUpdateDto in me.ts). An address built from one would break saved links on every rename.
	 * Two people with the same name would also have no way to decide who owns the address.
	 */
	id: z.string(),
	/** Display name. May be empty. The screen decides what to draw in that case (@rowcat/domain). */
	displayName: z.string(),
	/**
	 * Avatar URL, or null when there is none. The screen then draws an initial.
	 *
	 * This value always points at media that RowCat validated and stored (media.ts). No path lets an
	 * external URL (for example a Google profile photo) land here, and no writable field accepts one.
	 * Such a field would make a photo the user never chose the public face of the profile. It would
	 * let a host we do not control see viewers' IPs. Once the server fetched arbitrary URLs, it would
	 * become an SSRF surface.
	 *
	 * The server builds the URL; the screen does not. Changing the avatar issues a new media id, so
	 * the string changes entirely, and what it points to never changes. That is why no cache buster is
	 * needed, and why the screen does not append `?cacheBust=${Date.now()}`.
	 */
	avatarUrl: z.string().nullable(),
	/**
	 * Bio. Unset is null, not an empty string. That is this repo's convention (@rowcat/domain). The
	 * screen then has no reason to tell wrote an empty bio from never wrote one.
	 */
	bio: z.string().nullable(),
	/**
	 * Follower count. This is a public aggregate.
	 *
	 * It sits in the profile because it has the same nature as the other four fields: public, owned by
	 * the creator, and identical for every viewer. The response's cache axis therefore stays as it is
	 * (public, max-age=60, not varied by viewer). A separate stats resource would make the profile
	 * screen issue two requests that could see different moments.
	 *
	 * Not a denormalized counter. It is a count over the follow table (uses idx_follow_creator). A
	 * column would add a drift target to manage. Duplicate follows are blocked by the primary key, so
	 * the count is exact every time it is read.
	 */
	followers: z.number().int().nonnegative(),
});
export type PublicProfileDto = z.infer<typeof PublicProfileDto>;

/**
 * Summary of a public profile: the minimum needed to draw a person on one line.
 *
 * Derived with .pick() rather than retyping the three fields, so the type records that it is a
 * subset of the profile. Separate definitions would drift: one side gains a field, and the other
 * does not.
 *
 * The exposure boundary is inherited. There is no email, status or signup date, because the profile
 * has none.
 *
 * Notifications use this type for their actor (notifications.ts). There is no separate
 * NotificationActorDto, because the exposure is the same. A second type under another name would be
 * a second place to update when the public profile rules change.
 *
 * Not merged with StoryCommentAuthorDto. That DTO already exports the same values under the name
 * `nickname`. Merging would rename a live wire field. Unifying the vocabulary has value, but
 * notifications should not pay for it.
 */
export const PublicProfileSummaryDto = PublicProfileDto.pick({
	id: true,
	displayName: true,
	avatarUrl: true,
});
export type PublicProfileSummaryDto = z.infer<typeof PublicProfileSummaryDto>;

/**
 * Bio update: PATCH /v2/me/bio. The body has no target. The target is the sender, identified only
 * by the cookie. Living under /me/* enforces this.
 *
 * Empty string is allowed on purpose. Clearing a bio is an action too, and it needs a
 * representation. The server stores empty as unset, so the response's bio becomes null.
 */
export const BioUpdateDto = z.object({
	bio: z.string().trim().max(BIO_LIMITS.max),
});
export type BioUpdateDto = z.infer<typeof BioUpdateDto>;

/**
 * Query for a public profile's work grid. No sort, filter or search.
 *
 * Those axes belong to the discovery screen (the gallery already has them). The profile lists one
 * person's public works, newest first. Once it gets sort or filter, it is a gallery filter, not a
 * profile.
 *
 * The gallery endpoint does not get a creator= parameter either. That path also includes the
 * viewer's own private works (self discovery). If the public profile followed that rule, only the
 * owner would see a different list. Public screens must look the same to everyone, so the path is
 * separate.
 */
export const CreatorStoriesQuery = z.object({
	page: z.number().int().min(1).default(1),
	pageSize: z
		.number()
		.int()
		.min(1)
		.max(MAX_PAGE_SIZE)
		.default(DEFAULT_PAGE_SIZE),
});
export type CreatorStoriesQuery = z.infer<typeof CreatorStoriesQuery>;

/**
 * Same convention as the gallery: default values are omitted, since the server reads an omitted
 * value as the default.
 */
export function toCreatorStoriesSearchParams(
	q: CreatorStoriesQuery,
): URLSearchParams {
	const sp = new URLSearchParams();
	if (q.page !== 1) sp.set("page", String(q.page));
	if (q.pageSize !== DEFAULT_PAGE_SIZE) sp.set("pageSize", String(q.pageSize));
	return sp;
}

/**
 * Upper bound on pinned stories. This value is the only source of truth.
 *
 * The limit is three because the pinned row's job is to say, within the first screen, what this
 * person makes. From four on, the row falls below the fold on narrow screens. Pins would then do
 * the same job as the grid below, making them a second list rather than a pin.
 */
export const PROFILE_PINNED_STORY_LIMIT = 3;

/**
 * Pinned stories of a public profile: GET /v2/creators/:id/pinned-stories.
 *
 * Not included in the profile DTO. The profile is the same for every viewer and sits in shared
 * cache. Stories vary per viewer (adult display, blocks). Merging them would personalize the whole
 * profile. This is the same reason the work grid is separate, and it passes the same exposure
 * predicate (galleryWhere).
 *
 * If a pinned story is not visible now (made private, hidden by an operator, or the viewer cannot
 * see its rating), its row is omitted. Empty slots are not drawn. Something is pinned here, but you
 * cannot see it, would itself reveal that a hidden work exists.
 */
export const PinnedStoriesResponse = z.object({
	items: z.array(StoryDto).max(PROFILE_PINNED_STORY_LIMIT),
});
export type PinnedStoriesResponse = z.infer<typeof PinnedStoriesResponse>;

/**
 * Pin update: PUT /v2/me/pinned-stories. The body is the full desired final list.
 *
 * There are no separate add, remove or reorder endpoints. Those would make retries flip state: what
 * should a retried add do after its response was lost? Two tabs could also partly overwrite each
 * other's results. Sending the whole list gives the same result on any number of retries. Follow
 * and block work the same way, taking a boolean final state.
 *
 * Order is display order. An empty array unpins everything. Duplicates are not representable and
 * are rejected. They are not folded silently, because that would make the list the screen sent
 * differ from the stored one. There is no target member: the owner comes from the session, since
 * the path is under /me.
 */
export const PinnedStoriesUpdateDto = z
	.object({
		storyIds: z
			.array(z.string().min(1))
			.max(PROFILE_PINNED_STORY_LIMIT)
			.refine((ids) => new Set(ids).size === ids.length, {
				message: "The same story can't be pinned twice.",
			}),
	})
	.strict();
export type PinnedStoriesUpdateDto = z.infer<typeof PinnedStoriesUpdateDto>;

/**
 * Owner's pinned stories: the response for GET and PUT /v2/me/pinned-stories.
 *
 * It differs from the public response on purpose. The owner must see pins that are not visible on
 * the profile right now. If a private work holds one of the three slots and is invisible on the
 * edit screen, the owner sees you can only pick two with no visible cause. So it uses the owner
 * projection (CreatorWorkDto), which carries visibility and hidden state.
 *
 * This projection can include titles of works not yet shown to anyone. The cache therefore lives
 * under `["viewer"]` and is cleared on logout (@rowcat/query).
 */
export const OwnPinnedStoriesResponse = z.object({
	items: z.array(CreatorWorkDto).max(PROFILE_PINNED_STORY_LIMIT),
});
export type OwnPinnedStoriesResponse = z.infer<typeof OwnPinnedStoriesResponse>;

/**
 * One reason for rejecting a pin update.
 *
 * There is exactly one reason. Nonexistent works, others' works and works not currently public all
 * fold into the same code. Splitting them would let a request with someone else's work id detect
 * that the work exists. The screen's response is the same in every case: reload the list and let
 * the user choose again.
 */
export const PINNED_STORY_ERROR_CODE = {
	/** One of the works in this list cannot be pinned right now (409). */
	unavailable: "pinned_story_unavailable",
} as const;
