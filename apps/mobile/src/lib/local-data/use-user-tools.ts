import type { ChatStore, ChatUserTool } from "@rowcat/chat";
import { useMemo } from "react";
import { type LocalLive, useLocalLive } from "./live.ts";
import { useChatScope } from "./scope.tsx";

/**
 * Subscribes to the **tool library** of this account and device. This is the single place that
 * reads it for a screen.
 *
 * The persona hook's shape and reasons (`use-personas.ts`): one hook, so no call site forgets the
 * scope check or the subscription, and a tool deleted on another device leaves every list at once.
 *
 * ## It takes no room id
 *
 * The library is an account asset. A room says only which of its tools are on
 * (`ChatRoom.toolOverrides`), and the room's tools pane applies that to this list itself
 * (`userToolActiveIn`). Filtering here by room would be the first step toward hanging tools off a
 * room, which the model rejects (`user-tool.ts`).
 *
 * ## It subscribes only while open
 *
 * The settings screen and the room's tools pane call this hook. Generation does **not**: it reads
 * the library once per turn (`store.listUserTools()` in `use-generation.ts`), because a subscription
 * held by the conversation screen would re-render it for every tool sync applies.
 */

export interface LocalUserTools extends LocalLive<ChatUserTool[]> {
	/** The store **instance** the list came from, for the ownership re-check before a write. */
	store: ChatStore | null;
}

export function useLocalUserTools(): LocalUserTools {
	const { store } = useChatScope();

	/** Memoizes the read function. A new function per render would make the subscription re-read on every render. */
	const load = useMemo(
		() => (store ? () => store.listUserTools() : null),
		[store],
	);
	const live = useLocalLive<ChatUserTool[]>(load, EMPTY);

	return useMemo(() => ({ ...live, store }), [live, store]);
}

/** A stable empty array: a new array per render would make consumers redraw every time. */
const EMPTY: ChatUserTool[] = [];
