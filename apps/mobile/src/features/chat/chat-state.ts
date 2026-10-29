import type { ChatRoom } from "@rowcat/chat";
import type { MobileAppPhase } from "../../lib/session-state.ts";

/**
 * Pure decision for what the conversation screen draws.
 *
 * Kept out of the component because this app's tests do not render React (`vitest.config.ts`), and
 * a wrong answer here is silent: another account's room for one frame, "room not found" while
 * storage is still opening, or an endless spinner offline.
 *
 * Unlike the public screens (discovery, story detail), this one waits for identity and SQLite
 * (`README.md`): rooms exist only in the member's local database, so there is nothing to draw
 * before the session is settled and that file is open. It therefore takes `MobileAppPhase` as-is.
 *
 * `missing` is never asked of the server. There is no room-list endpoint, and an absent room can be
 * a hand-edited deep link, a deleted room, another account's room or a room that has not synced
 * yet. The server can answer none of these, and for the third, asking would confirm that someone
 * else's room id exists.
 */

export type ChatScreenState =
	/** Session still being checked or storage still opening. */
	| { kind: "booting" }
	/** The server answered guest. Offers the way to sign in; there is no public data to show here. */
	| { kind: "guest" }
	/**
	 * The session could not be verified, which is not a sign-out. Do not send the user to the login
	 * screen; that would read as "you were signed out", which they did not ask for.
	 */
	| { kind: "unavailable" }
	/** Member is known but device storage will not open; the conversations are not gone. */
	| { kind: "storage-error" }
	/** Storage is open and the room is being looked up. */
	| { kind: "loading" }
	/** This account has no such room on this device. */
	| { kind: "missing" }
	| { kind: "room"; room: ChatRoom };

/** The axes of the store subscription this screen reads. */
export interface RoomLookup {
	status: "loading" | "ready" | "error";
	/** `null` is a confirmed "no such room". */
	room: ChatRoom | null;
}

export function resolveChatScreenState(input: {
	phase: MobileAppPhase;
	lookup: RoomLookup;
}): ChatScreenState {
	const { phase, lookup } = input;

	// Identity and storage come first even when a lookup result is already in state: on an account
	// switch the previous member's room can still be in state for one render, and that render would
	// draw someone else's conversation.
	if (phase === "guest") return { kind: "guest" };
	if (phase === "unavailable") return { kind: "unavailable" };
	if (phase === "local-error") return { kind: "storage-error" };
	if (phase !== "ready") return { kind: "booting" };

	// A failed read is not "no such room": claiming absence for something we could not verify makes
	// the user think their conversation vanished. A held value is still drawn.
	if (lookup.status === "error")
		return lookup.room
			? { kind: "room", room: lookup.room }
			: { kind: "loading" };

	if (lookup.status === "loading") return { kind: "loading" };
	return lookup.room
		? { kind: "room", room: lookup.room }
		: { kind: "missing" };
}

/**
 * A repeated query key arrives as an array (hand-edited deep link). An empty value is not a room:
 * the caller sends the user back to the first screen instead of scanning storage for it, since "not
 * found" should only be said after actually looking.
 */
export function readRoomIdParam(
	raw: string | string[] | undefined,
): string | null {
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
