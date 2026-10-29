import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import {
	ClientOnly,
	createFileRoute,
	Outlet,
	useRouterState,
} from "@tanstack/react-router";
import { lazy, Suspense, useMemo } from "react";
import { AppShell } from "#/components/app-shell/app-shell.tsx";
import {
	type ShellContext,
	shellContextKey,
	shellRouteFor,
} from "#/components/app-shell/shell-route.ts";
import {
	AppGatePanel,
	useAppGate,
} from "#/features/onboarding/membership-gate.tsx";
import { UpdateNotesProvider } from "#/features/updates/update-notes-provider.tsx";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Builds the app shell once. The sidebar and header persist across route changes instead of
 * remounting per screen. Per-screen headers would remount on every change, resetting viewer
 * subscriptions, menus and focus.
 *
 * The sidebar's recent-conversations liveQuery subscribes once while the app is in use; per-screen
 * shells would resubscribe to IndexedDB on every route change.
 *
 * Context is derived from the router's matched route, not registered by screens in effects.
 * Effect-based registration causes one-frame-late titles, stale actions during navigation,
 * StrictMode duplicates and SSR mismatches.
 *
 * Login is outside this group and gets no shell; otherwise the header's login button would point at
 * itself (routes/login.tsx).
 */
export const Route = createFileRoute("/(app)")({
	component: AppLayout,
});

/**
 * Workspace context loads only in the browser. Conversation and draft titles come from IndexedDB,
 * and that subscription hook statically imports Dexie. Rendering it on the server would pull Dexie
 * into the server bundle and break the ClientOnly and lazy boundaries that the chat and create
 * routes set up.
 *
 * ClientOnly blocks rendering and lazy blocks loading.
 *
 * The sidebar's recent-conversation list uses the same boundary, but handles it inside
 * app-sidebar.tsx, since that list is the sidebar's fixed information design.
 */
const ChatHeaderContext = lazy(() =>
	import("#/features/chat/chat-header-context.tsx").then((module) => ({
		default: module.ChatHeaderContext,
	})),
);
const DraftHeaderContext = lazy(() =>
	import("#/features/create/editor/header-context.tsx").then((module) => ({
		default: module.DraftHeaderContext,
	})),
);
/**
 * The runtime playback context uses the same boundary. Its title comes from the server (story
 * catalog), so it does not import Dexie. But its initialization trigger is bridged to the canvas
 * playback lifecycle, which only means something in the browser; there is no canvas on the server.
 */
const RuntimeChatHeaderContext = lazy(() =>
	import("#/features/runtime-player/runtime-chat-header-context.tsx").then(
		(module) => ({ default: module.RuntimeChatHeaderContext }),
	),
);

function AppLayout() {
	/**
	 * The router's match decides the shell, and the list is destination-first. During a navigation the
	 * match already points at the destination, and only a pending loader draws its placeholder.
	 *
	 * So during a slow transition from a conversation to account, the header never keeps the old
	 * room's title or its settings trigger. The canvas may stay a placeholder for a moment, but header
	 * actions run real operations when pressed, so a departed screen's actions must not remain.
	 */
	const matches = useRouterState({ select: (state) => state.matches });
	const shell = useMemo(() => shellRouteFor(matches), [matches]);
	const context = shell.context;

	/**
	 * Entry gate, rendered in place of the shell rather than inside it. The two gates (age, guardian
	 * consent) share one slot, and the server decides priority (resolveMembershipGate). Rendering
	 * inside the shell kept the header and sidebar in the DOM, which left invisible tab stops and sent
	 * notification queries for users the gate was holding.
	 *
	 * Public documents pass through. That decision lives in shell-route.ts, not in the gate, because a
	 * gate that checks paths itself would miss routes added later and answer a public page with the
	 * gate.
	 */
	const gate = useAppGate();
	if (gate !== null && !shell.publicDocument)
		return <AppGatePanel gate={gate} />;

	/*
	 * Entry motion is not here. PageEnter wraps each screen's body, so the sidebar and header stay
	 * still and only the arriving canvas animates. The space persists while its content changes.
	 */
	const outlet = <Outlet />;

	/*
	 * Read state for the update notice is resolved once here, not per surface. The header bell dot,
	 * the popover's `Updates` tab, the notifications page's tab and the list rows would otherwise each
	 * read localStorage and go stale independently.
	 *
	 * An earlier version opened a notes dialog automatically on entry. It was removed because release
	 * news is neither consent nor acknowledgement, so it must not act as a gate. The provider draws
	 * nothing unless a notice is selected, and only a user click opens one
	 * (features/updates/update-notes-provider.tsx).
	 *
	 * The minimum-supported-version alert (app_update) is server-owned and unchanged.
	 */
	return (
		<UpdateNotesProvider>
			<AppShell
				shell={shell}
				headerContext={
					context ? <WorkspaceHeaderContext context={context} /> : null
				}
			>
				{outlet}
			</AppShell>
		</UpdateNotesProvider>
	);
}

/**
 * Keyed on the resource identity. The open state of the room settings dialog lives in this subtree,
 * so keying by room id resets it when the room changes. Otherwise the previous room's settings
 * dialog would stay open over the new room. No effect is needed to close it.
 */
function WorkspaceHeaderContext({ context }: { context: ShellContext }) {
	const fallback = <WorkspaceContextFallback context={context} />;
	return (
		<ClientOnly key={shellContextKey(context)} fallback={fallback}>
			<Suspense fallback={fallback}>
				{context.kind === "chat" ? (
					<ChatHeaderContext roomId={context.roomId} />
				) : context.kind === "draft" ? (
					<DraftHeaderContext draftId={context.draftId} />
				) : (
					<RuntimeChatHeaderContext storyId={context.storyId} />
				)}
			</Suspense>
		</ClientOnly>
	);
}

/**
 * Fallback for the workspace context before the browser part loads. A blank slot would make the
 * header jump after hydration, so a fixed label holds the geometry. The title exists only on this
 * device; the server cannot know it.
 */
function WorkspaceContextFallback({ context }: { context: ShellContext }) {
	/**
	 * The runtime playback title comes from the server and arrives shortly, so the fallback must not
	 * say `Conversation` (this screen is not a conversation room). A placeholder bar holds the geometry until
	 * the browser part replaces it with a bar of the same width (runtime-chat-header-context.tsx).
	 */
	if (context.kind === "runtime")
		return <Skeleton className="h-4 w-24 rounded" aria-hidden="true" />;
	return (
		<span className="truncate text-sm font-medium">
			{context.kind === "chat"
				? translator("shell")("header.chat")
				: translator("shell")("header.draft")}
		</span>
	);
}
