import { APP_NAME } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { ClientOnly, createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ChatLibraryShell } from "#/features/chat-library/chat-library-shell.tsx";
import { ChatLibrarySkeleton } from "#/features/chat-library/chat-library-skeleton.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Chat list: a screen where the server knows nothing.
 *
 * There is no loader. Rooms are in this device's IndexedDB, not in PostgreSQL, so the server has
 * nothing to pre-fetch. Same boundary as the draft list and the chat screen.
 *
 * The body is wrapped in ClientOnly. The server draws only the frame, and the list is filled in by
 * the browser after hydration. Rendering on the server would crash in environments without
 * IndexedDB or, worse, put chat titles into the server HTML. A chat title belongs to the user alone
 * and must not appear in server logs either.
 *
 * lazy blocks loading as well. ClientOnly alone would still put the chat list screen and Dexie into
 * the server bundle's static graph.
 */
const ChatLibraryPage = lazy(() =>
	import("#/features/chat-library/chat-library-page.tsx").then((module) => ({
		default: module.ChatLibraryPage,
	})),
);

export const Route = createFileRoute("/(app)/chats/")({
	/**
	 * Requires authentication.
	 *
	 * The local database is split per member (rowcat_chat_<viewerId>). Until identity is confirmed, it
	 * is impossible to know which database to open. Creating a guest local store would bring along the
	 * rule 'merge guest data into the logged-in account', which is a separate design problem.
	 *
	 * The check runs in beforeLoad, not in the component, to avoid flicker. A component check would
	 * draw an empty list once before it disappeared. The lookup uses the same viewerQueryOptions as
	 * the root loader, so /me is not requested twice.
	 */
	beforeLoad: async ({ context, location }) => {
		const viewer = await context.queryClient.ensureQueryData(
			viewerQueryOptions(getRowCatClient()),
		);
		if (!viewer)
			throw redirect({
				to: "/login",
				// Returns here after login. Validation is done again by the login route.
				search: { redirect: location.href },
			});
	},
	/**
	 * Fixed title. A chat title used as the document title would stay in browser history and the tab
	 * list, where others can see it. The chat screen follows the same rule for the same reason.
	 */
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.chats", { app: APP_NAME }) },
			{ name: "robots", content: "noindex" },
		],
	}),
	component: ChatsIndexRoute,
});

function ChatsIndexRoute() {
	const fallback = (
		<ChatLibraryShell>
			<ChatLibrarySkeleton />
		</ChatLibraryShell>
	);
	return (
		<ClientOnly fallback={fallback}>
			<Suspense fallback={fallback}>
				<ChatLibraryPage />
			</Suspense>
		</ClientOnly>
	);
}
