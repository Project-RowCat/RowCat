import type { ChatMessage, ChatRole } from "./model.ts";
import type { ChatMessageContentRejection } from "./tail-rewrite.ts";
import { checkMessageContent, selectChatTail } from "./tail-rewrite.ts";

/**
 * Which actions a message row supports, and what each one deletes. Pure rules.
 *
 * This file holds the locale-independent half of `apps/web/src/features/chat/message-actions.ts`.
 * It moved because there are two consumers now: web's chat screen and mobile's chat screen. If each
 * app kept its own table, the two would diverge in known directions:
 * - Role-based actions: an edit action open to assistants on one side only, so model text gets
 *   edited by hand.
 * - Delete count: one side counts the boundary (inclusive or exclusive) differently, so the
 *   confirmation text misstates the real range.
 * - Edit plan: one side folds `unchanged` into a save, so an unedited conversation rises to the
 *   top of the list.
 *
 * All three are boundaries of irreversible operations, and all three fail silently.
 *
 * Copy is not here. Sentences such as 'This message and N later messages will be deleted' belong to
 * each app. Korean wording here would bind these pure rules to one locale, and places where web and
 * mobile legitimately use different words (an icon tooltip on wide screens versus a menu row label)
 * would be frozen into one. Only counts and branches leave this file; each app keeps a table that
 * turns them into human language.
 *
 * Counting the range is not here either. That belongs to `selectChatTail` in `tail-rewrite.ts`, the
 * same function storage uses when it actually deletes. This file only counts that result, so the
 * text cannot say '12 will be deleted' while 13 are removed.
 */

/**
 * Actions a message can have. They vary by role, and unavailable ones are hidden rather than greyed
 * out.
 */
export type MessageAction =
	| "copy"
	| "edit"
	| "regenerate"
	| "delete-from"
	| "report";

/**
 * Actions per role. Unavailable actions are hidden, not disabled.
 *
 * A greyed-out item reads as 'something that will work later', and users spend time searching for a
 * way to press it.
 *
 * Edit is available to both roles. The rationale is in `canEditMessageRole` in `tail-rewrite.ts`.
 * In short: until now the only way to fix one name in a paragraph the model wrote was `Regenerate`
 * (Regenerate), which discards the text just read. The two edits share a word but have different
 * storage entry points (`editUserMessage` and `editAssistantMessage`), and storage re-checks the
 * role for each.
 *
 * Edit sits next to `Regenerate` on purpose. They answer the same anchor differently (one regenerates,
 * the other edits as-is), and only the person who read the response knows which is right.
 *
 * Report is available only on assistant responses. Reporting one's own message as an 'AI response'
 * uses the wrong term, and the item would give users a path to report their own text. This list and
 * the evidence builder (`buildAiResponseEvidence`) make the same decision, so if one is loosened
 * the other still blocks it.
 */
export function messageActionsFor(role: ChatRole): readonly MessageAction[] {
	return role === "user"
		? (["copy", "edit", "delete-from"] as const)
		: (["copy", "edit", "regenerate", "report", "delete-from"] as const);
}

/** What counting needs: the order key and identity. Not the whole message. */
type Countable = Pick<ChatMessage, "id" | "createdAt">;

/**
 * The number of messages remaining **after** this message.
 *
 * Counting on the list the screen already holds is valid. The subscription window is always one
 * recent slice, and the anchor is a message the user picked on screen, so everything after it is
 * inside the same window. Messages loaded further up are before the anchor.
 *
 * If the anchor is not in the list, return null, not 0. Merging the two makes 'nothing to delete'
 * and 'unknown what to delete from' the same value, and a confirmation built from the second would
 * show a number unrelated to what is actually deleted.
 */
export function countLaterMessages(
	messages: readonly Countable[],
	anchorId: string,
): number | null {
	return selectChatTail(messages, anchorId, "after")?.length ?? null;
}

/**
 * The edit form's decision: a branch, not copy.
 *
 * `invalid` carries a `reason` instead of a sentence. Each app translates the reason into its own
 * words (for example `Enter a message.`), but what counts as a valid value is decided in one place
 * only.
 */
export type ChatMessageEditPlan =
	/** A value that cannot be saved. The caller states the reason on the spot. */
	| { kind: "invalid"; reason: ChatMessageContentRejection }
	/**
	 * Nothing changed and nothing to delete: close without writing.
	 *
	 * Writing is wrong because editing is activity. A conversation opened and saved unchanged would
	 * rise to the top of the list, and the user would read that as something they did not do.
	 *
	 * If there is something to delete, saving happens even when content is unchanged. The user
	 * confirmed 'continue from here', not the sentence, and that is what should actually happen.
	 */
	| { kind: "unchanged" }
	| { kind: "save"; content: string };

export function planMessageEdit(
	input: string,
	current: string,
	later: number,
): ChatMessageEditPlan {
	const checked = checkMessageContent(input);
	if (!checked.ok) return { kind: "invalid", reason: checked.reason };
	if (checked.content === current && later === 0) return { kind: "unchanged" };
	return { kind: "save", content: checked.content };
}

/**
 * How many messages from the end must be read to bring this message into the subscription window.
 *
 * `index` is the position in the array search saw (ascending, all live messages). The window always
 * opens from the newest side, so the size needed is the count from that position to the end.
 *
 * The number need not be exact. The window may include deleted rows, and then the screen opens one
 * more page. The job here is to return a value that is almost right, so the round trip is usually
 * avoided.
 *
 * Web and mobile must use the same value because a failed jump is silent. A jump off by one looks
 * like 'roughly that area' and is hard to notice, and a message that never gets pulled in causes
 * nothing visible.
 */
export const messagesFromEnd = (total: number, index: number): number =>
	Math.max(1, total - index);
