import { QueryClient } from "@tanstack/react-query";

/**
 * The server-state cache. **Local-first data does not come here.**
 *
 * This app has two sources of truth with non-overlapping boundaries:
 *
 * ```text
 * conversations · drafts      SQLite is the source of truth. The server holds only ciphertext we cannot open
 * works · comments · notices  the server is the source of truth. This is its cache
 * ```
 *
 * Rooms and drafts are not cached here for convenience. Doing so creates two truths that always
 * diverge, and if the diverged copy is what the screen draws, the user reads their own text as
 * gone.
 *
 * **No persistence is attached** (#76). Anything needed offline is already in SQLite, and
 * persisting the server cache to disk is a separate product decision about when it is invalidated.
 */
export const createMobileQueryClient = (): QueryClient =>
	new QueryClient({
		defaultOptions: {
			queries: {
				/**
				 * Mobile returns to the foreground often. Refetching on every window focus would send a request
				 * each time the phone comes out of a pocket, so freshness is set per screen.
				 */
				staleTime: 30_000,
				retry: 2,
			},
		},
	});
