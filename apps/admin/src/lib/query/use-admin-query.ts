import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import { useQueryRetry } from "./panel-retry.ts";
import { unreachableFailure } from "./query-state.ts";

/**
 * The one door operations screens use to read server state. `useQuery` is not called directly
 * because a working `Try again` needs the query key (a paused retryer is discarded via `resetQueries`);
 * if screens passed it separately, one of a dozen would miss it and still type-check and render.
 * Using the key the options already hold makes that mistake inexpressible.
 *
 * Only the axes `QueryState` reads plus `retry` are returned — exposing `isFetching` or
 * `isRefetching` would let each screen grow its own freshness rule.
 */
export interface AdminQuery<TData> {
	data: TData | undefined;
	isPending: boolean;
	isError: boolean;
	isPaused: boolean;
	/** Whether the failure never reached the server — the axis that picks the copy. */
	unreachable: boolean;
	error: unknown;
	/** Actually retries when pressed (`panel-retry.ts`). */
	retry: () => void;
}

export function useAdminQuery<TData>(
	options: UseQueryOptions<TData, Error, TData, readonly unknown[]>,
): AdminQuery<TData> {
	const query = useQuery(options);
	const retry = useQueryRetry(options.queryKey, query);

	return {
		data: query.data,
		isPending: query.isPending,
		isError: query.isError,
		isPaused: query.isPaused,
		/** False while there is no error, so a past failure never speaks for current freshness. */
		unreachable: query.isError && unreachableFailure(query.error),
		error: query.error,
		retry,
	};
}
