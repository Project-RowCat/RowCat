import type { ChatRoom } from "@rowcat/chat";
import {
	type ConversationLibraryEntry,
	mergeConversationLibrary,
} from "@rowcat/domain";
import type { RuntimeConversationRecord } from "@rowcat/runtime-persistence";
import { useMemo } from "react";
import type { LocalLiveStatus } from "../../lib/local-data/live.ts";
import { useLocalRooms } from "../../lib/local-data/use-rooms.ts";
import { useLocalRuntimeConversations } from "../../lib/local-data/use-runtime-conversations.ts";

/**
 * Subscription for the unified conversation library: rooms and runtime rows in one list. The two
 * subscriptions are joined here (`useLocalRooms` + `useLocalRuntimeConversations`); the merge rule
 * is `@rowcat/domain`'s, which web calls too. Both screens (`/chats` and the drawer's recent
 * conversations) call this one hook and pick their own rows.
 *
 * The two storage models stay separate: rows split on `kind` and each carries its own source
 * record, so a runtime row cannot be passed to the room management hook (it has no `room`).
 */
export type ConversationEntry = ConversationLibraryEntry<
	ChatRoom,
	RuntimeConversationRecord
>;

export interface ConversationLibrary {
	entries: ConversationEntry[];
	/** Folded status: any read failure is an error, any pending first result is loading. A half-drawn list reads as "vanished". */
	status: LocalLiveStatus;
	reload: () => void;
	/** Whose list this is: the conversation store instance, not a member id. Both ports open and close in one scope, so one suffices. */
	store: ReturnType<typeof useLocalRooms>["store"];
}

export function useConversationLibrary(): ConversationLibrary {
	const rooms = useLocalRooms();
	const conversations = useLocalRuntimeConversations();
	const entries = useMemo(
		() => mergeConversationLibrary(rooms.value, conversations.value),
		[rooms.value, conversations.value],
	);
	const status: LocalLiveStatus =
		rooms.status === "error" || conversations.status === "error"
			? "error"
			: rooms.status === "loading" || conversations.status === "loading"
				? "loading"
				: "ready";
	const reload = () => {
		rooms.reload();
		conversations.reload();
	};
	return { entries, status, reload, store: rooms.store };
}
