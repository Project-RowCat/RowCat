/**
 * The public profile product model: how this person looks from outside.
 *
 * Three views stay separate and are not merged into one type:
 * - Viewer: who is looking now. member.id, the identity authorization uses.
 * - Account: how the person signs in (email, login methods). Visible to the owner only.
 * - PublicProfile: how the person looks outside (name, bio). Visible to anyone.
 *
 * Merging them would put what anyone sees and what only the owner sees on one object. Any code that
 * exports it would have to remember what to strip. Forgetting is easy, and the mistake shows only
 * after an email has appeared in a public response.
 *
 * It is also not Member. Member rows carry the adult-gate axes and membership status. Those are
 * inputs to authorization, not profile content, and their absence from this file is the boundary.
 *
 * The name has no 'Creator' on purpose. Routes and product copy say creator (/creators/:id), but a
 * profile exists because the person is a member, not because they published. A person with no works
 * still has a name and bio, and the author line of their comments must link to the same place. A
 * type named CreatorProfile would eventually grow a twin UserProfile with identical fields.
 */

export interface PublicProfile {
	/**
	 * The RowCat member id. Immutable, and the only value used as the address.
	 *
	 * Addresses are never built from nicknames. A nickname is display text with no uniqueness and no
	 * change restriction (see the NicknameUpdateDto comment). Used as an address, renaming would break
	 * links others saved, and two people with the same name would leave ownership ambiguous. Ownership
	 * is also judged by this id alone (isOwnProfile).
	 */
	id: string;
	/** Display name. May be empty; the text shown in that case is decided by `profileDisplayName`. */
	displayName: string;
	/**
	 * Profile image URL, or null. When null, callers draw the name's initial (`profileInitial`). The
	 * value is always media that RowCat validated and stored (see the contract comment).
	 */
	avatarUrl: string | null;
	/** Bio. Null when unset, not an empty string. */
	bio: string | null;
	/**
	 * Follower count: a public aggregate. Everyone sees the same value, so it sits on the profile.
	 *
	 * Whether I follow this person is not here. That is a relationship between viewer and target,
	 * owned by `PersonalizationState.following` (social.ts). Merging it in would make an object that
	 * must be identical for everyone differ per person, and the public profile cache would split by
	 * viewer.
	 */
	followers: number;
}

/**
 * The display text for a profile with no name.
 *
 * A member's nickname comes from the auth account's name (auth/viewer.ts), and some accounts have
 * an empty name. If the name slot were left empty, the page would have no heading (h1), and neither
 * readers nor assistive technology could tell whose profile it is.
 *
 * The label is chosen not to read like a person's name. It is in the same family as `Deleted creator`
 * (story.ts): both state a status and do not invent a name.
 */
export const UNNAMED_PROFILE_LABEL = "Unnamed creator";

/**
 * The name a profile is shown by.
 *
 * This is a function, like `creatorLabel` (story.ts). If several screens each wrote `displayName ||
 * ...`, one would eventually use different wording. Users would then wonder whether the person in a
 * list is the same as on the profile.
 *
 * Whitespace-only names count as empty. Otherwise the h1 would fill with invisible characters,
 * producing a page where a name exists but is not visible.
 */
export const profileDisplayName = (profile: PublicProfile): string =>
	profile.displayName.trim() || UNNAMED_PROFILE_LABEL;

/**
 * Whether the current viewer owns this profile. Judged by member id only.
 *
 * It is a function to block nickname comparison. Display names are not unique, so ownership judged
 * by name would show the `Edit profile` link on someone else's profile to a different person with the
 * same name. Clicking it could not edit the other person's data, because edits go to `/me/*` and
 * the target always comes from the cookie. A screen that looks editable when it is not is still a
 * defect.
 *
 * Guests have no own profile, so when viewerId is null the result is always false.
 */
export const isOwnProfile = (
	profile: PublicProfile,
	viewerId: string | null,
): boolean => !!viewerId && profile.id === viewerId;

/**
 * The initial taken from the name, which the avatar placeholder draws. Used when there is no image,
 * so that no empty circle or broken `<img>` appears. It derives display text from the name and
 * invents no data.
 *
 * It lives in domain so that web and Expo draw the same character, and the rule can be checked
 * without rendering.
 *
 * One character only. Imitating two Latin-style initials on a Korean name would produce the first
 * two syllables, not the first letters of the family and given names. On emoji names it would split
 * a code point in half. That is why Array.from is used for slicing: string indexing splits
 * surrogate pairs and emoji sequences into broken characters.
 *
 * If nothing can be taken, returns an empty string. No placeholder symbol is invented; callers draw
 * the icon.
 */
export function profileInitial(profile: PublicProfile): string {
	const name = profile.displayName.trim();
	if (!name) return "";
	return Array.from(name)[0]?.toUpperCase() ?? "";
}
