import type { SetupStatusDto } from "@rowcat/contracts";
import type { RowCatClient } from "@rowcat/sdk";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { VIEWER_QUERY_KEY } from "./viewer.ts";

/**
 * First-run setup (`/v2/setup`). The console's login screen, forbidden screen and `/setup` read it.
 *
 * The key sits outside both `["viewer"]` and `["admin"]`: it is a fact about the deployment that
 * holds before anyone signs in, so sign-out has nothing to clear here, and under `["admin"]` the
 * console's sign-out reset would refetch it for no reason.
 *
 * No `staleTime`: the value flips exactly once, and the screens that read it are the ones where a
 * stale `open: true` would draw a code form that can only answer "already complete".
 */
export const SETUP_STATUS_QUERY_KEY = ["setup"] as const;

export const setupStatusQueryOptions = (client: RowCatClient) =>
	queryOptions<SetupStatusDto>({
		queryKey: SETUP_STATUS_QUERY_KEY,
		queryFn: ({ signal }) => client.setup.status({ signal }),
	});

/**
 * The claim. On success two cells move: setup is now closed, and the viewer's role changed. Only the
 * viewer cell itself is refetched (`exact`) — `["viewer"]` is a prefix of every per-member cache, and
 * none of those change with a role.
 *
 * Not optimistic: drawing the console before the server confirmed the role would show screens whose
 * every request answers 403.
 */
export function setupClaimMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return {
		mutationKey: ["setup", "claim"] as const,
		mutationFn: (code: string) => client.setup.claim(code),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: SETUP_STATUS_QUERY_KEY }),
				queryClient.invalidateQueries({
					queryKey: VIEWER_QUERY_KEY,
					exact: true,
				}),
			]);
		},
	};
}
