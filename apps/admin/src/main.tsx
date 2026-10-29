import { APP_NAME } from "@rowcat/domain";
import { Toaster } from "@rowcat/ui-web/components/toast";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createAdminRouter } from "#/app/router.tsx";
import { MotionProvider } from "#/lib/motion/provider.tsx";
import { ThemeProvider } from "#/lib/theme.tsx";
import "#/styles/globals.css";

/**
 * The tab title carries the product name from the one place a fork renames it. `index.html` holds
 * only the generic part, because a static file cannot import `APP_NAME`; the console has no SSR, so
 * the title is set once before the first render.
 */
document.title = `${APP_NAME} Operations console`;

/**
 * `retry: 1` diverges from the web: these are operations screens a person watches, and during
 * incident response "it failed" should appear quickly rather than after three silent retries.
 * `refetchOnWindowFocus` is the same axis — operators leave tabs open and act on what they see when
 * they come back.
 */
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			refetchOnWindowFocus: true,
			/**
			 * Never pause offline. Under the default (`online`) a query the browser judges offline stays
			 * `pending`, which reads as endless loading and is indistinguishable from a dead server; sending
			 * the request and showing the failure is clearer.
			 */
			networkMode: "always",
		},
		mutations: { networkMode: "always" },
	},
});

const router = createAdminRouter(queryClient);

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing");

createRoot(root).render(
	<StrictMode>
		{/*
		 * Theme is outermost so the class is set before any screen renders. Motion's position
		 * only needs to be above any `m.*` usage.
		 */}
		<ThemeProvider>
			<MotionProvider>
				<QueryClientProvider client={queryClient}>
					<RouterProvider router={router} />
				</QueryClientProvider>
			</MotionProvider>
			{/*
			 * This app needs its own toaster: the web's root does nothing here (separate document,
			 * separate manager instance), and without it `showErrorToast` silently draws nothing.
			 * It sits outside `MotionProvider` as on the web: the toast animates in CSS, and two
			 * transition systems must not run over the same UI.
			 */}
			<Toaster />
		</ThemeProvider>
	</StrictMode>,
);
