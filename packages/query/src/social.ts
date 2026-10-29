import type {
	BlockState,
	FollowState,
	PersonalizationState,
	PublicProfile,
	Story,
} from "@rowcat/domain";
import { isFollowing, withBlocked, withFollowing } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import {
	mutationOptions,
	type QueryClient,
	type QueryKey,
} from "@tanstack/react-query";
import { STORY_COMMENTS_QUERY_KEY_PREFIX } from "./comments.ts";
import {
	GALLERY_QUERY_KEY_PREFIX,
	type GalleryInfiniteData,
} from "./gallery.ts";
import {
	CREATOR_STORIES_QUERY_KEY_PREFIX,
	PINNED_STORIES_QUERY_KEY_PREFIX,
	publicProfileQueryKey,
} from "./profile.ts";
import {
	RELATED_STORIES_QUERY_KEY_PREFIX,
	STORY_DETAIL_QUERY_KEY_PREFIX,
} from "./story.ts";
import { PERSONALIZATION_QUERY_KEY } from "./viewer.ts";

/**
 * Cache policy for follow and block writes.
 *
 * The screen sends only the desired next state. What each click changes in cache is decided here.
 * If the profile header and the gallery toolbar each started touching cache, a mismatch in one spot
 * would make the follower count differ from screen to screen, and a blocked person's works would
 * stay in one list.
 *
 * The two writes differ in nature. That is the frame of this file:
 *
 * follow   one relation plus one public aggregate   optimistic (rollback is deterministic)
 * block    everything the viewer can see           confirmed first, then removed at once
 *
 * Follow can safely be drawn first, since only two slots need reverting. Block must, on success,
 * remove the person's trace from the gallery, profile grid, work detail and comments at once. Doing
 * that optimistically would require **restoring** the removed lists on failure. Rollback is not
 * deterministic there: scrolled-in later pages and newly posted works would be overwritten by the
 * old snapshot.
 */

/**
 * Rollback needs **only the previous values of the slots this mutation directly changes**.
 *
 * It does not hold the whole personalization state or profile object. Mutation scope is per
 * creator, so other creators' requests change the same objects concurrently. Restoring an old
 * object that contains their successful changes would undo them (same rule as favorites).
 */
interface FollowSnapshot {
	/** Whether the personalization cache existed at onMutate. If not, rollback does not create it. */
	personalizationWasCached: boolean;
	wasFollowing: boolean;
	/**
	 * Follower count at that time, if the profile slot existed. `null` otherwise, and rollback does
	 * not create it.
	 */
	followers: number | null;
}

/**
 * Patches the profile slot **only if it exists**. Does not create a missing slot. `setQueryData`
 * would create one with no observers, and the next screen opening that profile would read it as an
 * already-present value (same rule as in profile.ts).
 */
function patchFollowers(
	queryClient: QueryClient,
	creatorId: string,
	followers: number,
): void {
	queryClient.setQueryData<PublicProfile>(
		publicProfileQueryKey(creatorId),
		(prev) =>
			prev && prev.followers !== followers ? { ...prev, followers } : prev,
	);
}

/**
 * Follow setter mutation. The variable is the **desired final state** (`true` or `false`).
 *
 * Optimistic because rollback is deterministic. Only one personalization array entry and one
 * follower count change, and both are values this mutation raises and lowers itself.
 *
 * Failures roll back. In particular, 'blocked counterpart', 'self' and 'nonexistent member' are
 * rejections only the server knows, since the personalization cache may be stale. The screen does
 * not pre-judge them. When a rejection arrives, the button returns to its original state.
 */
export function followMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	creatorId: string,
) {
	const profileKey = publicProfileQueryKey(creatorId);

	return mutationOptions<FollowState, Error, boolean, FollowSnapshot>({
		/**
		 * Requests for the same creator are queued. Tapping follow repeatedly sends requests for
		 * different final states at once. If responses arrive out of order, a **late, older response**
		 * overwrites the cache, and the screen settles on the opposite of the last press. The scope is
		 * per creator, so other creators still run in parallel.
		 */
		scope: { id: `follow:${creatorId}` },
		mutationFn: (following) => client.social.setFollow(creatorId, following),

		async onMutate(desired) {
			// Cancel in-flight queries first so they cannot overwrite the optimistic value. The profile is
			// cancelled for the same reason: a late response carrying the follower count would revert the
			// number just set.
			await Promise.all([
				queryClient.cancelQueries({ queryKey: PERSONALIZATION_QUERY_KEY }),
				queryClient.cancelQueries({ queryKey: profileKey }),
			]);

			const personalization = queryClient.getQueryData<PersonalizationState>(
				PERSONALIZATION_QUERY_KEY,
			);
			const wasFollowing = personalization
				? isFollowing(personalization, creatorId)
				: false;

			queryClient.setQueryData<PersonalizationState>(
				PERSONALIZATION_QUERY_KEY,
				(prev) => (prev ? withFollowing(prev, creatorId, desired) : prev),
			);

			/**
			 * The total changes only when the state actually changes. The server is idempotent and takes the
			 * desired state, so following someone already followed does not raise the total. Changing ±1 on
			 * screen would show a wrong number until the response arrives (§45: duplicate follows are not
			 * counted).
			 */
			const previous = queryClient.getQueryData<PublicProfile>(profileKey);
			const changesCount = wasFollowing !== desired;
			const followers = changesCount ? (previous?.followers ?? null) : null;
			if (changesCount && previous)
				patchFollowers(
					queryClient,
					creatorId,
					// The floor is set so that subtracting from a value of 0, left behind by past drift, never
					// shows a negative number.
					Math.max(0, previous.followers + (desired ? 1 : -1)),
				);

			return {
				personalizationWasCached: personalization !== undefined,
				wasFollowing,
				followers,
			};
		},

		/**
		 * The server is authoritative. If another person followed this creator at the same moment, the
		 * optimistic ±1 is already wrong. The total in the response is therefore **overwritten** as-is,
		 * not added to again. Because the last response carries the absolute value, the number does not
		 * drift after repeated taps.
		 */
		onSuccess(result) {
			queryClient.setQueryData<PersonalizationState>(
				PERSONALIZATION_QUERY_KEY,
				(prev) =>
					prev ? withFollowing(prev, creatorId, result.following) : prev,
			);
			patchFollowers(queryClient, creatorId, result.followers);
			/**
			 * Does not invalidate the gallery. Follow changes the list contents only when it is filtered to
			 * the following feed. That query has its own key and refetches under normal freshness rules the
			 * next time that filter is turned on. Invalidating the prefix here would drop every page
			 * accumulated in discovery at once, for one follow.
			 */
		},

		/**
		 * Rollback restores only this creator's relationship and total, in place on the **current**
		 * cache. The old personalization array or old profile object is not written back whole, same as
		 * favorites. That would also revert name or bio updates that arrived in the meantime.
		 */
		onError(_error, _desired, snapshot) {
			if (!snapshot) return;
			if (snapshot.personalizationWasCached)
				queryClient.setQueryData<PersonalizationState>(
					PERSONALIZATION_QUERY_KEY,
					(current) =>
						current
							? withFollowing(current, creatorId, snapshot.wasFollowing)
							: current,
				);
			if (snapshot.followers !== null)
				patchFollowers(queryClient, creatorId, snapshot.followers);
		},
	});
}

/**
 * Whether this work belongs to that creator. An ownerless work (anonymized after account deletion)
 * belongs to no one.
 */
const byCreator = (story: Story, creatorId: string): boolean =>
	story.creator?.id === creatorId;

/**
 * Removes only that creator's works from the accumulated gallery pages, and reduces the total.
 *
 * This function exists because invalidation alone is not enough. Invalidation marks stale and keeps
 * the stored value, so the just-blocked person's works would stay on screen until the refetch
 * finishes. The button pressed to be safe would appear to do nothing for the network round trip.
 * The adult-content display setting clears the cache immediately for the same reason.
 *
 * The total is reduced too, so the `N stories` count does not disagree with the list. The server gives the
 * exact value on the next page, so this is an approximation until then. That is more accurate than
 * keeping 24 while drawing 23 works.
 */
function dropCreatorFromGallery(
	data: GalleryInfiniteData | undefined,
	creatorId: string,
): GalleryInfiniteData | undefined {
	// Leaves the data untouched when nothing in it is from this creator. Returning the same reference
	// keeps that query as it is.
	if (!data?.pages.some((p) => p.items.some((s) => byCreator(s, creatorId))))
		return data;
	return {
		...data,
		pages: data.pages.map((page) => {
			const items = page.items.filter((s) => !byCreator(s, creatorId));
			if (items.length === page.items.length) return page;
			return {
				...page,
				items,
				total: Math.max(0, page.total - (page.items.length - items.length)),
			};
		}),
	};
}

/**
 * Cache cleanup right after a successful block. It touches **only the slots that depend on the
 * viewer**. What it touches and what it leaves is the definition of blocking:
 * - personalization: add to the block list and remove the follow too, mirroring the server's
 *   atomicity
 * - gallery: remove that creator's cards immediately
 * - profile works grid: reset, since the server now returns zero
 * - work detail: discard that creator's work slots (the server now returns 404)
 * - comments: reset, since that person's lines must leave the list
 * - public profile identity: **not touched**. Name and bio are still public values
 *
 * The last line is the decision in §16. Blocking does not make someone invisible. It declares that
 * this person's works are removed from my screen, so the profile address still opens and only the
 * grid empties. Clearing the identity slot too would make a value shared by everyone vanish and
 * reappear on one viewer's action. That wastes the cache and shows as flicker.
 */
function purgeBlockedCreator(
	queryClient: QueryClient,
	creatorId: string,
): void {
	queryClient.setQueriesData<GalleryInfiniteData>(
		{ queryKey: GALLERY_QUERY_KEY_PREFIX },
		(data) => dropCreatorFromGallery(data, creatorId),
	);

	/**
	 * Detail discards **only that creator's work slots**. Resetting the whole prefix would refetch
	 * unrelated works the user is viewing.
	 *
	 * `resetQueries` rather than `removeQueries`, as in logout cleanup. Detail uses
	 * `useSuspenseQuery`. Removing the entry would leave the component waiting on it with no observer,
	 * stuck on the placeholder. Dropping the stored value and re-issuing the query being watched is
	 * the right behavior.
	 */
	const blockedDetailKeys: QueryKey[] = queryClient
		.getQueriesData<Story>({ queryKey: STORY_DETAIL_QUERY_KEY_PREFIX })
		.flatMap(([key, story]) =>
			story && byCreator(story, creatorId) ? [key] : [],
		);
	for (const key of blockedDetailKeys)
		queryClient.resetQueries({ queryKey: key });

	/**
	 * Also removed from the related-works list. If another work's detail still showed that creator's
	 * card underneath, the block would not keep its promise of removing them from my screen in that
	 * place.
	 */
	queryClient.setQueriesData<Story[]>(
		{ queryKey: RELATED_STORIES_QUERY_KEY_PREFIX },
		(stories) =>
			stories?.some((story) => byCreator(story, creatorId))
				? stories.filter((story) => !byCreator(story, creatorId))
				: stories,
	);

	// The profile grid and pinned works belong only to that creator, so the key is exact.
	queryClient.resetQueries({
		queryKey: [...CREATOR_STORIES_QUERY_KEY_PREFIX, creatorId],
	});
	queryClient.resetQueries({
		queryKey: [...PINNED_STORIES_QUERY_KEY_PREFIX, creatorId],
	});

	/**
	 * Comments are split per work, and the cache alone cannot tell **which work this person commented
	 * on** (their lines can sit in any accumulated page). So resetting the whole prefix is correct.
	 * Code that scanned each list to delete would reach the same result under more assumptions.
	 */
	queryClient.resetQueries({ queryKey: STORY_COMMENTS_QUERY_KEY_PREFIX });
}

/**
 * Block setter mutation. The variable is the **desired final state**.
 *
 * No optimistic update. What a block changes is everything the viewer can see, so the rollback
 * target is not deterministic. A failure would restore a snapshot that overwrites pages scrolled in
 * meanwhile and newly posted works. Instead, the works are removed **immediately on success**. Only
 * invalidating and waiting for a refetch would make the button look dead for the round trip.
 *
 * Unblocking does not restore what was removed. What is needed then is a refetch (the server
 * returns those works again), not reverting to an old copy held here.
 */
export function blockMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	creatorId: string,
) {
	return mutationOptions<BlockState, Error, boolean>({
		// Queued per creator, like follow. The last intent of rapid taps wins.
		scope: { id: `block:${creatorId}` },
		mutationFn: (blocked) => client.social.setBlock(creatorId, blocked),

		onSuccess(result) {
			/**
			 * Personalization first. Adding to the block list while removing the follow mirrors what the
			 * server did in one transaction. That invariant belongs to the domain (`withBlocked`). Changing
			 * the two arrays separately here would eventually miss one.
			 */
			queryClient.setQueryData<PersonalizationState>(
				PERSONALIZATION_QUERY_KEY,
				(prev) => (prev ? withBlocked(prev, creatorId, result.blocked) : prev),
			);
			/**
			 * The follower count is set to the absolute value the server returns. If the block dropped a
			 * follow, the count is lower by that amount, and the screen does not need to guess whether the
			 * user was following in order to add or subtract 1.
			 */
			patchFollowers(queryClient, creatorId, result.followers);

			if (result.blocked) {
				purgeBlockedCreator(queryClient, creatorId);
				return;
			}
			/**
			 * Unblock works the other way: the works the server has started returning again must be fetched.
			 * The point is to **invalidate only**, not discard the stored value. The list visible now is
			 * still valid (it is unrelated to the block), and clearing it would make the screen empty once
			 * and then refill.
			 */
			queryClient.invalidateQueries({ queryKey: GALLERY_QUERY_KEY_PREFIX });
			queryClient.invalidateQueries({
				queryKey: [...CREATOR_STORIES_QUERY_KEY_PREFIX, creatorId],
			});
			queryClient.invalidateQueries({
				queryKey: [...PINNED_STORIES_QUERY_KEY_PREFIX, creatorId],
			});
			queryClient.invalidateQueries({
				queryKey: STORY_COMMENTS_QUERY_KEY_PREFIX,
			});
		},
	});
}
