import { APP_NAME } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { ClientOnly, createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ConversationViewport } from "#/features/conversation/conversation-viewport.tsx";
import { RuntimeChatSkeleton } from "#/features/runtime-player/runtime-chat-skeleton.tsx";
import { RUNTIME_PLAYER_COPY } from "#/features/runtime-player/runtime-player-copy.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Creator runtime playback: opens a published work inside the RowCat conversation canvas.
 * - /chat/:roomId is a chat room: one local ChatRoom on this device.
 * - /chat/runtime/:storyId is runtime playback: one work's playthrough, with saved state. It is
 *   not a room.
 *
 * Both live under the same prefix because for the person opening a work they are the same place:
 * the 'conversation' entry in the sidebar, a canvas confined to the screen height, and the same
 * header. The parameters keep separate meanings. The value of /chat/:roomId stays a local room id.
 * This route does not overload it with a fake identity such as runtime:<id> or ?mode=runtime (see
 * §5). The static segment runtime outranks the dynamic segment in the router, so this address never
 * reads as roomId = 'runtime'. runtime-chat-route.test.ts locks that by value.
 *
 * There is no loader. A playback response is a body that passed the entitlement check, so it cannot
 * go into SSR HTML. That document would persist in proxies, browser caches, and back-navigation
 * snapshots. So the body is wrapped in ClientOnly and split with lazy. ClientOnly blocks rendering,
 * and lazy blocks loading the QuickJS WASM and the renderer. This screen stands on its own from the
 * address (§45, §46). The artifact is not carried over as moving state. A reload or deep link
 * rebuilds the work lookup, playback lookup, save scope, and session from scratch.
 *
 * Guests never reach this screen. The server already rejects them, since guests have no playback
 * entitlement. But this screen sends them to login first. Otherwise they would see an empty canvas
 * and then read 'cannot play'.
 */
const RuntimeConversation = lazy(() =>
	import("#/features/runtime-player/runtime-conversation.tsx").then(
		(module) => ({ default: module.RuntimeConversation }),
	),
);

/**
 * Server and loading skeleton. This is not the placeholder of the chat room.
 *
 * The chat room's placeholder promises that its content (prose, bubbles, the input box rhythm) will
 * be filled in soon. Here, what gets filled in is the creator's canvas (§60). The document title is
 * not `Conversation`. The work title is a server value that the browser fills in, so until then the
 * title uses a word describing this screen's nature.
 */
function Fallback() {
	return (
		<ConversationViewport title={RUNTIME_PLAYER_COPY.viewportTitle}>
			<RuntimeChatSkeleton />
		</ConversationViewport>
	);
}

export const Route = createFileRoute("/(app)/chat/runtime/$storyId")({
	beforeLoad: async ({ context, location }) => {
		const viewer = await context.queryClient.ensureQueryData(
			viewerQueryOptions(getRowCatClient()),
		);
		if (!viewer)
			throw redirect({ to: "/login", search: { redirect: location.href } });
	},
	/**
	 * Remounts the screen when the work changes.
	 *
	 * Two works are different VMs with different saves. If the mount continued, commits from work A
	 * could arrive on work B's screen, while the save would go to A's identity. The data is fine but
	 * the screen is out of sync, the same kind of problem as the chat room. The chat room uses the
	 * same boundary for the same reason.
	 */
	remountDeps: ({ params }) => params.storyId,
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.play", { app: APP_NAME }) },
			/**
			 * This address is where the body runs, so there is nothing to index. The detail page is the
			 * work's public face. A crawler that arrives here would get only a login redirect.
			 */
			{ name: "robots", content: "noindex" },
		],
	}),
	component: RuntimeChatRoute,
});

function RuntimeChatRoute() {
	const { storyId } = Route.useParams();
	return (
		<ClientOnly fallback={<Fallback />}>
			<Suspense fallback={<Fallback />}>
				<RuntimeConversation storyId={storyId} />
			</Suspense>
		</ClientOnly>
	);
}
