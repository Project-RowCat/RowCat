import {
	type InfiniteData,
	type UseInfiniteQueryOptions,
	useInfiniteQuery,
} from "@tanstack/react-query";
import { type NextPageState, nextPageState, pageAxes } from "./next-page.ts";
import { useQueryRetry } from "./panel-retry.ts";
import { unreachableFailure } from "./query-state.ts";
import type { AdminQuery } from "./use-admin-query.ts";

/**
 * The paginated sibling of `useAdminQuery`: same reason (a real `Try again` needs the query key, which
 * the options already hold), plus one tail, `nextPage`.
 *
 * - No cursor is exposed. It lives only in the cache cell of the query that produced it; a screen
 *   holding cursors would have to clear them on every filter change, and one that forgets reads
 *   from the middle of a different list.
 * - No progress axis is exposed beyond the `loading` state name. Passing `isFetching` through
 *   would regrow per-screen freshness rules (`boundaries.test.ts` blocks that axis).
 */
export interface AdminNextPage {
	state: NextPageState;
	/** Also retries a failed page, since its cursor is still held. */
	load: () => void;
}

export interface AdminInfiniteQuery<TData> extends AdminQuery<TData> {
	nextPage: AdminNextPage;
}

export function useAdminInfiniteQuery<TPage, TParam>(
	options: UseInfiniteQueryOptions<
		TPage,
		Error,
		InfiniteData<TPage, TParam>,
		readonly unknown[],
		TParam
	>,
): AdminInfiniteQuery<InfiniteData<TPage, TParam>> {
	const query = useInfiniteQuery(options);
	const retry = useQueryRetry(options.queryKey, query);
	const page = pageAxes(query);

	return {
		data: query.data,
		isPending: query.isPending,
		isError: page.isError,
		isPaused: query.isPaused,
		unreachable: page.isError && unreachableFailure(page.error),
		error: page.error,
		retry,
		nextPage: {
			state: nextPageState(query),
			load: () => {
				/**
				 * A double press before the button locks would fetch the same page twice, and the second
				 * response overwriting the first makes rows jump.
				 */
				if (query.isFetchingNextPage) return;
				void query.fetchNextPage();
			},
		},
	};
}
