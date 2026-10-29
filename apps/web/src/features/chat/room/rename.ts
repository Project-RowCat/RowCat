import type { ChatRoomRenamePlan, ChatRoomTitleRejection } from "@rowcat/chat";
import {
	CHAT_ROOM_TITLE_MAX_LENGTH,
	chatTextLength,
	planRoomRename,
} from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Rename form copy. The rules live in `@rowcat/chat`.
 *
 * The rules (`planRoomRename`, `chatTextLength`) moved out because there are now two consumers: the
 * web dialog and the mobile sheet. Getting them wrong fails silently: the save button does nothing,
 * an unchanged conversation jumps to the top of the list, or only people who mix emoji see their
 * character count double.
 *
 * The copy stays here for the opposite reason. The table that turns rejection reasons into
 * sentences is locale-bound, and if Korean entered the pure package, the rules would become
 * locale-aware.
 */

export type RenamePlan =
	/** A value that cannot be saved; the reason is stated right there. */
	| { kind: "invalid"; message: string }
	/**
	 * Nothing changed: close without writing. Renaming counts as activity, so saving an unchanged
	 * conversation would move it to the top of the list, and the user would read that as something
	 * they did.
	 */
	| { kind: "unchanged" }
	| { kind: "save"; title: string };

const rejectionCopy = (reason: ChatRoomTitleRejection): string =>
	translator("chat")(`rename.rejection.${reason}`, {
		max: CHAT_ROOM_TITLE_MAX_LENGTH,
	});

export function planRename(input: string, currentTitle: string): RenamePlan {
	const plan: ChatRoomRenamePlan = planRoomRename(input, currentTitle);
	return plan.kind === "invalid"
		? { kind: "invalid", message: rejectionCopy(plan.reason) }
		: plan;
}

/**
 * A save failure as one sentence a person can read. The raw Dexie message (`QuotaExceededError:
 * ...`) is not shown: it does not say what the user can do, and it exposes internal structure.
 * Failures are deliberately not split: quota exceeded and a connection closed during an account
 * switch both lead to the same user action (retry).
 */
export const renameFailureMessage = (): string =>
	translator("chat")("rename.failed");

export const deleteFailureMessage = (): string =>
	translator("chat")("rename.deleteFailed");

/**
 * When to show the character count. Shown all the time, the number would follow the user through
 * the whole naming process and usually says nothing, so it appears only when the limit is close.
 */
export const COUNTER_THRESHOLD = CHAT_ROOM_TITLE_MAX_LENGTH - 20;

/** The length the screen counts. Must match the store's unit (code points). */
export const titleLength = chatTextLength;
