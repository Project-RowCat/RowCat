import { loadingDelayMs } from "@rowcat/design";
import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	// Creates a new client per request. At module scope during SSR, another request's cache would get
	// mixed in.
	const context = { queryClient: new QueryClient() };

	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		/**
		 * The waiting policy lives in this one place. Setting pendingMs per route would make the number
		 * look like a property of the screen, but what varies is how fast the data arrives, not the
		 * screen. The same gallery takes 0 ms from cache and 2 s on 3G. The threshold depends on how
		 * people perceive waiting, so the whole app uses one value. A route overrides it only when the
		 * meaning differs (none does today).
		 *
		 * The values come from loadingDelayMs in @rowcat/design, where the reasoning is recorded. The
		 * router defaults are 1000 and 500 ms. One second is long enough to feel like a dropped click.
		 *
		 * These two settings cover only loader waiting. Waiting in screens without server loaders (chat,
		 * creation: hydration, bundles, IndexedDB) belongs to Suspense and the screen's own state. There,
		 * it is already certain that data is missing, so there is no reason to delay.
		 */
		defaultPendingMs: loadingDelayMs.appear,
		defaultPendingMinMs: loadingDelayMs.minVisible,
	});

	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
