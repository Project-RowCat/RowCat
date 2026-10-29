import type {
	FavoriteState,
	PersonalizationState,
	Story,
} from "@rowcat/domain";
import { isFavorited, withFavorite } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import {
	mutationOptions,
	type QueryClient,
	type QueryKey,
} from "@tanstack/react-query";
import {
	GALLERY_QUERY_KEY_PREFIX,
	type GalleryInfiniteData,
	galleryStories,
} from "./gallery.ts";
import { storyDetailQueryKey } from "./story.ts";
import { PERSONALIZATION_QUERY_KEY } from "./viewer.ts";

/**
 * Cache policy for favorite writes. The screen only knows what was clicked; what that click changes
 * in the cache is decided here. Defining it in components would make cards, detail and lists each
 * apply the rules, and one divergence would make totals differ between screens. Expo uses the same
 * policy. The premise: one work is cached in several copies, one per gallery query plus one for the
 * detail view. Updating just one copy would leave a heart toggled in detail still off in the list
 * after navigating back.
 */

/**
 * What rollback needs: only the previous values of the cells this mutation changed directly. Not
 * the personalization state, gallery pages or the detail work as a whole. Mutations are per work,
 * so requests for other works change the same objects concurrently. Restoring an old whole object
 * would erase other requests' confirmed changes: if A fails, it would undo B's confirmed heart.
 * Rollback may restore only the fields it changed itself.
 */
interface FavoriteSnapshot {
	/**
	 * Whether the personalization cache existed at onMutate. If it did not, rollback does not create
	 * it.
	 */
	personalizationWasCached: boolean;
	wasFavorited: boolean;
	/** Previous totals of this work, per gallery query that actually contained it. */
	counts: [QueryKey, number][];
	/**
	 * Detail-cache total at the time, if the detail cache existed; otherwise null. Rollback does not
	 * create it.
	 */
	detailFavorites: number | null;
}

/**
 * Returns the gallery data with only this work changed. Pages without this work keep their
 * references. Scans every page, not just the first match: the same work can appear on two pages,
 * because a new work pushed in during scrolling shifts the page boundaries. Patching only one copy
 * would show two different numbers on one screen. Unchanged pages return the same reference. A new
 * array would re-render every card on that page for nothing.
 */
function patchStoryInPages(
	data: GalleryInfiniteData | undefined,
	storyId: string,
	patch: (story: Story) => Story,
): GalleryInfiniteData | undefined {
	// Does not touch a cache that lacks this work. Returning the same reference leaves that query as
	// it is.
	if (!data?.pages.some((p) => p.items.some((s) => s.id === storyId)))
		return data;
	return {
		...data,
		pages: data.pages.map((page) =>
			page.items.some((s) => s.id === storyId)
				? {
						...page,
						items: page.items.map((s) => (s.id === storyId ? patch(s) : s)),
					}
				: page,
		),
	};
}

/**
 * Applies the same change to every cache holding this work: the gallery pages and the detail. The
 * detail is patched only by this work's own key. Sweeping by prefix would also touch the details of
 * other works: unrelated screens would re-render, and a wrong work's number could someday be
 * changed.
 */
function patchStoryEverywhere(
	queryClient: QueryClient,
	storyId: string,
	patch: (story: Story) => Story,
): void {
	queryClient.setQueriesData<GalleryInfiniteData>(
		{ queryKey: GALLERY_QUERY_KEY_PREFIX },
		(data) => patchStoryInPages(data, storyId, patch),
	);
	queryClient.setQueryData<Story>(storyDetailQueryKey(storyId), (story) =>
		// Does not create a missing cell: returning undefined from the updater would leave that query
		// absent.
		story ? patch(story) : story,
	);
}

/**
 * Captures only the (key, current total) of gallery queries that contain this work. The accumulated
 * pages themselves are not captured.
 */
function captureFavoriteCounts(
	queryClient: QueryClient,
	storyId: string,
): [QueryKey, number][] {
	return queryClient
		.getQueriesData<GalleryInfiniteData>({ queryKey: GALLERY_QUERY_KEY_PREFIX })
		.flatMap(([key, data]) => {
			const story = data && galleryStories(data).find((s) => s.id === storyId);
			return story ? [[key, story.favorites] as [QueryKey, number]] : [];
		});
}

/**
 * Restores the captured totals, changing only this work's number on top of the current cache. The
 * point is not to write back old pages or old work objects: meanwhile other works may have
 * succeeded, or other fields of this work (title, cover, tags) may have been refetched. This
 * mutation undoes only the one total it moved.
 */
function restoreFavoriteCounts(
	queryClient: QueryClient,
	storyId: string,
	counts: [QueryKey, number][],
	detailFavorites: number | null,
): void {
	for (const [key, favorites] of counts)
		queryClient.setQueryData<GalleryInfiniteData>(key, (data) =>
			patchStoryInPages(data, storyId, (s) => ({ ...s, favorites })),
		);
	if (detailFavorites !== null)
		queryClient.setQueryData<Story>(storyDetailQueryKey(storyId), (story) =>
			story ? { ...story, favorites: detailFavorites } : story,
		);
}

/**
 * Sets favorite state. The variable is the desired final state (true or false), not a toggle.
 * Toggling is not done in the SDK for the same reason: the caller already knows the current state,
 * and sending the target value keeps retries from changing the result.
 */
export function favoriteMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	storyId: string,
) {
	const detailKey = storyDetailQueryKey(storyId);

	return mutationOptions<FavoriteState, Error, boolean, FavoriteSnapshot>({
		/**
		 * Requests for the same work are serialized. Rapid heart taps would send requests demanding
		 * different final states at once, and if responses arrived out of order, a late stale response
		 * could overwrite the cache. The scope is per work, so other works still run in parallel. This
		 * scope only orders requests. Conflicts with concurrent requests for other works are prevented by
		 * rollback restoring only its own fields. The two mechanisms solve different problems.
		 */
		scope: { id: `favorite:${storyId}` },
		mutationFn: (favorited) => client.favorites.set(storyId, favorited),

		async onMutate(desired) {
			// Cancels in-flight queries first so they cannot overwrite the optimistic value. The detail is
			// cancelled for the same reason: a late response carrying a total would revert the number just
			// set.
			await Promise.all([
				queryClient.cancelQueries({ queryKey: PERSONALIZATION_QUERY_KEY }),
				queryClient.cancelQueries({ queryKey: GALLERY_QUERY_KEY_PREFIX }),
				queryClient.cancelQueries({ queryKey: detailKey }),
			]);

			const personalization = queryClient.getQueryData<PersonalizationState>(
				PERSONALIZATION_QUERY_KEY,
			);
			const wasFavorited = personalization
				? isFavorited(personalization, storyId)
				: false;

			queryClient.setQueryData<PersonalizationState>(
				PERSONALIZATION_QUERY_KEY,
				(prev) => (prev ? withFavorite(prev, storyId, desired) : prev),
			);

			/**
			 * The total moves only when the state actually changes. The server API is idempotent (it takes
			 * the desired state), so re-favoriting an already-favorited work does not raise the count.
			 * Applying plus or minus one unconditionally would show a wrong number until the response
			 * arrives. If the number was not touched, nothing is captured. Rollback rights cover only what
			 * was changed; restoring an untouched cell would erase another request's update that arrived
			 * meanwhile.
			 */
			const changesCount = wasFavorited !== desired;
			const counts = changesCount
				? captureFavoriteCounts(queryClient, storyId)
				: [];
			const detailFavorites = changesCount
				? (queryClient.getQueryData<Story>(detailKey)?.favorites ?? null)
				: null;
			if (changesCount) {
				const delta = desired ? 1 : -1;
				patchStoryEverywhere(queryClient, storyId, (s) => ({
					...s,
					// Floors at zero, so a decrement on a count that drifted to 0 in the past never shows a
					// negative number.
					favorites: Math.max(0, s.favorites + delta),
				}));
			}

			return {
				personalizationWasCached: personalization !== undefined,
				wasFavorited,
				counts,
				detailFavorites,
			};
		},

		/**
		 * The server is the final authority. If another person favorited the same work at the same time,
		 * the optimistic plus or minus one is already wrong. So the total in the response overwrites the
		 * cache as-is (it is not added again). Both the list and the detail must hold the same value, so
		 * the number does not flicker when moving between the two screens.
		 */
		onSuccess(result) {
			queryClient.setQueryData<PersonalizationState>(
				PERSONALIZATION_QUERY_KEY,
				(prev) => (prev ? withFavorite(prev, storyId, result.favorited) : prev),
			);
			patchStoryEverywhere(queryClient, storyId, (s) =>
				s.favorites === result.favorites
					? s
					: { ...s, favorites: result.favorites },
			);
			/**
			 * Neither the gallery nor the detail is refetched. The response already carries the confirmed
			 * state and total. A refetch would discard that and pull the whole list again.
			 */
		},

		/**
		 * Rollback puts back only this work's favorited state and total, on top of the current cache. It
		 * does not write back old personalization arrays, pages or work objects. Another work's mutation
		 * may have confirmed in the same object while this request was in flight, and restoring the
		 * object would erase that success. It also does not apply the opposite plus or minus one, which
		 * would skew the exact total the server returned in the meantime.
		 */
		onError(_error, _desired, snapshot) {
			if (!snapshot) return;
			// Rollback does not create a personalization cache that did not exist when the mutation started.
			// Absence stays absent.
			if (snapshot.personalizationWasCached)
				queryClient.setQueryData<PersonalizationState>(
					PERSONALIZATION_QUERY_KEY,
					(current) =>
						current
							? withFavorite(current, storyId, snapshot.wasFavorited)
							: current,
				);
			restoreFavoriteCounts(
				queryClient,
				storyId,
				snapshot.counts,
				snapshot.detailFavorites,
			);
		},
	});
}
