import type { ChatMessage } from "./model.ts";

/**
 * Reads the token usage for this conversation. The screen counts nothing itself.
 *
 * - The values already exist: when a response is finalized, the provider's usage report is stored
 *   on its record (`resolveGenerationOutcome`). This only folds them into a readable table. No new
 *   storage, endpoint, or sync record.
 * - Kept in a pure module because the total is easy to get wrong. 'Unknown is not zero' must be
 *   applied in one place; if each app writes it, one of them will use `?? 0`. The cache observation
 *   already guarded this once (`cache_usage_reported`).
 * - Not included: money. Nothing is charged for these tokens, and a provider's price for a BYO key
 *   is not a fact this package knows. Estimates are not made: responses without a report are not counted, but the table says how many were skipped.
 *   Period filters, charts, and export are also out of scope.
 * - The question is wider than 'did tokens spike'. The stored flags say how each turn ended:
 *   `truncated` (normal finish, stopped by the output cap), `incomplete` (no normal finish seen:
 *   stop, dropped connection, or provider failure), or neither (finished). Every response gets a
 *   row. The usage axis stays optional: a response that did not report usage leaves its key absent.
 */

/**
 * Number of responses shown, most recent first. Enough to find a spike. Drawing every response
 * would turn this panel into a list screen on long conversations; that would need a period filter
 * and sorting, which are outside this slice.
 */
export const CHAT_USAGE_VIEW_LIMIT = 20;

/**
 * How a response ended, read directly from the two stored flags. The screen does not read
 * `message.truncated` or `message.incomplete` itself: two apps could then name the same response
 * differently, which already happened once. That is why `continuationTarget` also returns the
 * reason.
 */
export type ChatUsageOutcome = "complete" | "truncated" | "incomplete";

/** One response. An axis the provider did not report has no key; it is absent, not zero. */
export interface ChatUsageRow {
	messageId: string;
	createdAt: string;
	outcome: ChatUsageOutcome;
	model?: string;
	inputTokens?: number;
	cachedInputTokens?: number;
	outputTokens?: number;
}

export interface ChatUsageTotals {
	inputTokens?: number;
	cachedInputTokens?: number;
	outputTokens?: number;
}

export interface ChatUsageView {
	/** Most recent first. Every response has a row, including those that did not report usage. */
	rows: readonly ChatUsageRow[];
	/** Sums only the reported axes. An axis nobody reported has no key. */
	totals: ChatUsageTotals;
	/** Number of responses with unknown usage: what the totals did not count. */
	unreported: number;
}

/** True if the response reported any usage. Responses reporting none are left out of the totals. */
const reported = (message: ChatMessage): boolean =>
	message.inputTokens !== undefined ||
	message.outputTokens !== undefined ||
	message.cachedInputTokens !== undefined;

/**
 * Folds the two flags into one word. Truncation takes precedence: when both are true, more text
 * remains to continue, and that is what the user needs to know.
 */
const outcomeOf = (message: ChatMessage): ChatUsageOutcome =>
	message.truncated === true
		? "truncated"
		: message.incomplete === true
			? "incomplete"
			: "complete";

/** Adds only reported values. If either side is unknown, the sum stays unknown. */
const add = (
	total: number | undefined,
	next: number | undefined,
): number | undefined => (next === undefined ? total : (total ?? 0) + next);

/**
 * Converts stored messages into usage rows. The input is the array the screen subscribes to, oldest
 * first. The function does not know the storage layer: the window size is the screen's concern, and
 * this function counts only what it receives. So 'the whole conversation' below means the full
 * range passed in, not the whole room. Both apps load only the most recent page
 * (`use-room-messages.ts`, `useLocalMessages`), and `rows` and `unreported` report what was
 * counted.
 */
export function chatUsageView(
	messages: readonly ChatMessage[],
	options?: { limit?: number },
): ChatUsageView {
	const limit = options?.limit ?? CHAT_USAGE_VIEW_LIMIT;
	const answers = messages.filter(
		(message) => message.role === "assistant" && message.deletedAt === null,
	);

	let totals: ChatUsageTotals = {};
	let unreported = 0;
	const rows: ChatUsageRow[] = [];
	/* Totals cover everything passed in; only the list is cut. */
	for (const message of answers) {
		rows.push({
			messageId: message.id,
			createdAt: message.createdAt,
			outcome: outcomeOf(message),
			...(message.model !== undefined ? { model: message.model } : {}),
			...(message.inputTokens !== undefined
				? { inputTokens: message.inputTokens }
				: {}),
			...(message.cachedInputTokens !== undefined
				? { cachedInputTokens: message.cachedInputTokens }
				: {}),
			...(message.outputTokens !== undefined
				? { outputTokens: message.outputTokens }
				: {}),
		});
		if (!reported(message)) {
			unreported += 1;
			continue;
		}
		totals = {
			...(add(totals.inputTokens, message.inputTokens) !== undefined
				? { inputTokens: add(totals.inputTokens, message.inputTokens) }
				: {}),
			...(add(totals.cachedInputTokens, message.cachedInputTokens) !== undefined
				? {
						cachedInputTokens: add(
							totals.cachedInputTokens,
							message.cachedInputTokens,
						),
					}
				: {}),
			...(add(totals.outputTokens, message.outputTokens) !== undefined
				? { outputTokens: add(totals.outputTokens, message.outputTokens) }
				: {}),
		};
	}

	return { rows: rows.slice(-limit).reverse(), totals, unreported };
}
