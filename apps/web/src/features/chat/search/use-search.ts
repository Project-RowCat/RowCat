import type { ChatMessage, ChatSearchResult } from "@rowcat/chat";
import { useCallback, useEffect, useRef, useState } from "react";
import { messagesFromEnd } from "../messages/reveal.ts";
import { isFindShortcut, isMacPlatform } from "./find-shortcut.ts";
import { useChatSearchRequests } from "./request.ts";

/**
 * All search state the conversation screen holds: whether the panel is open, and one message to
 * jump to.
 *
 * The query and results are not held here; they live inside the dialog (`chat-search-dialog.tsx`)
 * and vanish when it closes. Only the identity of the message the user picked is lifted out, so
 * there is little left to carry over on room or account switches.
 *
 * This hook lives in the conversation screen because jumping requires both the local message window
 * (`useLocalMessages`) and the virtualized list, and only the canvas has both. The header trigger
 * holds nothing and only sends a signal (`request.ts`).
 */

export interface ChatSearchState {
	open: boolean;
	/** Bumped when the shortcut is pressed again while open, to re-focus the input. */
	focusToken: number;
	/** The message to jump to now. Cleared once the list has moved to it. */
	reveal: { messageId: string; token: number } | null;
	select: (result: ChatSearchResult, total: number) => void;
	onRevealed: () => void;
	close: () => void;
}

export function useChatSearch({
	roomId,
	enabled,
	messages,
	hasMore,
	loadOlder,
	ensureWindow,
}: {
	roomId: string;
	/** Whether a room is actually open; the shortcut is not bound when false. */
	enabled: boolean;
	/** Messages currently in the subscribed window; used to see whether the jump target has arrived. */
	messages: ChatMessage[];
	hasMore: boolean;
	loadOlder: () => void;
	ensureWindow: (count: number) => void;
}): ChatSearchState {
	const [session, setSession] = useState({ open: false, focusToken: 0 });
	const [reveal, setReveal] = useState<{
		messageId: string;
		token: number;
	} | null>(null);
	// Sequence number for jump requests, so picking the same message twice still counts as two
	// requests.
	const revealToken = useRef(0);

	// Both the header trigger and the shortcut open through this one function. When already open, only
	// the focus token is bumped: the dialog stays mounted (the query is kept) and only the input is
	// re-focused, matching what pressing the browser's find again does.
	const open = useCallback(
		() =>
			setSession((current) => ({
				open: true,
				focusToken: current.focusToken + 1,
			})),
		[],
	);

	useChatSearchRequests(roomId, open);

	// `Cmd/Ctrl+F` is bound on the window so it opens from any focus point in the conversation screen.
	// The hook mounts only inside a room, so the browser's find keeps working elsewhere. The reason
	// for intercepting is in `find-shortcut.ts`.
	useEffect(() => {
		if (!enabled) return;
		const mac = isMacPlatform();
		const onKeyDown = (event: KeyboardEvent) => {
			if (!isFindShortcut(event, mac)) return;
			event.preventDefault();
			open();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [enabled, open]);

	// Picking a result closes the panel and then jumps. Leaving it open while the list moves behind it
	// would fill the whole screen on narrow viewports, so closing gives the same result at both sizes.
	// The subscription window is widened first: a message from months ago is outside the window the
	// screen holds, and the virtualizer cannot scroll to a row that is not in the list yet.
	const select = useCallback(
		(result: ChatSearchResult, total: number) => {
			setSession((current) => ({ ...current, open: false }));
			ensureWindow(messagesFromEnd(total, result.index));
			revealToken.current += 1;
			setReveal({ messageId: result.messageId, token: revealToken.current });
		},
		[ensureWindow],
	);

	// Correction when the target did not arrive in one widening. The widening above counts live
	// messages, but the window opens counting tombstones too (the page query in `store.ts`), so rooms
	// with many deleted messages can fall short; open one more page at a time. If there is nothing
	// more to open and the target is still missing, it was deleted in the meantime: end the wait,
	// since a wait that never ends is a failure with no visible sign.
	useEffect(() => {
		if (!reveal) return;
		if (messages.some((message) => message.id === reveal.messageId)) return;
		if (!hasMore) {
			setReveal(null);
			return;
		}
		loadOlder();
	}, [reveal, messages, hasMore, loadOlder]);

	const onRevealed = useCallback(() => setReveal(null), []);
	const close = useCallback(
		() => setSession((current) => ({ ...current, open: false })),
		[],
	);

	return {
		open: session.open,
		focusToken: session.focusToken,
		reveal,
		select,
		onRevealed,
		close,
	};
}
