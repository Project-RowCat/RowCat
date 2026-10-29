import type { CreatorWork, Story } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import {
	CREATOR_WORKS_QUERY_KEY_PREFIX,
	type CreatorWorksInfiniteData,
} from "./creator-work.ts";
import {
	GALLERY_QUERY_KEY_PREFIX,
	type GalleryInfiniteData,
} from "./gallery.ts";
import {
	CREATOR_STORIES_QUERY_KEY_PREFIX,
	type CreatorStoriesInfiniteData,
	OWN_PINNED_STORIES_QUERY_KEY,
	PINNED_STORIES_QUERY_KEY_PREFIX,
} from "./profile.ts";
import { storyDetailQueryKey } from "./story.ts";

/**
 * Cache policy for cover writes. The server returns the work after the change, so this file only
 * seats that value into slots that already hold the work. No cache-busting URL is built here:
 * coverUrl already carries content identity (?v=<hash>), so the browser fetches the new image as
 * soon as the cache holds the new value.
 *
 * - No invalidation. Publishing invalidates gallery, own-works and analytics because the
 *   membership and order of those lists change. A cover swap changes neither, so a refetch is pure
 *   waste that no error reveals.
 * - No slot is created. Each patch changes only slots that already hold a value. This matters
 *   most for detail: the owner projection includes archived and hidden works, whose public detail
 *   returns 404.
 */

/**
 * Replaces one work with the new value inside the appended pages. A query without the work keeps
 * the same reference: a new array would needlessly re-render that slot's cards, and a slot never
 * cached would be born with no observer.
 */
function replaceStoryInPages<TData extends GalleryInfiniteData>(
	data: TData | undefined,
	story: Story,
): TData | undefined {
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
}

/**
 * Copies only the new cover address into one row of the own-works list, rather than replacing the
 * row with the response. The two projections are different types: the response is a Story without
 * originDraftId, hidden or the three-valued visibility. Rebuilding the row from it would make only
 * the just-changed work lose `Edit draft`, or show an archived work as public. The cover change moves
 * exactly one axis, so exactly one field is copied.
 */
function patchCreatorWorkCover(
	data: CreatorWorksInfiniteData | undefined,
	storyId: string,
	coverUrl: string | null,
): CreatorWorksInfiniteData | undefined {
	const matches = (work: CreatorWork) =>
		work.id === storyId && work.coverUrl !== coverUrl;
	if (!data?.pages.some((p) => p.items.some(matches))) return data;
	return {
		...data,
		pages: data.pages.map((page) =>
			page.items.some(matches)
				? {
						...page,
						items: page.items.map((work) =>
							matches(work) ? { ...work, coverUrl } : work,
						),
					}
				: page,
		),
	};
}

/**
 * Applies the server-confirmed work to every slot that holds it. It is exported because the cover
 * is not only set by the two mutations below: the publish path uploads a cover too (the one chosen
 * in the editor goes up with publishing), and that path learns the work id only at execution time,
 * while the mutation factory takes the id when it is built, so it cannot be used there. Writing the
 * policy again on that side would miss one of the four slots: the gallery card, the work detail,
 * the public profile's work grid and the creator workspace row. The profile grid is the easy one to
 * miss, and a user who has their profile open keeps the old image there.
 */
export function applyStoryCover(queryClient: QueryClient, story: Story): void {
	queryClient.setQueriesData<GalleryInfiniteData>(
		{ queryKey: GALLERY_QUERY_KEY_PREFIX },
		(data) => replaceStoryInPages(data, story),
	);
	queryClient.setQueriesData<CreatorStoriesInfiniteData>(
		{ queryKey: CREATOR_STORIES_QUERY_KEY_PREFIX },
		(data) => replaceStoryInPages(data, story),
	);
	queryClient.setQueryData<Story>(storyDetailQueryKey(story.id), (prev) =>
		prev ? story : prev,
	);
	queryClient.setQueriesData<CreatorWorksInfiniteData>(
		{ queryKey: CREATOR_WORKS_QUERY_KEY_PREFIX },
		(data) => patchCreatorWorkCover(data, story.id, story.coverUrl),
	);
	/**
	 * Pinned-work slots: the top of the public profile and the edit list on the account screen. Fixing
	 * only the grid would show the same work with different covers within one screen.
	 */
	queryClient.setQueriesData<Story[]>(
		{ queryKey: PINNED_STORIES_QUERY_KEY_PREFIX },
		(stories) =>
			stories?.some((item) => item.id === story.id)
				? stories.map((item) => (item.id === story.id ? story : item))
				: stories,
	);
	queryClient.setQueryData<CreatorWork[]>(
		OWN_PINNED_STORIES_QUERY_KEY,
		(prev) =>
			prev?.some((work) => work.id === story.id)
				? prev.map((work) =>
						work.id === story.id ? { ...work, coverUrl: story.coverUrl } : work,
					)
				: prev,
	);
}

/**
 * Uploads or replaces a cover. No optimistic update: the server can reject the request for several
 * reasons (format, size, resolution, ownership, sanction), and even on success the URL to show is
 * the identity of the server's normalized result, which cannot be invented in advance. Previewing
 * the chosen file is the screen's own local state; only this response promotes it to the work's
 * cover.
 *
 * scope is the work id so that two replacements of the same work finish in order. Run side by side,
 * a later request could finish first and the cache would settle on the old cover. The server's
 * final state is set by the last commit, so only the screen would be wrong, and it would stay wrong
 * until reload.
 */
export function setStoryCoverMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	storyId: string,
) {
	return mutationOptions<Story, Error, Blob>({
		scope: { id: `story-cover:${storyId}` },
		mutationFn: (image) => client.stories.setCover(storyId, image),
		onSuccess: (story) => {
			applyStoryCover(queryClient, story);
		},
	});
}

/**
 * Deletes a cover. Not optimistic, because the rollback is costly: on failure, what must be revived
 * is the value sitting in all four slots, not one address, and if another device uploaded a new
 * cover meanwhile, the revived value is already wrong. Showing a cover as gone when it was not
 * deleted is worse than a deleted cover lingering briefly.
 */
export function removeStoryCoverMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	storyId: string,
) {
	return mutationOptions<Story, Error, void>({
		scope: { id: `story-cover:${storyId}` },
		mutationFn: () => client.stories.removeCover(storyId),
		onSuccess: (story) => {
			applyStoryCover(queryClient, story);
		},
	});
}
