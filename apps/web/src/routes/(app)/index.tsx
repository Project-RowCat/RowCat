import {
	APP_NAME,
	filtersForViewer,
	type GalleryFilters,
} from "@rowcat/domain";
import { galleryInfiniteQueryOptions } from "@rowcat/query";
import type { RowCatClient } from "@rowcat/sdk";
import type { QueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GalleryError } from "#/features/gallery/gallery-error.tsx";
import { GalleryPage } from "#/features/gallery/gallery-page.tsx";
import { GalleryShell } from "#/features/gallery/gallery-shell.tsx";
import { GallerySkeleton } from "#/features/gallery/gallery-skeleton.tsx";
import {
	filtersFromSearch,
	validateGallerySearch,
} from "#/features/gallery/search.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";
import {
	preloadPersonalization,
	preloadViewer,
} from "#/lib/query/viewer-preload.ts";

/**
 * Fills the list. The server waits, and the browser only starts the fetch.
 *
 * The reason is in the caller's comment. It is a separate function because this branch would be
 * unreadable inside a Promise.all element slot.
 */
function loadGallery(
	queryClient: QueryClient,
	client: RowCatClient,
	filters: GalleryFilters,
): Promise<unknown> | undefined {
	const options = galleryInfiniteQueryOptions(client, filters);
	if (typeof window === "undefined")
		return queryClient.ensureInfiniteQueryData(options);
	/**
	 * A failure is rethrown when the component's suspense query meets it again, and it reaches the
	 * error boundary.
	 */
	void queryClient.prefetchInfiniteQuery(options);
	return undefined;
}

/**
 * Home = discovery (the gallery).
 *
 * The route stays thin: URL parsing, prefetching, and connecting the boundary component are its
 * only jobs. The screen belongs to features/gallery.
 *
 * The loader and the component use the same galleryInfiniteQueryOptions, so the component reads the
 * cache entry the server filled. The loader runs on the server for the first entry and in the
 * browser for later navigations. getRowCatClient() absorbs the difference: on the server it returns
 * a client carrying the current request's Cookie, and in the browser the shared client. There is
 * one query definition; only the transport credentials differ.
 */
export const Route = createFileRoute("/(app)/")({
	validateSearch: validateGallerySearch,
	// Every axis that changes the query is a dependency. If one is missing, the loader does not re-run
	// when the URL changes.
	loaderDeps: ({ search }) => search,
	/**
	 * A card's heart must already be filled when the list arrives. That requires personalization state
	 * to be included in the server-render cache, which only matters for logged-in users.
	 *
	 * The viewer and the list are fetched together, since neither needs to wait for the other. Only
	 * personalization waits for the viewer, and guests never receive it. The server would return an
	 * empty array to guests anyway, and that round trip would only delay a guest's first screen.
	 *
	 * It looks wasteful to require the viewer here when the root has already filled it, but it is not.
	 * Queries with the same key are merged by Query. Do not coordinate this by hand outside Query.
	 *
	 * The two have different weight. If the list fails, there is nothing to draw, so it throws
	 * straight to the error screen. The viewer and personalization are supplementary to this screen.
	 * If they fail but the list arrived, the public gallery must still render: the hearts are empty
	 * and the header simply looks like a guest's.
	 */
	loader: async ({ context, deps }) => {
		const client = getRowCatClient();
		const { queryClient } = context;
		const requested = filtersFromSearch(deps);

		/**
		 * Waits for the viewer first only in the following-feed case.
		 *
		 * That axis is valid only for members (the server returns 401 to guests), so the identity must be
		 * known before the query is built. If it were sent without knowing, a guest who opened that link
		 * would see the whole gallery turn into an error screen. In other cases the order is not changed,
		 * because they are the dominant path: there is no reason to delay the first bytes of the
		 * discovery screen behind a viewer round trip.
		 */
		const early = requested.followingOnly
			? await preloadViewer(queryClient, client)
			: null;
		const filters = requested.followingOnly
			? filtersForViewer(requested, early !== null)
			: requested;

		const [viewer] = await Promise.all([
			// If the viewer was already started above, reuse that value. Same key, so it is not fetched
			// twice.
			requested.followingOnly
				? Promise.resolve(early)
				: preloadViewer(queryClient, client),
			/**
			 * This is an accumulating query, so ensureInfiniteQueryData is used. Only the first page is
			 * fetched on the server. Something like `pages: 2` would add twenty-four items that are not
			 * visible on the first screen to the HTML. The browser appends the rest as the user scrolls.
			 *
			 * The browser does not wait for this query. That difference protects search. If the loader
			 * waited, the route would become pending, and after defaultPendingMs (200 ms) the router would
			 * swap the whole screen for pendingComponent. But search and filter changes are also navigations
			 * of the same route. On slow connections, the input the user is typing into would turn into a
			 * grey bar and focus would fall to body. (Reproduced on 3G: about 240 ms after submit, the input
			 * left the layout, and typing afterward went nowhere.) By not waiting, the route does not enter
			 * pending, and the boundary inside the screen swaps only the grid (gallery-page.tsx).
			 *
			 * On the server it does wait. The decision that the first HTML carries the list is this
			 * screen's. Without that, the discovery screen would have content only after JavaScript arrives.
			 * In that case there is nothing on screen yet, so the placeholder should draw the toolbar too.
			 */
			loadGallery(queryClient, client, filters),
		]);
		if (viewer) await preloadPersonalization(queryClient, client);
	},
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.discover", { app: APP_NAME }) },
			{
				name: "description",
				content: translator("shell")("titles.discoverDescription", {
					app: APP_NAME,
				}),
			},
		],
	}),
	component: GalleryPage,
	pendingComponent: () => (
		<GalleryShell>
			<GallerySkeleton />
		</GalleryShell>
	),
	errorComponent: ({ error, reset }) => (
		<GalleryShell>
			<GalleryError error={error} reset={reset} />
		</GalleryShell>
	),
});
