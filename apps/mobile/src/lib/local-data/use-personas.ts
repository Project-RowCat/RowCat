import type { ChatPersona, ChatStore } from "@rowcat/chat";
import { useMemo } from "react";
import { type LocalLive, useLocalLive } from "./live.ts";
import { useChatScope } from "./scope.tsx";

/**
 * Subscribes to the **persona library** of this account and device. This is the single place that
 * reads it.
 *
 * Same shape and rationale as `use-rooms.ts`: with two call sites, one would apply the scope check
 * and the other would forget the subscription, and the forgetful one goes stale silently. For
 * example, a role deleted on another device would keep appearing in the picker.
 *
 * ## It takes no room id
 *
 * The library is an account asset, not a child of a conversation, so the room it is opened from
 * does not change the list. That fact is kept by the absence of an argument: with an argument,
 * someone would eventually filter by "roles used in this room", and that is the first step toward
 * hanging the library off a room.
 *
 * ## It subscribes only while open
 *
 * Only the persona pane of the settings sheet calls this hook. If the conversation screen held it
 * all the time, every room opened would open a subscription nobody reads, and every role applied by
 * sync would re-render that screen (memory made the same judgment).
 */

export interface LocalPersonas extends LocalLive<ChatPersona[]> {
	/**
	 * The owner of this list is the store **instance**, not the member id.
	 *
	 * The step that re-checks ownership before an irreversible write reads this value. Comparing
	 * member ids would make `Alice → sign out → Alice` the same value, and the write would go out on a
	 * connection already closed.
	 */
	store: ChatStore | null;
}

export function useLocalPersonas(): LocalPersonas {
	const { store } = useChatScope();

	/** Memoizes the read function. A new function per render would make the subscription re-read on every render. */
	const load = useMemo(
		() => (store ? () => store.listPersonas() : null),
		[store],
	);
	const live = useLocalLive<ChatPersona[]>(load, EMPTY);

	return useMemo(() => ({ ...live, store }), [live, store]);
}

/** A stable empty array: a new array per render would make consumers redraw every time. */
const EMPTY: ChatPersona[] = [];
