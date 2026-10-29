import type { RoomSort } from "@rowcat/chat";

/**
 * Copy for the conversation list; no rules live here. Search, sort and reveal rules are in
 * `@rowcat/chat`'s `room-library.ts`, which web calls too. The Korean stays out of that package
 * because the copy is locale-bound.
 *
 * `Record<RoomSort, string>` is what this file actually guards: a new shared value breaks
 * compilation in both apps. The wording matches web's `chat-library-page.tsx`, since the same
 * screen saying different things reads as a different feature.
 */

export const ROOM_SORT_LABEL: Record<RoomSort, string> = {
	recent: "Recent activity",
	oldest: "Oldest activity",
	title: "Name",
};

/** Accessible name of the sort trigger; `Select` reads it together with the value. */
export const ROOM_SORT_TRIGGER_LABEL = "Sort by";

/**
 * The placeholder states what is scanned. `Search conversations` alone would read as searching messages, but only
 * titles are searched (a privacy choice before a performance one). Searching messages inside a room
 * has its own place: `Find` on the conversation screen.
 */
export const ROOM_SEARCH_PLACEHOLDER = "Search conversation names";
export const ROOM_SEARCH_LABEL = "Search conversations";
export const ROOM_SEARCH_CLEAR_LABEL = "Clear search";

/** `N conversations`; the count is never abbreviated (`formatCount` owns that rule). */
export const roomCountLabel = (formatted: string): string =>
	`${formatted} conversations`;

export const ROOM_LIBRARY_MORE_LABEL = "Show more";

/**
 * Guest: offer the way to sign in but say why first. Bouncing straight to the login screen would
 * make the user think they were signed out, hiding that conversations are stored per account on
 * this device.
 */
export const CHAT_LIBRARY_GUEST = {
	title: "Can't open conversations",
	description:
		"Conversations are saved on this device per account. They'll be there when you sign in again.",
	action: "Sign in",
} as const;

/**
 * The session cannot be confirmed, which is not a sign-out. No login button is drawn: the stored
 * session is intact and we merely could not ask, so the only action is asking again.
 */
export const CHAT_LIBRARY_UNAVAILABLE =
	"Couldn't check your session. It continues automatically once connected.";

/**
 * The store failed to open; conversations did not vanish. It is not drawn as an empty list, because
 * "No conversations yet" asserts a fact we have not confirmed.
 */
export const CHAT_LIBRARY_STORAGE_ERROR = {
	message: "Couldn't open this device's conversation storage.",
	action: "Try again",
} as const;

/**
 * Screen for someone with no conversations. There is no `+ New conversation`: a room is created with a playback
 * snapshot from a story, so an empty room does not exist and adding that button would change the
 * product rule. It points only at the one real action, finding a story.
 */
export const CHAT_LIBRARY_EMPTY = {
	title: "No conversations yet",
	description:
		"Discover a story and start a conversation. Conversations you start are saved on this device.",
	action: "Discover stories",
} as const;

/**
 * No search results, a different screen from the first-visit empty state. Merged, someone with many
 * conversations would see "No conversations yet" after one typo. It restates what was scanned for the same
 * reason.
 */
export const CHAT_LIBRARY_SEARCH_EMPTY = {
	title: "No results",
	description: "Search matches conversation names only, not message content.",
	action: "Clear search",
} as const;

/** Header title; the same word as web's sidebar `Conversations` item. */
export const CHAT_LIBRARY_TITLE = "Conversations";
