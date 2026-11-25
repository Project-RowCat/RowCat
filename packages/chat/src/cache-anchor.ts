import type { ChatGenerationMessage } from "@rowcat/contracts";

/**
 * Where the history the next turn will send unchanged ends: the last assistant message before the
 * last user message, or `-1` when there is none.
 *
 * Why an adapter needs this. A prompt cache is read only at a position an earlier request wrote a
 * breakpoint at, and the automatic breakpoint sits on the request's last block — the user's line,
 * with this turn's long-term blocks in front of it (episodes, facts, recall: `withLongTerm` in
 * `context.ts`). Those blocks are this turn's alone: the next turn sends the same line without
 * them, so the entry written there is never read, and with only the system-prompt breakpoint behind
 * it the whole history was written to the cache again on every such turn. A breakpoint here is a position the next turn's
 * request reproduces byte for byte, so each turn reads the history up to the previous exchange and
 * writes only that exchange.
 *
 * It names a position, not a block of the assembler's: nothing here knows rules, lore, memory or
 * recall, only roles. Three cases fall out of the definition with no branch:
 *
 * - a tool round trip ends in tool messages; the last user message is the turn's own line, and the
 *   anchor is still the exchange before it;
 * - a continuation's nudge is appended by the adapter after this is read, so the anchor is the
 *   answer before the user's line, as on any turn;
 * - the first turn (no assistant before the line, or only an opening) has no anchor, or the opening.
 *
 * An assistant message with empty content is skipped (an empty text block is rejected; it carries
 * no breakpoint), and so is one carrying a tool call (stored history has none; a breakpoint there
 * would fall inside a round trip).
 */
export function chatCacheAnchorIndex(
	messages: readonly ChatGenerationMessage[],
): number {
	let lastUser = -1;
	for (let i = messages.length - 1; i >= 0; i--)
		if (messages[i]?.role === "user") {
			lastUser = i;
			break;
		}
	for (let i = lastUser - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		if (message.toolCall || !message.content) return -1;
		return i;
	}
	return -1;
}
