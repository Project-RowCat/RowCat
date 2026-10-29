import { APP_NAME } from "@rowcat/domain";
import { Toaster } from "@rowcat/ui-web/components/toast";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { RouteError, RouteNotFound } from "#/components/route-fallback.tsx";
import { AccountThemeBridge } from "#/features/theme/account-theme-bridge.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { currentLocale } from "#/lib/i18n/current.ts";
import { I18nProvider } from "#/lib/i18n/provider.tsx";
import { LocalDataScopeProvider } from "#/lib/local-data/scope.tsx";
import { SyncRuntimeProvider } from "#/lib/local-sync/provider.tsx";
import { MotionProvider } from "#/lib/motion/provider.tsx";
import { preloadViewer } from "#/lib/query/viewer-preload.ts";
import { ThemeProvider } from "#/lib/theme/provider.tsx";
import appCss from "../styles/globals.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	/**
	 * The render's locale is decided once here and read from context by the document below, so
	 * `<html lang>` and every string inside it come from the same decision. On the server it comes
	 * from the request; in the browser it is read back from the `lang` the server wrote
	 * (lib/i18n/current.ts).
	 */
	beforeLoad: () => ({ locale: currentLocale() }),
	/**
	 * The viewer is app-global state: the header needs it from the first pixel, and future routes read
	 * the same value. It is therefore filled at the root, not in the gallery.
	 *
	 * getRowCatClient() hides the environment difference (server requests carry the incoming cookie;
	 * the browser uses the shared instance), so the first SSR document is already rendered logged in
	 * and the header does not flicker from guest to member after hydration.
	 *
	 * This query must not be able to break the root, though. Throwing here would turn one transient
	 * auth failure into an error screen for every route, including the public gallery. preloadViewer
	 * keeps the success path and drops failures to guest.
	 */
	loader: ({ context }) =>
		preloadViewer(context.queryClient, getRowCatClient()),
	/**
	 * Replaces the router's two default screens here: not-found and unhandled errors. Their defaults
	 * and rationale are in the components/route-fallback.tsx header (summary: a single `Not Found`
	 * line on a black screen, and a button that expands error.message).
	 *
	 * It sits at the root so every route without its own (gallery, story detail, public profile) falls
	 * back here, and a new route cannot skip it.
	 */
	notFoundComponent: RouteNotFound,
	errorComponent: RouteError,
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				/*
				 * `interactive-widget=resizes-content` makes the layout viewport shrink when the virtual
				 * keyboard opens. With the default (resizes-visual), 100dvh ignores the keyboard, so the input
				 * of a full-height chat screen slides behind it and the characters just typed are not visible.
				 */
				content:
					"width=device-width, initial-scale=1, interactive-widget=resizes-content",
			},
			/**
			 * App default title, for routes that do not set their own. The scaffold's leftover name would
			 * otherwise ship in browser tabs and link previews.
			 */
			{
				title: APP_NAME,
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	const { locale } = Route.useRouteContext();
	return (
		/*
		 * Suppresses the hydration warning on this element only. The theme script sets this tag's class
		 * and style before React runs, by design, so the first paint is right. The suppression covers
		 * this element's attributes; mismatches inside the tree are still reported.
		 */
		<html lang={locale} suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				{/*
				 * The theme provider is outermost. Its class must be set before any inner screen
				 * renders, and the pre-execution script it injects must run before the body.
				 */}
				{/*
				 * Translations wrap everything that draws text, including the toast outlet and the
				 * route fallbacks, which render outside the app subtree.
				 */}
				<I18nProvider locale={locale}>
					<ThemeProvider defaultTheme="system" storageKey="theme">
						{/*
						 * Applies the account's custom colors to the document and renders nothing.
						 *
						 * It does not read the color scheme. The palette is single, so custom color resolution
						 * does not depend on scheme; scheme-dependent default tokens live in tokens.css.
						 *
						 * It sits at the root so the colors persist after leaving settings. Several mount
						 * points would let mount order decide which value wins. On the server it does nothing:
						 * application happens in effects, and guests never run the query.
						 */}
						<AccountThemeBridge />
						{/*
						 * Motion wraps only the app subtree. Dev tools are not product UI, and presence does
						 * not need to run there. The wrapping order does not matter since motion holds no
						 * state, but it must sit above any `m.*` use inside screens.
						 */}
						<MotionProvider>
							{/*
							 * Local data scope has app-global lifetime: it opens and closes when the viewer
							 * changes, so that decision is made once at the root, not per screen.
							 *
							 * Chat (rooms, messages) and authoring (drafts) share one database and therefore one
							 * scope. Each screen reads only its own slice through narrow adapters (useChatScope,
							 * useAuthoringScope).
							 *
							 * Activation happens only in effects, and Dexie is loaded dynamically there, so server
							 * rendering does nothing.
							 */}
							<LocalDataScopeProvider>
								{/*
								 * Auto-sync has exactly one owner, here. Per-screen sync would start once per screen on
								 * login, and which run wins would depend on mount order.
								 *
								 * It sits inside the scope because the runtime needs the open store. Guests do nothing,
								 * since the runtime is never created. Attaching browser signals happens only in
								 * effects, so it is safe during server rendering.
								 */}
								<SyncRuntimeProvider>{children}</SyncRuntimeProvider>
							</LocalDataScopeProvider>
						</MotionProvider>
						{/*
						 * The toast outlet is app-wide and deliberately outside the subtree above. Screens fire
						 * toasts through the module manager in lib/toast.ts rather than a hook, so this surface
						 * is only a leaf subscribed to that manager. Wrapping it would add a provider whose
						 * ordering would need explaining.
						 *
						 * It is also outside MotionProvider. The toast's enter and exit are already CSS in the
						 * generated component (components/toast.tsx), and two transition systems should not run
						 * over the same UI. Nothing renders on the server; the portal mounts after hydration.
						 */}
						<Toaster />
					</ThemeProvider>
				</I18nProvider>
				{/**
				 * Mounted in development builds only. The router and query panels no-op themselves in
				 * production, but the `@tanstack/react-devtools` shell does not check, and it was
				 * shipping on the production site. import.meta.env.DEV is a build constant, so the dead
				 * branch is stripped from the bundle (visual-lab.tsx uses the same pattern).
				 */}
				{import.meta.env.DEV ? (
					<TanStackDevtools
						config={{
							position: "bottom-right",
						}}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
							{
								name: "Tanstack Query",
								render: <ReactQueryDevtoolsPanel />,
							},
						]}
					/>
				) : null}
				<Scripts />
			</body>
		</html>
	);
}
