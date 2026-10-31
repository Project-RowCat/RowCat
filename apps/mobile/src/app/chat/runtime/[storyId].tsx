import { Redirect, useLocalSearchParams } from "expo-router";
import { readRoomIdParam } from "../../../features/chat/chat-state.ts";
import { RuntimeChatScreen } from "../../../features/runtime-player/runtime-chat-screen.tsx";

/**
 * Creator runtime playback: an address inside the conversation section, but not a room.
 *
 * ```text
 * /chat/[roomId]            conversation room   one ChatRoom on this device
 * /chat/runtime/[storyId]   runtime playback    one work's playthrough (saved state)
 * ```
 *
 * They share a prefix because to a person opening a work they are the same place (drawer `Conversations`, same
 * header conventions). `[roomId]` still means one local room id; no fake `runtime:<id>` identity is
 * overlaid on it. Expo Router orders the static segment before the dynamic one, and the shell
 * decision also matches segment count (`features/shell/shell-route.ts`). The artifact is not a
 * parameter: it is a body behind the entitlement gate and is always re-asked from the server.
 * Parsing reuses the room address's pure function.
 */
export default function RuntimeChatRoute() {
	const { storyId } = useLocalSearchParams<{ storyId?: string | string[] }>();
	const id = readRoomIdParam(storyId);

	if (!id) return <Redirect href="/" />;

	/**
	 * Keyed on the story: a different story is a different screen instance. The AI notice's answer,
	 * the play-start flag and the bridge and session all belong to one playthrough, and the router's
	 * own decision on whether a navigation reuses this route is not something this app owns (the web
	 * route says the same with `remountDeps`).
	 */
	return <RuntimeChatScreen key={id} storyId={id} />;
}
