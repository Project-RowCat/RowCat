/**
 * Personalization state: the relationship between the viewer and other targets.
 *
 * Relationships are kept out of the work object because the axes differ. A work is the same for
 * everyone; a relationship differs per person. Merging would make the publicly cached value vary by
 * viewer, and each list would copy the work in a different shape. For the same reason the server
 * offers one batch endpoint for this state.
 */

export interface PersonalizationState {
	favorites: string[];
	following: string[];
	blocked: string[];
}

/**
 * The value for logged-out users or failed lookups. Sharing one constant means 'not yet received'
 * and 'none' take the same shape. Screens draw relationship-free UI for either, so no branch is
 * needed.
 */
export const EMPTY_PERSONALIZATION_STATE: PersonalizationState = {
	favorites: [],
	following: [],
	blocked: [],
};

/** The confirmed result of a favorite write: the final state and the server-counted total. */
export interface FavoriteState {
	favorited: boolean;
	favorites: number;
}

/**
 * The confirmed result of a follow write: the final state and the creator's public follower total.
 *
 * The two values are on different axes (relationship and public aggregate). They arrive together
 * because the write changes both. Without a server total to correct an optimistic +1 or -1, the
 * screen would keep its own arithmetic as the truth.
 */
export interface FollowState {
	following: boolean;
	followers: number;
}

/**
 * The confirmed result of a block write. The follower total comes along to show that block is
 * atomic. Blocking also removes the follow in the same transaction, so the target's follower count
 * drops at that moment.
 */
export interface BlockState {
	blocked: boolean;
	followers: number;
}

export const isFavorited = (
	state: PersonalizationState,
	storyId: string,
): boolean => state.favorites.includes(storyId);

/**
 * Returns a new state with the favorite membership changed. Does not mutate in place, because this
 * value goes straight into the server-state cache. Mutating a cached array would hide the change
 * from React's reference comparison, and the snapshot used to roll back an optimistic update would
 * already be corrupted. Returns the same reference when nothing changes, to avoid a wasted render.
 */
export function withFavorite(
	state: PersonalizationState,
	storyId: string,
	favorited: boolean,
): PersonalizationState {
	if (isFavorited(state, storyId) === favorited) return state;
	return {
		...state,
		favorites: favorited
			? [...state.favorites, storyId]
			: state.favorites.filter((id) => id !== storyId),
	};
}

export const isFollowing = (
	state: PersonalizationState,
	creatorId: string,
): boolean => state.following.includes(creatorId);

export const isBlocked = (
	state: PersonalizationState,
	creatorId: string,
): boolean => state.blocked.includes(creatorId);

/**
 * Returns a new state with the follow membership changed. Not mutated in place, for the same reason
 * as `withFavorite`: a mutated cache array is invisible to reference comparison, and the rollback
 * snapshot would already be corrupted.
 */
export function withFollowing(
	state: PersonalizationState,
	creatorId: string,
	following: boolean,
): PersonalizationState {
	if (isFollowing(state, creatorId) === following) return state;
	return {
		...state,
		following: following
			? [...state.following, creatorId]
			: state.following.filter((id) => id !== creatorId),
	};
}

/**
 * Returns a new state with the block membership changed. Blocking also removes the follow.
 *
 * That line is why this function exists. The server blocks and unfollows in one transaction
 * (services/social.ts). If the screen updated only the block list, the personalization cache would
 * hold 'blocked but still following', a state that does not exist on the server. Updating the two
 * arrays separately at each call site would eventually miss one, so the invariant is fixed here.
 *
 * Unblocking does not restore the follow, and neither does the server. Restoring it would mean
 * keeping the pre-block relationship somewhere, which is holding onto a relationship the user
 * removed.
 */
export function withBlocked(
	state: PersonalizationState,
	creatorId: string,
	blocked: boolean,
): PersonalizationState {
	const next = blocked ? withFollowing(state, creatorId, false) : state;
	if (isBlocked(next, creatorId) === blocked) return next;
	return {
		...next,
		blocked: blocked
			? [...next.blocked, creatorId]
			: next.blocked.filter((id) => id !== creatorId),
	};
}
