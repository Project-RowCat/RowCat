import { isOwnProfile, type PublicProfile } from "./profile.ts";
import { isBlocked, isFollowing, type PersonalizationState } from "./social.ts";

/**
 * Decides what appears at the top of a public profile. Pure judgment only.
 *
 * The judgment combines three values (profile, viewer and personalization), and two of them may not
 * have arrived yet. Putting these conditions in JSX would let 'not known yet' silently collapse
 * into 'no'. The symptom is a flicker after refresh: the follow button reads 'Follow' for one
 * frame, then changes to 'Following'.
 *
 * This rule used to live in apps/web/src/features/profile/profile-actions.ts, which was fine while
 * web was the only consumer. Once mobile had the same screen, each app writing the rule would
 * drift. One side might show block to guests, or invent a third 'personalization unknown' state.
 * Such drift shows only when the two screens are compared side by side (filtersForViewer sits in
 * the same place for the same reason).
 *
 * Only the judgment lives here. Copy, containers, icons and navigation belong to each app, so this
 * file contains no UI copy or routes.
 */

export type ProfileActions =
	/** The viewer's own profile. Neither follow nor block is shown. */
	| { kind: "own" }
	/**
	 * Guest: the follow button is shown, but pressing it leads to sign-in. It is not hidden, because
	 * that button is the reason to sign in.
	 *
	 * Block is hidden instead. Guests have no block list, so a block control would do nothing useful
	 * after sign-in.
	 */
	| { kind: "guest" }
	| {
			kind: "member";
			following: boolean;
			blocked: boolean;
	  };

/**
 * Returns an answer even when personalization has not arrived. In that case the viewer is treated
 * as having no relationship to the profile.
 *
 * 'Unknown' is deliberately not a fourth state. It would create a branch that leaves the button
 * slot empty, so a viewer whose personalization lookup failed would never see the follow button.
 * Drawing 'no relationship' and changing the label when the value arrives is better. Pressing in
 * the meantime is safe: the API is idempotent and sets the requested state, so results do not
 * diverge.
 */
export function resolveProfileActions(
	profile: PublicProfile,
	viewerId: string | null,
	personalization: PersonalizationState | undefined,
): ProfileActions {
	if (isOwnProfile(profile, viewerId)) return { kind: "own" };
	if (!viewerId) return { kind: "guest" };
	return {
		kind: "member",
		following: personalization
			? isFollowing(personalization, profile.id)
			: false,
		blocked: personalization ? isBlocked(personalization, profile.id) : false,
	};
}

/**
 * Whether this profile's works area shows 'blocked'. The server returns zero works for a creator
 * the viewer has blocked, because `galleryWhere` uses one predicate for both the list and the
 * totals. This function answers from personalization state alone, and the screen does not re-judge
 * the zero.
 *
 * Showing that zero as 'no works' would make a viewer who blocked the creator think the creator has
 * posted nothing, with no way to learn why the screen is empty.
 */
export const profileContentBlocked = (actions: ProfileActions): boolean =>
	actions.kind === "member" && actions.blocked;
