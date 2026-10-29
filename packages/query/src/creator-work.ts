import type { CreatorWork, CreatorWorkPage } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import {
	type InfiniteData,
	infiniteQueryOptions,
	type QueryClient,
} from "@tanstack/react-query";
import { retryUnlessClientError } from "./retry.ts";

/**
 * Server state of the creator workspace: the column of works the creator holds on the server.
 * Drafts are not in this query. Their source of truth is the device's IndexedDB. A copy in the
 * query cache would create two sources of truth, and every autosave that changes the database would
 * need a manual invalidation. Missing one would make the editor look like it lost typed characters.
 * Showing both lists on one screen is not a reason to merge their ownership. The prefix sits under
 * ["viewer"] because this list holds titles of works not yet public. Login and logout cleanup
 * already own that prefix, so no separate cleanup is added. Logout must reset rather than
 * invalidate, since invalidation keeps the values (`viewer.ts` holds that line). Navigation, URL
 * resolution and toasts are not here. The `?view=published` address is a web concern; the later
 * Expo app reuses this query with a different screen structure.
 */

/**
 * No target member id in the key, because there is no value to put there. This resource has no
 * per-user axis (`/me/stories`). When the viewer changes, the cell is emptied, not swapped. A
 * viewer id in the key would leave the previous user's cell alive under a different key, kept in
 * memory until that person logs in again.
 */
export const CREATOR_WORKS_QUERY_KEY_PREFIX = [
	"viewer",
	"creator-works",
] as const;

export type CreatorWorksInfiniteData = InfiniteData<CreatorWorkPage, number>;

/**
 * Works column, appended through an explicit `Show more` button rather than infinite scroll. That choice
 * belongs to the screen (a list of one's own works is not discovery), so this query is bound to
 * neither. staleTime is kept short. This list changes through writes on other screens: publishing
 * in the editor adds a row or changes a title. Publishing invalidates this prefix (publication.ts),
 * but some changes never reach that invalidation (publishing from another device, an operator
 * hiding a work), so it refetches after 30 seconds. 4xx responses are not retried. A 401 would
 * return the same answer three more times while the screen sits on a placeholder.
 */
export function creatorWorksInfiniteQueryOptions(client: RowCatClient) {
	return infiniteQueryOptions<
		CreatorWorkPage,
		Error,
		CreatorWorksInfiniteData,
		readonly unknown[],
		number
	>({
		queryKey: CREATOR_WORKS_QUERY_KEY_PREFIX,
		queryFn: ({ pageParam, signal }) =>
			client.me.stories({ page: pageParam }, { signal }),
		initialPageParam: 1,
		/**
		 * `undefined` marks the end. The total is not divided by page size; the server's pageCount is
		 * trusted directly, because a mismatch would request a page that does not exist.
		 */
		getNextPageParam: (last) =>
			last.page < last.pageCount ? last.page + 1 : undefined,
		staleTime: 30_000,
		retry: retryUnlessClientError,
	});
}

/**
 * Screens do not write `data.pages.flatMap(...)` themselves. Flattening is tied to the query's
 * shape, so if `pages` is ever split there should be a single place to change.
 */
export const creatorWorks = (data: CreatorWorksInfiniteData): CreatorWork[] =>
	data.pages.flatMap((page) => page.items);

/**
 * Server-counted total, taken from the first page. The accumulated item count is not used: it grows
 * with each `Show more` press. A section label would read `Published works 20` and climb to 40 while the user
 * scrolls, which reads as works being added.
 */
export const creatorWorksTotal = (
	data: CreatorWorksInfiniteData,
): number | null => data.pages[0]?.total ?? null;

/**
 * Refetches this list after a publish. Rows are never inserted or edited by hand. The publish
 * response is the public projection (Story), which lacks two axes this list needs: `originDraftId`
 * (the link back to the draft) and `hidden` (operator hiding). Inventing them would show the
 * just-published row without a `Edit draft` action, or show an operator-hidden work as normal.
 * Invalidation covers only this prefix. Invalidating ["viewer"] would refetch viewer,
 * personalization, notifications and account on every publish, none related to publishing.
 */
export function invalidateCreatorWorks(queryClient: QueryClient): void {
	void queryClient.invalidateQueries({
		queryKey: CREATOR_WORKS_QUERY_KEY_PREFIX,
	});
}
