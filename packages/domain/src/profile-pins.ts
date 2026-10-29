import {
	type CreatorWork,
	isStoryVisibleOnCreatorProfile,
	type StoryVisibility,
} from "./story.ts";

/**
 * Editing rules for pinned works: the works the owner pins to the top of the public profile.
 *
 * The web and the app both use these rules. If each app wrote them, one side might skip operator
 * hiding or exceed the limit, and the difference would only show up as a 409 from the server.
 *
 * Whether a work can be pinned and whether it is visible now are different questions:
 * - New pin: only works that appear on the profile grid now (public and not operator-hidden).
 * - Already pinned: stays pinned even when set to private. Making it public again returns it to
 *   its place.
 *
 * The second point matters. If making a work private cleared its pin, the owner would have to
 * re-order their picks after republishing. The visibility transition changes only
 * `story.visibility` (services/story/lifecycle.ts), so there is no place to tidy pins there.
 * Instead, the public response leaves out a pinned work that is not visible (a server predicate),
 * and the edit screen says why it is not visible now (`pinnedWorkNotice`).
 *
 * The limit is passed in as an argument. This package does not import contracts (the layer rule in
 * AGENTS.md), so callers pass PROFILE_PINNED_STORY_LIMIT. Its authoritative value is defined
 * outside this package.
 */

type PinnedWorkState = Pick<CreatorWork, "visibility" | "hidden">;

/**
 * Whether the work appears on the public profile now. This is the same condition as for a new pin.
 * The server's write validation (services/account/pinned-stories.ts) checks the same two
 * conditions.
 *
 * Adult rating is not part of it. Adult works can be pinned too. A viewer who cannot see them loses
 * them through the public read predicate, the same as on the grid.
 */
export const isPinnableWork = (work: PinnedWorkState): boolean =>
	isStoryVisibleOnCreatorProfile(work.visibility) && !work.hidden;

/**
 * Why a pinned work is not visible on the profile now, or null if it is visible.
 *
 * Operator hiding is checked first. A hidden work does not show whatever exposure the creator set,
 * so reporting exposure first would say 'public' for a work that is not visible and fail to explain
 * why. The reason for hiding is not stated here; that belongs to `/me/moderation`.
 */
/** How each non-visible state reads inside the notice sentence. `public` never reaches it. */
const PINNED_STATE_WORD: Record<StoryVisibility, string> = {
	public: "public",
	unlisted: "link-only",
	private: "private",
	archived: "archived",
};

export function pinnedWorkNotice(work: PinnedWorkState): string | null {
	if (work.hidden)
		return "Hidden under the operating policy, so it isn't shown on your profile.";
	if (isStoryVisibleOnCreatorProfile(work.visibility)) return null;
	return `It's ${PINNED_STATE_WORD[work.visibility]}, so it isn't shown on your profile.`;
}

/**
 * Appends one item. If the item is already present or the list is at the limit, returns the **same
 * array**.
 *
 * Returning the same reference is part of the contract. Callers detect change by reference
 * comparison, and a button pressed at the limit creates nothing to save.
 */
export function pinItem<T extends { id: string }>(
	list: readonly T[],
	item: T,
	limit: number,
): readonly T[] {
	if (list.length >= limit) return list;
	if (list.some((entry) => entry.id === item.id)) return list;
	return [...list, item];
}

/** Removes one item. Returns the same array if the item was not present. */
export function unpinItem<T extends { id: string }>(
	list: readonly T[],
	id: string,
): readonly T[] {
	return list.some((entry) => entry.id === id)
		? list.filter((entry) => entry.id !== id)
		: list;
}

/**
 * Moves an item one step up (-1) or down (+1). Moving past either end returns the same array.
 *
 * The move is one step, not drag-and-drop. Dragging would need its own path for keyboard and screen
 * reader users. With three items, any order is reachable in at most two presses.
 */
export function movePinnedItem<T extends { id: string }>(
	list: readonly T[],
	id: string,
	offset: -1 | 1,
): readonly T[] {
	const from = list.findIndex((entry) => entry.id === id);
	const to = from + offset;
	if (from < 0 || to < 0 || to >= list.length) return list;
	const next = [...list];
	const [moved] = next.splice(from, 1);
	if (moved) next.splice(to, 0, moved);
	return next;
}

export const samePinnedOrder = (
	a: readonly { id: string }[],
	b: readonly { id: string }[],
): boolean =>
	a.length === b.length && a.every((entry, index) => entry.id === b[index]?.id);
