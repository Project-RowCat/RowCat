/**
 * Copy for runtime library rows; no rules live here. Which rows draw and in what order is decided
 * by `@rowcat/domain`'s `mergeConversationLibrary` and two `@rowcat/chat` functions, which web
 * calls too. The wording equals web's `features/conversation-library/runtime-conversation-copy.ts`.
 */

/**
 * The only runtime-row action, and it does not erase progress. It is not `Delete conversation`, which implies
 * messages and memories vanish; this only removes one library row. Playthrough progress and
 * long-term records stay, and reopening the story brings the row back, so there is no confirmation.
 */
export const RUNTIME_CONVERSATION_REMOVE_LABEL = "Remove from list";

/** Accessible name of the row menu trigger; same shape as a room's `Manage conversation …`, different words. */
export function runtimeConversationActionsLabel(title: string): string {
	return `Manage ${title} in the list`;
}

/** Row whose title is not yet known; the next open fills it in. */
export const RUNTIME_CONVERSATION_UNTITLED = "Untitled story";

/** Suffix telling non-visual users this row is not a room. */
export const RUNTIME_CONVERSATION_KIND_LABEL = "Runtime story";

export const RUNTIME_CONVERSATION_REMOVE_FAILURE =
	"Couldn't remove it from the list. Please try again.";

/** Falls back to the placeholder for an empty title; the stored value is untouched. */
export const runtimeConversationTitle = (title: string): string =>
	title.trim().length > 0 ? title : RUNTIME_CONVERSATION_UNTITLED;
