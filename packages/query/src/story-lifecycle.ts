import type { StoryLifecycleAction } from "@rowcat/contracts";
import type { CreatorWork, Story } from "@rowcat/domain";
import { isStoryDiscoverable, STORY_LIFECYCLE_RESULT } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { invalidateCreatorAnalytics } from "./creator-analytics.ts";
import {
	CREATOR_WORKS_QUERY_KEY_PREFIX,
	type CreatorWorksInfiniteData,
	invalidateCreatorWorks,
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
import {
	RELATED_STORIES_QUERY_KEY_PREFIX,
	storyDetailQueryKey,
} from "./story.ts";

/**
 * Cache policy for lifecycle transitions. It differs from both publish and cover:
 * - Publish changes the work's content, which moves list membership and order: invalidate.
 * - Cover changes one image: membership and order stay, so cached slots are patched in place.
 * - A lifecycle transition changes exposure, which flips discovery membership: remove the work
 *   from the lists, then invalidate.
 *
 * The last line is the point of this file. Withdrawing or archiving must remove the work from the
 * lists on screen immediately; invalidation alone would keep it in the gallery until refetch, and
 * the user would read their button as doing nothing. Publishing back does not insert the work: the
 * server's exposure boundary and sort decide where it lands, and imitating that would show
 * duplicates or silently empty the last page.
 *
 * The destination comes from the operation, not the response. The public projection now carries the
 * canonical visibility but it is not read here. The archive response arrives through the owner
 * projection, and deriving the destination from it would rely on how the server reads responses.
 * The destination comes from STORY_LIFECYCLE_RESULT in the domain, the postcondition of each
 * endpoint.
 *
 * hidden is not touched. The row patches only visibility, and the server never writes the
 * operator-hide column, so the cache keeps it as it is.
 */

/**
 * Removes the work from the appended public list and reduces the total too. The total is reduced so
 * the `N stories` count in the toolbar does not disagree with the list. The server returns the exact total
 * on the next page, so until then this is an approximation, which is still more accurate than
 * keeping 24 while drawing 23 cards (blocking made the same call).
 */
function dropStoryFromPages<TData extends GalleryInfiniteData>(
	data: TData | undefined,
	storyId: string,
): TData | undefined {
	// A slot without the work is left alone. Returning the same reference keeps that query as it is.
	if (!data?.pages.some((p) => p.items.some((s) => s.id === storyId)))
		return data;
	return {
		...data,
		pages: data.pages.map((page) => {
			const items = page.items.filter((s) => s.id !== storyId);
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
 * Copies only the new exposure state into one row of the own-works list, rather than replacing the
 * row with the response. The two projections are different types: the response is a Story without
 * originDraftId or hidden. Rebuilding the row from it would make only the just-changed work lose
 * `Edit draft`, or drop the `operator hiding` badge. This action moves exactly one axis, so exactly one field is
 * copied.
 *
 * The reason is correctness, not speed. The row's action set is derived from the state
 * (storyLifecycleActions), so invalidation alone would leave a `archive` button on a just-archived work
 * until refetch, and pressing it again would do nothing.
 */
function patchCreatorWorkVisibility(
	data: CreatorWorksInfiniteData | undefined,
	storyId: string,
	visibility: CreatorWork["visibility"],
): CreatorWorksInfiniteData | undefined {
	const matches = (work: CreatorWork) =>
		work.id === storyId && work.visibility !== visibility;
	if (!data?.pages.some((p) => p.items.some(matches))) return data;
	return {
		...data,
		pages: data.pages.map((page) =>
			page.items.some(matches)
				? {
						...page,
						items: page.items.map((work) =>
							matches(work) ? { ...work, visibility } : work,
						),
					}
				: page,
		),
	};
}

/**
 * Cache cleanup after a transition succeeds, per slot:
 * - Own-works row: copies the exposure state, then asks again (there is nothing to build a row
 *   from).
 * - Gallery and profile grid: a withdrawing transition removes the work at once, and the slot is
 *   always asked again. The profile grid is an easy slot to miss.
 * - Work detail: archiving drops it, because the server now returns 404; otherwise only the
 *   cached value is replaced.
 * - Creator analytics: asked again, since that screen draws the exposure state too.
 *
 * Detail uses resetQueries because that query is a useSuspenseQuery. removeQueries would leave the
 * component waiting on it with no observer, stuck on the placeholder. Resetting drops the value
 * while keeping the mounted query alive.
 *
 * Keeping the detail on a private transition is intentional. The owner still sees the work
 * (ownPrivateVisible), and the person acting is that owner. The link-public case is more so: the
 * address stays open to everyone, so the cached value is not stale either.
 */
export function applyStoryLifecycle(
	queryClient: QueryClient,
	story: Story,
	action: StoryLifecycleAction,
): void {
	const visibility = STORY_LIFECYCLE_RESULT[action];
	/**
	 * Transitions that remove the work from discovery surfaces. The work must leave the list on screen
	 * at once. `Link only` (link-public) is included: that state opens in detail but appears in no
	 * gallery, search or public profile, so a card left in a list would make the button look inert.
	 * The predicate lives in the domain, because a !== 'public' check would lose track of the question
	 * it answers as the vocabulary grows.
	 */
	const withdrawn = !isStoryDiscoverable(visibility);

	queryClient.setQueriesData<CreatorWorksInfiniteData>(
		{ queryKey: CREATOR_WORKS_QUERY_KEY_PREFIX },
		(data) => patchCreatorWorkVisibility(data, story.id, visibility),
	);
	/**
	 * The own pinned-work slot's exposure state is set to the same value, since the edit screen says
	 * 'not shown on the profile' along that axis. The pin itself stays: the transition does not clear
	 * it.
	 */
	queryClient.setQueryData<CreatorWork[]>(
		OWN_PINNED_STORIES_QUERY_KEY,
		(prev) =>
			prev?.some((work) => work.id === story.id)
				? prev.map((work) =>
						work.id === story.id ? { ...work, visibility } : work,
					)
				: prev,
	);

	if (withdrawn) {
		queryClient.setQueriesData<GalleryInfiniteData>(
			{ queryKey: GALLERY_QUERY_KEY_PREFIX },
			(data) => dropStoryFromPages(data, story.id),
		);
		queryClient.setQueriesData<CreatorStoriesInfiniteData>(
			{ queryKey: CREATOR_STORIES_QUERY_KEY_PREFIX },
			(data) => dropStoryFromPages(data, story.id),
		);
		/**
		 * Pinned slots are part of the public profile too, so a withdrawn work does not remain at the
		 * top.
		 */
		queryClient.setQueriesData<Story[]>(
			{ queryKey: PINNED_STORIES_QUERY_KEY_PREFIX },
			(stories) =>
				stories?.some((item) => item.id === story.id)
					? stories.filter((item) => item.id !== story.id)
					: stories,
		);
		/**
		 * Related works are a discovery surface too, so a withdrawn card does not stay below another
		 * work's detail.
		 */
		queryClient.setQueriesData<Story[]>(
			{ queryKey: RELATED_STORIES_QUERY_KEY_PREFIX },
			(stories) =>
				stories?.some((item) => item.id === story.id)
					? stories.filter((item) => item.id !== story.id)
					: stories,
		);
	}

	if (visibility === "archived")
		void queryClient.resetQueries({ queryKey: storyDetailQueryKey(story.id) });
	else
		queryClient.setQueryData<Story>(storyDetailQueryKey(story.id), (prev) =>
			prev ? story : prev,
		);

	/**
	 * Then asks again. Where a newly public work lands in these lists is decided by the sort rule.
	 * Imitating that here would mismatch the server the moment it differs, showing the same work twice
	 * or silently emptying the last page.
	 */
	void queryClient.invalidateQueries({ queryKey: GALLERY_QUERY_KEY_PREFIX });
	void queryClient.invalidateQueries({
		queryKey: CREATOR_STORIES_QUERY_KEY_PREFIX,
	});
	/** A pin made public again returns to its place; the server's order decides that place. */
	void queryClient.invalidateQueries({
		queryKey: PINNED_STORIES_QUERY_KEY_PREFIX,
	});
	invalidateCreatorWorks(queryClient);
	/**
	 * Analytics is asked again too, because that list draws `visibility` alongside its figures. The
	 * metrics do not change with this action (the server does not touch the counters), so they are not
	 * patched by hand: inventing inputs would write wrong values.
	 */
	invalidateCreatorAnalytics(queryClient);
}

/**
 * Maps an operation to its SDK call. The vocabulary lives in one place, so the screen does not
 * carry strings around.
 */
const runLifecycle = (
	client: RowCatClient,
	storyId: string,
	action: StoryLifecycleAction,
): Promise<Story> => {
	switch (action) {
		case "publish":
			return client.stories.makePublic(storyId);
		case "unlist":
			return client.stories.makeUnlisted(storyId);
		case "unpublish":
			return client.stories.makePrivate(storyId);
		case "archive":
			return client.stories.archive(storyId);
		case "restore":
			return client.stories.restore(storyId);
	}
};

/**
 * Lifecycle transition mutation. The variable is the name of the operation.
 *
 * No optimistic update. The server can reject the request for several reasons (ownership,
 * eligibility, blocker, forbidden transition). A falsehood drawn here would be 'this work is no
 * longer public', which someone may trust and leave on. The opposite falsehood ('now public') would
 * be worse.
 *
 * scope is the work id so that two transitions on the same work finish in order. Run side by side,
 * a later request could finish first and the cache would settle on the old state. The server's
 * final state is set by the last commit, so a screen left mismatched would persist until reload.
 */
export function storyLifecycleMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	storyId: string,
) {
	return mutationOptions<Story, Error, StoryLifecycleAction>({
		scope: { id: `story-lifecycle:${storyId}` },
		mutationFn: (action) => runLifecycle(client, storyId, action),
		onSuccess: (story, action) => {
			applyStoryLifecycle(queryClient, story, action);
		},
	});
}
