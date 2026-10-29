import { APP_NAME } from "@rowcat/domain";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ChatShell } from "#/features/chat/chat-shell.tsx";
import { ChatSkeleton } from "#/features/chat/chat-skeleton.tsx";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Chat screen, built on local data.
 *
 * There is no loader. Rooms and messages live in this device's IndexedDB, not on the server, so the
 * server has nothing to pre-fetch and send. This is exactly where it differs from the gallery and
 * the work detail page.
 *
 * So the body is wrapped in ClientOnly. The server renders only the frame (header and placeholder),
 * and the room content is filled in by the browser after hydration. Rendering on the server would
 * either crash in environments without IndexedDB or, worse, send 'no conversation' as the first
 * HTML.
 *
 * The body is also split with lazy, for the same boundary. The chat screen and Dexie stay out of
 * the server bundle's static graph. ClientOnly blocks rendering, and lazy blocks loading.
 *
 * The room id stays in the URL. It is a globally stable id created locally, so it survives reloads,
 * back navigation, and bookmarks. When sync is added later, the same address will work on another
 * device.
 */
const ChatPage = lazy(() =>
	import("#/features/chat/chat-page.tsx").then((module) => ({
		default: module.ChatPage,
	})),
);

export const Route = createFileRoute("/(app)/chat/$roomId")({
	/**
	 * Remounts the screen when the room changes.
	 *
	 * The default is the opposite. The router keeps the same component when only a route parameter
	 * changes and passes in the new value. That suits a list screen, but this screen holds the
	 * generated turn in progress. If the user picks another room in the sidebar while a response is
	 * streaming, continuing the mount would draw room A's streaming text and its 'generating' state on
	 * room B's screen. The data is fine, because the save goes to A (the confirmed message carries the
	 * room id). Only the screen is out of sync, which is hard to notice.
	 *
	 * Remounting makes that boundary identical to 'left the chat screen and came back'. Cleanup aborts
	 * the generation in progress (use-chat-generation.ts). The abort saves the partial response
	 * already received to room A before it ends, so the text the user was reading is not thrown away
	 * because they changed rooms. The newly mounted B starts from its own state.
	 *
	 * This is also why no global generation manager is built. The ownership rules already live in the
	 * hook and in features/conversation/generation-owner.ts. What is needed here is only the boundary
	 * where those rules apply.
	 */
	remountDeps: ({ params }) => params.roomId,
	/**
	 * The conversation title lives in the room, and rooms exist only in the browser. The server cannot
	 * know the title, so a fixed string is used. This also keeps conversation content out of the
	 * document title. Browser history and the tab list are places others can see.
	 */
	head: () => ({
		meta: [{ title: translator("shell")("titles.chats", { app: APP_NAME }) }],
	}),
	component: ChatRoute,
});

function ChatRoute() {
	return (
		<ClientOnly
			fallback={
				<ChatShell>
					<ChatSkeleton />
				</ChatShell>
			}
		>
			<Suspense
				fallback={
					<ChatShell>
						<ChatSkeleton />
					</ChatShell>
				}
			>
				<ChatPage />
			</Suspense>
		</ClientOnly>
	);
}
