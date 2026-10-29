import type { ChatRoom } from "@rowcat/chat";
import {
	type ConversationLibraryEntry,
	mergeConversationLibrary,
} from "@rowcat/domain";
import type { RuntimeConversationRecord } from "@rowcat/runtime-persistence";
import { useMemo } from "react";
import { useLocalRooms } from "#/lib/local-chat/hooks.ts";
import { useLocalRuntimeConversations } from "#/lib/local-runtime-save/hooks.ts";

/**
 * Subscription for the unified conversation library, combining room rows and runtime library rows.
 * It joins two subscriptions (useLocalRooms and useLocalRuntimeConversations). The merge rule lives
 * in @rowcat/domain, which mobile also calls. This hook only reads both sources and passes them in.
 *
 * The two storage models stay separate. Rows are discriminated by `kind`, and each row carries its
 * own source record. The types stop a runtime row from being passed as a ManagedRoom, since runtime
 * rows have no `room` field.
 */
export type ConversationEntry = ConversationLibraryEntry<
	ChatRoom,
	RuntimeConversationRecord
>;

export interface ConversationLibraryState {
	entries: ConversationEntry[];
	/**
	 * True while either subscription has not yet produced its first result. Drawing a half-loaded list
	 * would make items look like they disappeared.
	 */
	loading: boolean;
}

export function useConversationLibrary(): ConversationLibraryState {
	const rooms = useLocalRooms();
	const conversations = useLocalRuntimeConversations();
	const entries = useMemo(
		() => mergeConversationLibrary(rooms.items, conversations.items),
		[rooms.items, conversations.items],
	);
	return { entries, loading: rooms.loading || conversations.loading };
}
