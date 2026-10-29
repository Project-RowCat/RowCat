import { recentSidebarRooms } from "@rowcat/chat";
import { activeConversationEntryId } from "@rowcat/domain";
import { runtimeConversationIdFor } from "@rowcat/runtime-persistence";
import { useMemo } from "react";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { useMobileLocalScope } from "../../lib/local-data/scope.tsx";
import { resolveAppPhase } from "../../lib/session-state.ts";
import {
	type ConversationEntry,
	useConversationLibrary,
} from "../chat-library/use-conversation-library.ts";
import {
	resolveSidebarRecentState,
	type SidebarRecentState,
} from "./sidebar-state.ts";

/**
 * The **recent chat rows** the drawer will draw, and that section's state.
 *
 * Three jobs, and two of them belong elsewhere. Subscription is the unified library hook's
 * (`chat-library/use-conversation-library.ts`; the rule that merges room rows and runtime library
 * rows into one list is `@rowcat/domain`'s, and **web calls the same function**). The cut rule is
 * `recentSidebarRooms` in `@rowcat/chat`. Whether to draw at all is a pure function
 * (`sidebar-state.ts`). What remains here is wiring the three together.
 *
 * ## Do not sort again
 *
 * The order is part of the merge rule's contract (`updatedAt DESC, id DESC`). Sorting again here
 * would eventually put the same row first in the drawer and fifth on `/chats`, because the two
 * would read the same function and diverge anyway.
 *
 * ## This hook runs only while the drawer is open
 *
 * `NavigationDrawer`'s content is not mounted while it is closed (the primitive's portal does
 * that), so this subscription lives only then. The trigger is drawn regardless.
 */

export interface RecentRooms {
	/** The rows to draw — the recent window plus the open row outside it. Two kinds are mixed here. */
	entries: ConversationEntry[];
	/** The identity of the row to light — a room id or a runtime library row id. */
	activeEntryId: string | null;
	state: SidebarRecentState;
}

export function useRecentRooms(input: {
	activeRoomId: string | null;
	activeRuntimeStoryId: string | null;
}): RecentRooms {
	const { session } = useMobileIdentity();
	const localScope = useMobileLocalScope();
	const library = useConversationLibrary();

	const state = resolveSidebarRecentState({
		phase: resolveAppPhase(session, localScope.status),
		rooms: { status: library.status, total: library.entries.length },
	});

	/**
	 * The rule that moves the two axes into one lives in the domain, and web calls the same function.
	 * Writing `roomId ?? runtimeId` here would eventually leave one app not lighting the runtime row.
	 */
	const activeEntryId = activeConversationEntryId({
		activeRoomId: input.activeRoomId,
		activeRuntimeConversationId:
			input.activeRuntimeStoryId === null
				? null
				: runtimeConversationIdFor(input.activeRuntimeStoryId),
	});

	const entries = useMemo(
		() => recentSidebarRooms(library.entries, activeEntryId),
		[library.entries, activeEntryId],
	);

	return { entries, activeEntryId, state };
}
