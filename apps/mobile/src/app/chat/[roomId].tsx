import { Redirect, useLocalSearchParams } from "expo-router";
import { ChatScreen } from "../../features/chat/chat-screen.tsx";
import { readRoomIdParam } from "../../features/chat/chat-state.ts";

/**
 * Conversation: the address carries identity. No shadow state like `selectedRoomId`; with the route
 * parameter as the source, deep links, back, stack restoration and process restarts follow for
 * free. The room object is not passed as a parameter (direct entry has none, and a copy goes
 * stale); the room is always re-read from the open local store. Parsing is a pure function
 * (`readRoomIdParam`) because this app's tests do not render React.
 */
export default function ChatRoute() {
	const { roomId } = useLocalSearchParams<{ roomId?: string | string[] }>();
	const id = readRoomIdParam(roomId);

	/**
	 * An address with no id should not reach this route; if it does it is not a conversation. Go back
	 * to discovery instead of scanning the store with an empty id, since "not found" is only honest
	 * after actually looking.
	 */
	if (!id) return <Redirect href="/" />;

	return <ChatScreen roomId={id} />;
}
