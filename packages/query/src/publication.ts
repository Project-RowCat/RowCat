import type { StoryPublishRequest } from "@rowcat/contracts";
import type { Story } from "@rowcat/domain";
import type { RowCatClient, StoryPublishResult } from "@rowcat/sdk";
import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { invalidateCreatorAnalytics } from "./creator-analytics.ts";
import { invalidateCreatorWorks } from "./creator-work.ts";
import {
	GALLERY_QUERY_KEY_PREFIX,
	type GalleryInfiniteData,
} from "./gallery.ts";
import { storyDetailQueryKey } from "./story.ts";

/**
 * Cache policy for publishing writes. It covers **server state** only.
 *
 * Local drafts (StoryDraft and child records) never enter this cache. Their source of truth is the
 * device's IndexedDB, and a copy here would make two sources of truth. Every draft edit would then
 * need manual invalidation, and missing one spot would show a stale value in the editor (local data
 * is observed directly through `liveQuery`).
 *
 * So this file handles the **result** of publishing: the one work the server confirmed.
 */

/**
 * Reflects the work returned by publish or update into the cache. Four steps:
 *
 * 1. Fills the detail slot with that value. Right after publishing, the screen navigates
 *    straight to `/stories/:id`. Querying again there would show a placeholder while the same value
 *    is fetched once more. The response is already authoritative, so it is planted directly.
 * 2. Invalidates the gallery. Rows are not inserted by hand. Whether a work belongs to a list is
 *    decided by the server's exposure boundary (private works are visible only to their owner), and
 *    the client copying that judgement would eventually draw private works for others. Only entries
 *    already in cache are swapped for the new value. Whether the work newly enters a list is left
 *    to the refetch.
 * 3. Invalidates the creator workspace's `Published works` list. Not patched by hand,
 *    for a different reason than the gallery. Here there is no material to build a row: the
 *    response is a public projection without `originDraftId` and `hidden` (see `creator-work.ts`).
 * 4. Invalidates creator analytics. The server is the only authority for metrics. The values
 *    cannot be invented, and inventing them would be wrong (see below).
 */
function applyPublishedStory(queryClient: QueryClient, story: Story): void {
	queryClient.setQueryData<Story>(storyDetailQueryKey(story.id), story);

	/**
	 * If this work is already in an accumulated list, replace it with the new value. (After a title
	 * change and republish, the list reached by going back would otherwise still show the old title.)
	 * Queries that do not hold it are returned as the same reference, so no needless re-render is
	 * triggered.
	 */
	queryClient.setQueriesData<GalleryInfiniteData>(
		{ queryKey: GALLERY_QUERY_KEY_PREFIX },
		(data) => {
			if (!data?.pages.some((p) => p.items.some((s) => s.id === story.id)))
				return data;
			return {
				...data,
				pages: data.pages.map((page) =>
					page.items.some((s) => s.id === story.id)
						? {
								...page,
								items: page.items.map((s) => (s.id === story.id ? story : s)),
							}
						: page,
				),
			};
		},
	);

	/**
	 * Then ask again. The position of a newly created work within the pages is decided by the sort
	 * rule (newest or popular). Imitating that calculation here would diverge from the server. Once it
	 * does, the same work could appear twice, or the last page could silently empty.
	 */
	void queryClient.invalidateQueries({ queryKey: GALLERY_QUERY_KEY_PREFIX });

	/**
	 * A first publish adds one row. Re-publishing changes title, rating and modified time. Both cases
	 * end with this same single invalidation. If the screen split the two cases, a second place would
	 * decide 'is this the first time', and that judgement would be wrong on a retry after a lost
	 * response.
	 */
	invalidateCreatorWorks(queryClient);

	/**
	 * Invalidates creator analytics too. A first publish means the work is not yet in the analytics
	 * list. A re-publish changes its title and exposure state.
	 *
	 * Not patched by hand, and the reason is stronger than for `Published works`. There the row lacked
	 * material; here inventing the material means writing **wrong values**. Inserting a new row at
	 * zero metrics would overwrite a work that already has view counts from a re-publish, and the
	 * totals would drift too. The server is always the authority for metrics.
	 */
	invalidateCreatorAnalytics(queryClient);
}

/**
 * Publish mutation. Holds only network state and cache policy.
 *
 * Writing the work id into the draft and navigating the screen are not here. Both must happen only
 * after the local scope's ownership is rechecked, because the account can change while publishing
 * runs. That judgement belongs to the app. Doing it here would make this package aware of local
 * storage and the router.
 *
 * No optimistic update either. The server can reject publishing under several policies (adult
 * eligibility, capability limits, circuit breaker). Drawing success beforehand would make the whole
 * screen something to roll back on rejection.
 */
export function publishStoryMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return mutationOptions<StoryPublishResult, Error, StoryPublishRequest>({
		mutationFn: (request) => client.stories.publish(request),
		onSuccess: (result) => {
			applyPublishedStory(queryClient, result.story);
		},
	});
}
