import type { ChatCharacter, ChatStore } from "@rowcat/chat";
import { useMemo } from "react";
import { type LocalLive, useLocalLive } from "./live.ts";
import { useChatScope } from "./scope.tsx";

/**
 * Subscribes to the **characters** of this room. This is the single place that reads them.
 *
 * Same shape and rationale as `use-personas.ts`. The one difference is an argument, and that
 * difference is the whole character of this record: characters are children of the room, not
 * account assets, so each room has its own list (the reverse of why the persona library takes no
 * room id).
 *
 * ## The conversation screen also calls this, and that reverses an earlier decision
 *
 * For a while only the settings sheet called this hook, on the grounds that the conversation screen
 * would open a subscription it never reads. That premise broke because of `{{char}}`: the seed
 * characters of a v2 work are always empty, so this list is the **only source** for that
 * placeholder. If the screen did not read it, the name the model receives and the text the screen
 * draws would diverge.
 *
 * Generation still freezes the cast with a **single read at start** rather than a subscription
 * (`loadCharacters`), because an in-flight generation must not shift when the character list
 * changes. That rule is unchanged.
 */

export interface LocalCharacters extends LocalLive<ChatCharacter[]> {
	/** Used by the step that re-checks ownership before an irreversible write (same reason as the library). */
	store: ChatStore | null;
}

export function useLocalCharacters(roomId: string | null): LocalCharacters {
	const { store } = useChatScope();

	/** Memoizes the read function. A new function per render would make the subscription re-read on every render. */
	const load = useMemo(
		() => (store && roomId ? () => store.listCharacters(roomId) : null),
		[store, roomId],
	);
	const live = useLocalLive<ChatCharacter[]>(load, EMPTY);

	return useMemo(() => ({ ...live, store }), [live, store]);
}

/** A stable empty array: a new array per render would make consumers redraw every time. */
const EMPTY: ChatCharacter[] = [];
