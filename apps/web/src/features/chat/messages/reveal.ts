/**
 * Search result → jump to that row in the conversation. Only the pure parts live here.
 *
 * A jump has two steps. The message must first be inside the subscription window (the conversation
 * subscribes only to the latest page, see `lib/local-chat/hooks.ts`). Then the row's index in the
 * virtual list is handed to the virtualizer. Both are computations checkable without rendering, so
 * they are split out here. A mistake is silent: it jumps to the wrong row or does nothing.
 *
 * This file never touches scroll position. It produces two numbers, and the virtualizer's
 * `scrollToIndex` does the actual move. Writing `scrollTop` directly races the virtualizer's
 * correction in the same frame and makes the screen jump (coordinate rules in `message-list.tsx`).
 */

/**
 * The window size is computed in `@rowcat/chat` (`messagesFromEnd`). It moved there because there
 * are now two consumers: mobile's conversation screen jumps the same way. If each app counted on
 * its own, one could load a smaller window and leave "tapped the result, nothing happened" states.
 * The row-index calculation below stays here because it depends on this app's list shape; the
 * inverted native list and the virtualizer's row array are not the same array.
 */
export { messagesFromEnd } from "@rowcat/chat";

/** One row of the virtual list. This file reads only its identity and kind. */
export interface RevealableRow {
	kind: string;
	key: string;
}

/**
 * The row number of that message in the virtual list, or -1 if absent.
 *
 * The message array index cannot be used directly because the first row may not be a message (`Load earlier
 * messages`). An off-by-one jump is hard to notice because it lands "roughly nearby", and mixing in
 * the in-progress response row makes that error vary with state.
 *
 * Kind is checked too because the identity space is shared: message rows key by message id, but
 * other rows in the same array carry their own keys. Without the kind check, a row kind added later
 * would silently become a jump target.
 */
export const revealRowIndex = (
	rows: readonly RevealableRow[],
	messageId: string,
): number =>
	rows.findIndex((row) => row.kind === "message" && row.key === messageId);
