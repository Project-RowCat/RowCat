import type { BioUpdateDto } from "@rowcat/contracts";
import type {
	CreatorWork,
	PublicProfile,
	Story,
	StoryPage,
} from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import {
	type InfiniteData,
	infiniteQueryOptions,
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import { retryUnlessClientError } from "./retry.ts";

/**
 * Public profile server state: one profile record and the creator's public works grid.
 *
 * Splitting the two slots is the point of this file. A single query would re-send name and bio with
 * every page of works, and freshness would have to be one value even though the lifetimes differ.
 * Profiles rarely change and are the same for every viewer. The works list varies per person with
 * adult-content settings and the block list.
 *
 * The prefixes split as well. Login and logout cleanup clears only the works list (`viewer.ts`),
 * and a rename writes only the profile.
 *
 * Navigation, URL resolution and toasts are not here. This package is shared by the web app and the
 * upcoming Expo app. Even the fact that `/creators/:id` is a web address stays out of this file.
 */

/**
 * **The id is part of the key.** A single `["creators","profile"]` slot would show Alice's name and
 * bio as Bob's while Bob's profile refetches. On a screen where the person changes, that frame is
 * simply wrong.
 *
 * Keys are not built from nicknames. Display names are neither unique nor immutable, so they cannot
 * be cache identity, and renaming would put the same person into two slots.
 */
export const PUBLIC_PROFILE_QUERY_KEY_PREFIX = ["creators", "profile"] as const;

export const publicProfileQueryKey = (creatorId: string) =>
	[...PUBLIC_PROFILE_QUERY_KEY_PREFIX, creatorId] as const;

/**
 * Single public profile.
 *
 * staleTime is longer than other queries on purpose. The response is the same for everyone, and
 * name and bio do not change on a seconds scale. The server allows shared caching for the same
 * reason (`routes/creators.ts`). It is not infinite, because a name changed on another device would
 * then stay stale until this tab closes. A user's own profile needs no round trip, since the write
 * patches this slot directly (`bioMutationOptions`, `account.ts`).
 *
 * 4xx responses are not retried. A missing or deleted profile returns 404 deterministically, and
 * the same identity gets the same answer every time. Retrying would only delay `Not found` by
 * seconds (the work detail screen makes the same choice). 5xx and network errors still retry.
 */
export function publicProfileQueryOptions(
	client: RowCatClient,
	creatorId: string,
) {
	return queryOptions<PublicProfile>({
		queryKey: publicProfileQueryKey(creatorId),
		// Pass the signal through so a query abandoned by leaving the screen also stops on the network.
		queryFn: ({ signal }) => client.creators.get(creatorId, { signal }),
		staleTime: 5 * 60_000,
		retry: retryUnlessClientError,
	});
}

/**
 * Public works list for this creator. It sits apart from the profile prefix because its contents
 * differ per viewer (adult-content settings, blocks). Login and logout clear this prefix
 * (`viewer.ts`) and leave the profile slot alone.
 *
 * The page number is not in the key, same as the gallery. Page 2 is another slice of the same
 * query. Including it would throw away the accumulated list on every scroll.
 */
export const CREATOR_STORIES_QUERY_KEY_PREFIX = [
	"creators",
	"stories",
] as const;

export const creatorStoriesQueryKey = (creatorId: string) =>
	[...CREATOR_STORIES_QUERY_KEY_PREFIX, creatorId] as const;

export type CreatorStoriesInfiniteData = InfiniteData<StoryPage, number>;

/**
 * Profile work grid, appended the same way as the gallery. The query identity is just the creator
 * id, with no sort or filter axes; that is the only difference from the gallery. The route comment
 * explains why those axes are left out (a profile is not a discovery screen).
 *
 * staleTime matches the gallery on purpose. If only this one were long, a work published just now
 * would be missing from one's own profile for minutes.
 */
export function creatorStoriesInfiniteQueryOptions(
	client: RowCatClient,
	creatorId: string,
) {
	return infiniteQueryOptions<
		StoryPage,
		Error,
		CreatorStoriesInfiniteData,
		readonly unknown[],
		number
	>({
		queryKey: creatorStoriesQueryKey(creatorId),
		queryFn: ({ pageParam, signal }) =>
			client.creators.stories(creatorId, { page: pageParam }, { signal }),
		initialPageParam: 1,
		/**
		 * `undefined` marks the end. The server's `pageCount` is used as-is rather than dividing the
		 * total by the page size. When the two disagree (for example, items filtered out on the last
		 * page), the code would request a page that does not exist.
		 */
		getNextPageParam: (last) =>
			last.page < last.pageCount ? last.page + 1 : undefined,
		staleTime: 30_000,
		retry: retryUnlessClientError,
	});
}

/**
 * Flattens accumulated pages into the single list the screen draws. Same reason as the gallery:
 * this is knowledge tied to the query shape, so if `pages` ever splits, there should be one place
 * to fix.
 */
export const creatorStories = (data: CreatorStoriesInfiniteData): Story[] =>
	data.pages.flatMap((page) => page.items);

/**
 * Patches the profile slot **only if it exists**. Does not create a missing slot. `setQueryData`
 * would create one even with no observers, and the next screen that opens this profile would read
 * it as an already-present value. A value the server was never asked for would look fresh.
 *
 * Patched by hand rather than invalidated, for the round trip. If the user saves a bio while
 * viewing their own profile and the old sentence stays until a refetch, the person who just pressed
 * save would think the save did not take.
 */
function patchProfile(
	queryClient: QueryClient,
	creatorId: string,
	patch: (profile: PublicProfile) => PublicProfile,
): void {
	queryClient.setQueryData<PublicProfile>(
		publicProfileQueryKey(creatorId),
		(prev) => (prev ? patch(prev) : prev),
	);
}

/**
 * Syncs the public profile slot when the name changes. Called by the nickname write (`account.ts`).
 *
 * It lives here because this file knows the slot's shape. If the account side rebuilt the key, a
 * prefix change would fix only one side. The symptom ('renamed on another device, but my profile
 * still shows the old name') is hard to notice.
 */
export function patchPublicProfileName(
	queryClient: QueryClient,
	creatorId: string,
	displayName: string,
): void {
	patchProfile(queryClient, creatorId, (profile) => ({
		...profile,
		displayName,
	}));
}

/**
 * Syncs the public profile slot when the avatar changes. Called by the avatar write (`avatar.ts`).
 * Same reason as the name patch: this file knows the slot's shape, and keys rebuilt elsewhere would
 * diverge on a prefix change.
 *
 * `null` means no photo. Upload and delete go through the same function, so delete does not need
 * its own list of spots to fix.
 */
export function patchPublicProfileAvatar(
	queryClient: QueryClient,
	creatorId: string,
	avatarUrl: string | null,
): void {
	patchProfile(queryClient, creatorId, (profile) => ({
		...profile,
		avatarUrl,
	}));
}

/**
 * Cache policy for bio changes.
 *
 * Only **one** slot moves, which states the nature of this write. The bio is not carried on the
 * works list, gallery cards, or search results. It goes only to the public profile, so the gallery
 * and detail need no invalidation. This is what separates it from the nickname mutation
 * (`nicknameMutationOptions`), which touches three slots, because the two values are shown in
 * different places.
 *
 * No optimistic update. A bio is a single save form, and the response returns the confirmed value
 * at once. With no rollback mechanism, a failed save never shows the screen a sentence the server
 * rejected as fact.
 *
 * If the own-profile slot is not in cache (the profile screen was never opened), nothing happens.
 * That is correct: the next open fetches the new value from the server.
 */
export function bioMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	/**
	 * The owner of the slot to update. It is taken as an argument instead of read from the viewer
	 * cache, because at the moment that cache is empty (one render right after logout), a write would
	 * silently succeed without updating any slot. Callers already hold the viewer id.
	 */
	viewerId: string,
) {
	return mutationOptions<PublicProfile, Error, BioUpdateDto>({
		mutationFn: (input) => client.me.updateBio(input),
		onSuccess: (profile) => {
			/**
			 * Overwrite with the value the server confirmed. The response's `bio` is already folded to null
			 * (an empty bio), and the screen branches on that value. Writing the sent string as-is would
			 * make `""` and null diverge.
			 */
			patchProfile(queryClient, viewerId, () => profile);
		},
	});
}

/**
 * The public profile's pinned-works slot. Same nature as the works grid, but with a separate
 * prefix.
 *
 * The contents depend on the viewer (adult-content settings, blocks). Unlike the profile slot, it
 * does not survive an identity change. Logout and login clear it along with the grid (`viewer.ts`).
 *
 * It is not placed under the grid prefix (`["creators","stories",id,...]`) because of value shape.
 * Grid policies assume the paged shape (`InfiniteData`) for updates such as `dropStoryFromPages`,
 * and a single-array slot under that prefix would be handled wrongly by them. Instead, those
 * policies name this prefix explicitly (`story-lifecycle.ts`, `story-cover.ts`, `social.ts`,
 * `viewer.ts`).
 */
export const PINNED_STORIES_QUERY_KEY_PREFIX = ["creators", "pinned"] as const;

export const pinnedStoriesQueryKey = (creatorId: string) =>
	[...PINNED_STORIES_QUERY_KEY_PREFIX, creatorId] as const;

/**
 * Freshness matches the grid. If only this slot were long, another tab's own profile would show the
 * old order after the pinned works change (the same tab is invalidated by the write).
 */
export function pinnedStoriesQueryOptions(
	client: RowCatClient,
	creatorId: string,
) {
	return queryOptions<Story[]>({
		queryKey: pinnedStoriesQueryKey(creatorId),
		queryFn: ({ signal }) =>
			client.creators.pinnedStories(creatorId, { signal }),
		staleTime: 30_000,
		retry: retryUnlessClientError,
	});
}

/**
 * Pinned works I have set, read by the edit screen. Under `["viewer"]`.
 *
 * It includes pins that are currently private, so this slot can hold titles not yet public to
 * anyone. Logout clears it for the same reason as the published works list (`viewer.ts`). The
 * target member is not in the key, same as there.
 */
export const OWN_PINNED_STORIES_QUERY_KEY = [
	"viewer",
	"pinned-stories",
] as const;

export function ownPinnedStoriesQueryOptions(client: RowCatClient) {
	return queryOptions<CreatorWork[]>({
		queryKey: OWN_PINNED_STORIES_QUERY_KEY,
		queryFn: ({ signal }) => client.me.pinnedStories({ signal }),
		staleTime: 30_000,
		retry: retryUnlessClientError,
	});
}

/**
 * Pinning cache policy. The variable is the **desired final list**.
 *
 * Two slots move. The editor slot is replaced with the list the server confirms. The public slot is
 * invalidated. The public slot is not patched by hand because there is no material: the response is
 * an owner projection (`CreatorWork`) without card fields (description, tags, favorite count,
 * creator). What is visible now is decided by the server's exposure predicate. Inventing rows would
 * show a false state, where a privately pinned work appears only on one's own profile.
 *
 * No optimistic update. Saving is one button press and the response is the final value (same
 * judgement as the bio). Requests are queued. If two rapid saves ran in parallel, the one that
 * finished later would overwrite the other's result.
 */
export function pinnedStoriesMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
	/**
	 * Owner of the public slot to invalidate. Not taken from the viewer cache, for the same reason as
	 * `bioMutationOptions`.
	 */
	viewerId: string,
) {
	return mutationOptions<CreatorWork[], Error, readonly string[]>({
		scope: { id: "pinned-stories" },
		mutationFn: (storyIds) =>
			client.me.setPinnedStories({ storyIds: [...storyIds] }),
		onSuccess: (items) => {
			queryClient.setQueryData<CreatorWork[]>(
				OWN_PINNED_STORIES_QUERY_KEY,
				items,
			);
			void queryClient.invalidateQueries({
				queryKey: pinnedStoriesQueryKey(viewerId),
			});
		},
	});
}
