import { z } from "zod";

/**
 * Relationship writes for favorites, follows, and blocks. Each request carries the desired final
 * state, not a toggle. Toggles are unsafe to retry: a client that resends after a lost response
 * would flip the state back, while a desired-state request gives the same result however often it
 * is sent. The schemas live in the contract because @rowcat/sdk builds the same bodies. If they
 * lived only in the server, the two sides could diverge while types still pass, and the mismatch
 * would surface only as a runtime 400.
 */

/** Request body of PUT /favorites/:storyId. */
export const SetFavoriteRequest = z.object({ favorited: z.boolean() });
export type SetFavoriteRequest = z.infer<typeof SetFavoriteRequest>;

/**
 * The final state the server settled on. The client's optimistic update is corrected to this value.
 */
export const FavoriteStateDto = z.object({
	favorited: z.boolean(),
	/**
	 * Settled total, the baseline to revert to when optimistic +/-1 updates conflict with concurrent
	 * requests.
	 */
	favorites: z.number().int().nonnegative(),
});
export type FavoriteStateDto = z.infer<typeof FavoriteStateDto>;

/**
 * The target is in the body; the subject is not. The follower is always the requester, and that
 * identity comes only from the session. The contract has no follower field, so code that tries to
 * pass one fails type checking. This is the same rule as the `owner` field in sync.
 */
export const SetFollowRequest = z.object({
	creator: z.string().min(1),
	following: z.boolean(),
});
export type SetFollowRequest = z.infer<typeof SetFollowRequest>;

/** Body of PUT /blocks. There is no subject field, for the same reason as follows. */
export const SetBlockRequest = z.object({
	creator: z.string().min(1),
	blocked: z.boolean(),
});
export type SetBlockRequest = z.infer<typeof SetBlockRequest>;

/**
 * Reasons a relationship write is rejected. Clients branch on this code, not on the HTTP status.
 * All four are rejections that hiding a button cannot prevent, since the API can be called
 * directly. The same checks run on the server, and their reasons are named here.
 */
export const SOCIAL_ERROR_CODE = {
	selfFollow: "self_follow",
	selfBlock: "self_block",
	/**
	 * A blocked target cannot be followed. This pairs with blocking removing follows atomically.
	 * Without this rule, one follow request right after a block would revive a
	 * blocked-but-still-following state.
	 */
	blockedTarget: "follow_blocked_target",
	/**
	 * Same 404 as the public profile. Answering missing ids and withdrawn ids differently would reveal
	 * that an id once existed.
	 */
	notFound: "not_found",
} as const;
export type SocialErrorCode =
	(typeof SOCIAL_ERROR_CODE)[keyof typeof SOCIAL_ERROR_CODE];

/**
 * The follow response carries the server's final state and the creator's public follower total. The
 * two fields differ in scope: `following` depends on the viewer, while `followers` is the same
 * count for everyone. They share a response because one write changes both. Without the total, the
 * client would keep its own +/-1 guess as the truth.
 */
export const FollowStateDto = z.object({
	following: z.boolean(),
	followers: z.number().int().nonnegative(),
});
export type FollowStateDto = z.infer<typeof FollowStateDto>;

/**
 * The block response carries the final state and the target's follower total. Blocking removes
 * follows in the same transaction, which lowers that total at once. Without the field, a profile
 * screen would have to guess and adjust by 1. Unblocking does not restore follows, but the field is
 * returned anyway so the response shape does not depend on direction.
 */
export const BlockStateDto = z.object({
	blocked: z.boolean(),
	followers: z.number().int().nonnegative(),
});
export type BlockStateDto = z.infer<typeof BlockStateDto>;
