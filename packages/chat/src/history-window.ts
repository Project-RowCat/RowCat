import { CHAT_HISTORY_LIMIT, CHAT_HISTORY_WINDOW_MAX } from "./context.ts";

/**
 * How far the window's start jumps. It is the room between the floor and the cap, so a step lands
 * the window at 41 messages and the next step comes twenty messages later.
 */
export const CHAT_HISTORY_WINDOW_STEP =
	CHAT_HISTORY_WINDOW_MAX - CHAT_HISTORY_LIMIT;

/**
 * Which stored messages a turn sends verbatim — a rule on the room's **message count** alone.
 *
 * Memory V2 started the window at its summary frontier, so the window depended on a model-written
 * summary keeping up. That summary is gone (`summary.ts`); what lies before the window is reached
 * through afterstate (recall and consolidated episodes, `conversation-memory.ts`), which indexes every
 * live message whatever its position. So the window only has to be bounded and cache-friendly:
 *
 * ```text
 * total ≤ CHAT_HISTORY_WINDOW_MAX (60)   everything
 * total > 60                             from the last multiple of 20 at least 40 back:
 *                                        start = ⌊(total − 40) / 20⌋ × 20, size 40..59
 * ```
 *
 * - **Bounded.** A turn never sends fewer than `CHAT_HISTORY_LIMIT` messages (when the room has them)
 *   nor more than `CHAT_HISTORY_WINDOW_MAX`. A room of 5,000 messages sends 40–59, never the whole
 *   history — whether or not the memory index exists or has caught up.
 * - **Steps, never slides.** The start moves twenty messages at a time, so the history prefix (and
 *   the provider's prompt cache over it) holds for twenty messages, as the frontier window did.
 * - **No gap.** Every message before the start is in the afterstate index once indexed; there is no
 *   stretch that is "neither summarized nor sent" waiting for a model call. An index that has not
 *   caught up (first open of a long imported room) is reported, not hidden: the turn still sends the
 *   bounded window and recall covers what is indexed so far (`ChatMemoryStatus`).
 *
 * Positions are counted on live messages; deleting a middle message shifts the start by one, which
 * the step absorbs.
 */
export function historyWindowStart(total: number): number {
	if (total <= CHAT_HISTORY_WINDOW_MAX) return 0;
	return (
		Math.floor((total - CHAT_HISTORY_LIMIT) / CHAT_HISTORY_WINDOW_STEP) *
		CHAT_HISTORY_WINDOW_STEP
	);
}

/** The window over a room's live messages (ascending). Pure; see `historyWindowStart`. */
export function chatHistoryWindow<T>(messages: readonly T[]): T[] {
	return messages.slice(historyWindowStart(messages.length));
}

/** The reads `loadChatHistoryWindow` needs, so this package takes functions instead of a store. */
export interface ChatHistoryWindowSource<T> {
	/** The newest `limit` live messages, ascending (`ChatStore.listRecentMessages`). */
	recent(limit: number): Promise<T[]>;
	/** How many live messages the room has (`ChatStore.countMessages`). */
	count(): Promise<number>;
}

/**
 * Reads the window: the count and the newest `CHAT_HISTORY_WINDOW_MAX` messages, side by side, then
 * keeps the newest `total − start`. Never reads the whole room. If a message lands between the two
 * reads, the window is one message off for this turn — never unbounded and never empty.
 */
export async function loadChatHistoryWindow<T>(
	source: ChatHistoryWindowSource<T>,
): Promise<T[]> {
	const [recent, total] = await Promise.all([
		source.recent(CHAT_HISTORY_WINDOW_MAX),
		source.count(),
	]);
	const size = Math.max(
		Math.min(total, CHAT_HISTORY_LIMIT),
		total - historyWindowStart(total),
	);
	return recent.slice(Math.max(0, recent.length - size));
}
