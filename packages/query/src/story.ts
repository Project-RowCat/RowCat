import type { StoryPlaybackDto } from "@rowcat/contracts";
import type { Story } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { queryOptions } from "@tanstack/react-query";
import { retryUnlessClientError } from "./retry.ts";

/**
 * One work's server state: the slot the detail screen reads. It holds the same Story as the
 * gallery, so no separate detail model is built. The cache slot is still separate. Lists are
 * replaced page by page while details are looked up by id; sharing a slot would force every detail
 * open to search for the page containing the work, and a list refetch would wipe the detail. The
 * prefix is also kept apart from the gallery's, so invalidating ['stories', 'gallery'] does not
 * sweep details, and vice versa.
 */
export const STORY_DETAIL_QUERY_KEY_PREFIX = ["stories", "detail"] as const;

export const storyDetailQueryKey = (storyId: string) =>
	[...STORY_DETAIL_QUERY_KEY_PREFIX, storyId] as const;

/**
 * staleTime is above 0 for the same reason as the gallery: a value provided by SSR must not be
 * refetched right after hydration. It is not infinite, because a work's exposure can change while
 * the tab is open (going private, blocking, the adult setting). With infinity, a work that became
 * invisible would stay on screen until reload.
 *
 * The view count is not recorded here. This function also runs during SSR, prefetch and
 * revalidation, and those runs are not a person viewing the work. The screen records the view after
 * the detail is actually drawn in the browser.
 */
export function storyQueryOptions(client: RowCatClient, storyId: string) {
	return queryOptions<Story>({
		queryKey: storyDetailQueryKey(storyId),
		// The signal is passed through so a query abandoned by leaving the screen also stops on the
		// network.
		queryFn: ({ signal }) => client.stories.get(storyId, { signal }),
		staleTime: 30_000,
		/**
		 * 4xx responses are not retried. The default retry assumes a transient network failure, and a 404
		 * is not one: the server judged the work not visible to this viewer, and the same identity gets
		 * the same answer every time. Retrying would hold the screen on the placeholder, making someone
		 * who opened a missing work wait seconds before seeing 'not found'. This matters most right after
		 * logout, where a work that became invisible because the identity changed is a definite 404. In a
		 * background tab, TanStack Query holds retries, so the screen looks frozen during that interval.
		 *
		 * 5xx and network errors are still retried, since there is a value worth asking for again.
		 */
		retry: retryUnlessClientError,
	});
}

/**
 * Related-works slot, kept apart from detail and gallery. The entries are the same Story objects,
 * but the question differs: what resembles this work? Folding them into the detail slot would let a
 * detail invalidation sweep this list too; folding them into the gallery slot would make a filter
 * the identity of this list. This list can hold the viewer's own private works, so it must not
 * survive into the next person's session. The two identity-change cleanups clear this prefix by
 * name (resetStoryBodies in viewer.ts). Adult display, blocking and visibility transitions also
 * change this list, so those policies use it too.
 */
export const RELATED_STORIES_QUERY_KEY_PREFIX = ["stories", "related"] as const;

export const relatedStoriesQueryKey = (storyId: string) =>
	[...RELATED_STORIES_QUERY_KEY_PREFIX, storyId] as const;

/**
 * Same staleTime as detail. Values here change slowly through others' activity, so there is no
 * reason to ask again on every detail open. 4xx is not retried: a source the viewer cannot see is a
 * definite 404.
 */
export function relatedStoriesQueryOptions(
	client: RowCatClient,
	storyId: string,
) {
	return queryOptions<Story[]>({
		queryKey: relatedStoriesQueryKey(storyId),
		queryFn: ({ signal }) => client.stories.related(storyId, { signal }),
		staleTime: 60_000,
		retry: retryUnlessClientError,
	});
}

/**
 * Playback-response slot, kept apart from detail because the weight of the value differs. Detail is
 * discovery metadata; this slot holds the work's body (a conversation snapshot or a compiled
 * runtime artifact). Sharing a slot would let a glance at a list pull the body into the cache, and
 * a single invalidation would force a re-download of that heavy value.
 *
 * This slot holds bodies that only a paying viewer should receive, so it must not survive into the
 * next person's screen. The identity-change cleanups clear this prefix by name (resetStoryBodies in
 * viewer.ts). An earlier comment claimed logout cleared all of ['stories'], which was false; that
 * is why the cleanup names this prefix explicitly.
 */
export const STORY_PLAYBACK_QUERY_KEY_PREFIX = ["stories", "playback"] as const;

export const storyPlaybackQueryKey = (storyId: string) =>
	[...STORY_PLAYBACK_QUERY_KEY_PREFIX, storyId] as const;

/**
 * One playback response, fetched only when the playback surface mounts.
 *
 * staleTime is not infinite because of publishing. After the creator republishes, a newly opened
 * session must receive the new artifact (a running session keeps its code and is not swapped),
 * while with infinity the device would keep running the old version until the tab closed. It is not
 * short either: the value is heavy, and the playback screen has no reason to refetch in the
 * background. Opening the screen is itself the new session.
 *
 * retry follows the detail rule: eligibility verdicts (401, 403, 404, 409) get the same answer on
 * every ask, and meanwhile the screen would stay on the placeholder.
 */
export function storyPlaybackQueryOptions(
	client: RowCatClient,
	storyId: string,
) {
	return queryOptions<StoryPlaybackDto>({
		queryKey: storyPlaybackQueryKey(storyId),
		queryFn: ({ signal }) => client.stories.playback(storyId, { signal }),
		staleTime: 5 * 60_000,
		/**
		 * No background refetch. If refocusing the window re-downloaded this heavy value, the player's
		 * connection would carry requests they did not make.
		 */
		refetchOnWindowFocus: false,
		retry: retryUnlessClientError,
	});
}
