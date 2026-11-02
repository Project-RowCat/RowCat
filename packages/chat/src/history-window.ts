import { CHAT_HISTORY_LIMIT, CHAT_HISTORY_WINDOW_MAX } from "./context.ts";
import { type ChatSummaryFrontier, isAfterFrontier } from "./summary.ts";

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
 * cap    CHAT_HISTORY_WINDOW_MAX   maintenance becomes due exactly when the window is full; a room
 *                                  whose maintenance lags or never runs (no summary, a work test)
 *                                  slides at the cap instead of growing without bound
 * ```
 *
 * The frontier is the stored coordinate (`[roomId+createdAt+id]`), not a count. Comparing positions
 * keeps working after a middle message is deleted or sync inserts an earlier one.
 *
 * Not here: loading. The caller passes the most recent `CHAT_HISTORY_WINDOW_MAX` live messages in
 * ascending order (more is accepted and trimmed) and the frontier it read. Reading both here would
 * pull storage into a pure package.
 */
export function chatHistoryWindow<T extends { createdAt: string; id: string }>(
	messages: readonly T[],
	frontier: ChatSummaryFrontier | null,
): T[] {
	const recent = messages.slice(-CHAT_HISTORY_WINDOW_MAX);
	const firstUnsummarized = recent.findIndex((message) =>
		isAfterFrontier(message, frontier),
	);
	const start = Math.min(
		firstUnsummarized === -1 ? recent.length : firstUnsummarized,
		Math.max(0, recent.length - CHAT_HISTORY_LIMIT),
	);
	return recent.slice(start);
}
