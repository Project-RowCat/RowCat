import { CHAT_HISTORY_LIMIT, CHAT_HISTORY_WINDOW_MAX } from "./context.ts";
import { type ChatSummaryFrontier, isAfterFrontier } from "./summary.ts";

/**
 * How far the window's start jumps when more than `CHAT_HISTORY_WINDOW_MAX` messages sit after the
 * frontier. It is the room between the floor and the cap, so a step lands the window at 41 messages,
 * next to the 40 a summary run leaves, and the next step comes ten turns later, the rhythm a healthy
 * room's summary keeps.
 */
const CHAT_HISTORY_WINDOW_STEP = CHAT_HISTORY_WINDOW_MAX - CHAT_HISTORY_LIMIT;

/**
 * Which stored messages a turn sends verbatim: everything after the summary frontier, never fewer
 * than `CHAT_HISTORY_LIMIT` and never more than `CHAT_HISTORY_WINDOW_MAX`.
 *
 * A fixed "last 40" window had two costs. One was a gap: summarization runs only after twenty
 * messages have left the window (`CHAT_MAINTENANCE_TRIGGER`), so up to nineteen messages sat outside
 * both the transcript and the summary, and the model saw neither. The other was the prompt cache: the
 * window dropped its oldest message every turn, so the history prefix never matched the previous
 * request and every turn wrote the whole history to the cache again. Starting at the frontier closes
 * both. Each message is either verbatim or summarized, never neither, and the window only moves when
 * the frontier does, about once every ten turns, which is the same turn the summary in the system
 * prompt changes anyway.
 *
 * The bounds keep the old guarantees:
 *
 * ```text
 * floor  CHAT_HISTORY_LIMIT        a turn never sees fewer messages than before; the frontier cannot
 *                                  cross this line (`CHAT_MAINTENANCE_RECENT_KEEP`), so a summary
 *                                  and the window still do not overlap on the normal path
 * cap    CHAT_HISTORY_WINDOW_MAX   maintenance becomes due exactly when the window is full
 * ```
 *
 * **Past the cap the window steps; it does not slide.** A room whose maintenance lags or never runs
 * (no summary target, a failing summary request, a work test) keeps adding messages after a frontier
 * that stays put. Keeping the newest 60 dropped the oldest message every turn, which is the per-turn
 * full rewrite above coming back: in a room's usage pane on 2026-11-03, turns past the cap read only
 * the system block (9,758 tokens) and wrote 95-100k of history each, while the prompt shrank as old
 * messages fell off. Instead the start
 * jumps `CHAT_HISTORY_WINDOW_STEP` messages at a time, counted from the frontier, as if a summary had
 * run there: the window falls back to 41 and grows again, and the history prefix holds for ten turns.
 * Messages between the frontier and the start are neither summarized nor sent, as they were while it
 * slid; a later summary picks them up from the frontier.
 *
 * The frontier is the stored coordinate (`[roomId+createdAt+id]`), not a count. Comparing positions
 * keeps working after a middle message is deleted or sync inserts an earlier one.
 *
 * The step needs to know how many messages follow the frontier, so the caller passes every live
 * message after it, in ascending order (more is accepted). `loadChatHistoryWindow` reads that much
 * only when the room is past the cap; a room within it is read as its newest 61 messages.
 */
export function chatHistoryWindow<T extends { createdAt: string; id: string }>(
	messages: readonly T[],
	frontier: ChatSummaryFrontier | null,
): T[] {
	const firstUnsummarized = messages.findIndex((message) =>
		isAfterFrontier(message, frontier),
	);
	const from = firstUnsummarized === -1 ? messages.length : firstUnsummarized;
	const overflow = messages.length - from - CHAT_HISTORY_WINDOW_MAX;
	const stepped =
		overflow > 0
			? Math.ceil(overflow / CHAT_HISTORY_WINDOW_STEP) *
				CHAT_HISTORY_WINDOW_STEP
			: 0;
	const start = Math.min(
		from + stepped,
		Math.max(0, messages.length - CHAT_HISTORY_LIMIT),
	);
	return messages.slice(start);
}

/** The reads `loadChatHistoryWindow` needs, so this package takes functions instead of a store. */
export interface ChatHistoryWindowSource<T> {
	/** The newest `limit` live messages, ascending (`ChatStore.listRecentMessages`). */
	recent(limit: number): Promise<T[]>;
	/** Every live message, ascending (`ChatStore.listAllMessages`). */
	all(): Promise<T[]>;
	/** The summary frontier, or null before the first summary. */
	frontier(): Promise<ChatSummaryFrontier | null>;
}

/**
 * Reads what `chatHistoryWindow` needs and returns the window. Both apps' conversations call it, so
 * the rule for how much to read is written once.
 *
 * One message more than the cap answers whether the room is past it: when even the oldest of those
 * follows the frontier, the step needs the full count after the frontier, so everything is read. That
 * happens only in a room whose summary is not keeping up, which already reads the whole room after
 * every reply (`runMemoryMaintenance`). A room within the cap reads 61 messages, as before.
 *
 * The frontier is read alongside, not before, the recent page. If maintenance commits between the two
 * reads, this turn's window starts at the older frontier and overlaps the new summary once: an event
 * seen twice, never one seen by neither.
 */
export async function loadChatHistoryWindow<
	T extends { createdAt: string; id: string },
>(source: ChatHistoryWindowSource<T>): Promise<T[]> {
	const [recent, frontier] = await Promise.all([
		source.recent(CHAT_HISTORY_WINDOW_MAX + 1),
		source.frontier(),
	]);
	const oldest = recent[0];
	const pastCap =
		recent.length > CHAT_HISTORY_WINDOW_MAX &&
		oldest !== undefined &&
		isAfterFrontier(oldest, frontier);
	return chatHistoryWindow(pastCap ? await source.all() : recent, frontier);
}
