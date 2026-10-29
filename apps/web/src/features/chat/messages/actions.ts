import type { ChatMessageEditPlan, ChatRole } from "@rowcat/chat";
import { planMessageEdit as planMessageEditRule } from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Copy for message actions. The rules live in `@rowcat/chat`.
 *
 * This file once held both the rules and the copy. The rules moved out because there are now two
 * consumers: the mobile conversation screen must make the same decision, and if each app wrote its
 * own, the divergence has a known direction (one app counts the boundary differently and says
 * "delete 12" while deleting 13).
 *
 * The copy stays here for the opposite reason. The confirmation sentences are tied to the locale,
 * and on some surfaces it is normal for the web dialog and the mobile bottom sheet to use different
 * words for the same situation. Putting Korean into the pure package would freeze that distinction
 * (see the package header rule).
 *
 * So what lives here is only **count → sentence** and **reason → sentence**. Counting the range to
 * delete is still done by one function, `selectChatTail` (the same function the store uses when it
 * actually deletes).
 */

export type { MessageAction } from "@rowcat/chat";
export { countLaterMessages, messageActionsFor } from "@rowcat/chat";

/* ══════════════════════════════════════════════════════════════════════════
 * Confirmation copy
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The confirmation for `Delete from here` (delete from here) — **it states the count.**
 *
 * It does not blur into "this message will be deleted" because the operation removes everything
 * after an anchor, not just the anchor. What the user sees is usually the last few lines, so when
 * an upper message is chosen the real range continues beyond the screen.
 */
export function deleteFromMessageCopy(later: number): string {
	return later === 0
		? translator("chat")("messageActions.deleteOne")
		: translator("chat")("messageActions.deleteMany", { later });
}

/**
 * The warning when regenerating an assistant response that has a tail. **Null when there is none.**
 *
 * Regenerating the last response is common and needs no confirmation: the only thing removed is the
 * response just read, which the person pressed the button for because they did not like it.
 * Regenerating an upper response, though, discards everything beneath it, and doing so silently
 * would leave the user unaware of what they lost.
 */
export function regenerateWarningCopy(later: number): string | null {
	return later === 0
		? null
		: translator("chat")("messageActions.regenerateWarning", { later });
}

/**
 * What the edit window changes — **a different sentence per role.**
 *
 * One sentence cannot cover both. The old copy read "this edits **your** messages stored on this
 * device", and now that editing is open to assistant responses that sentence is **false** in that
 * window: the user edits the model's text while being told they are editing their own.
 *
 * The assistant sentence is one line longer for a fact only this action has: even after editing,
 * the text is still the response the model produced, and regenerating is a different button next to
 * it. Without that distinction in the sentence, `Updated` (edit) and `Regenerate` (regenerate) read as two
 * names for the same thing.
 */
export function editDialogDescription(role: ChatRole): string {
	const t = translator("chat");
	const synced = t("messageActions.synced");
	return role === "user"
		? t("messageActions.editUser", { synced })
		: t("messageActions.editAssistant", { synced });
}

/** The line the edit window places above the save button. Says nothing when there is nothing to delete. */
export function editWarningCopy(later: number): string | null {
	return later === 0
		? null
		: translator("chat")("messageActions.editWarning", { later });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Edit form
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The plan is set by the shared rule (`planMessageEdit` in `@rowcat/chat`). Here the rejection
 * reason gets a sentence. That is why this app's `MessageEditPlan` still has `message`: the dialog
 * draws that value as is.
 */
export type MessageEditPlan =
	| { kind: "invalid"; message: string }
	| { kind: "unchanged" }
	| { kind: "save"; content: string };

const emptyMessage = (): string => translator("chat")("messageActions.empty");

export function planMessageEdit(
	input: string,
	current: string,
	later: number,
): MessageEditPlan {
	const plan: ChatMessageEditPlan = planMessageEditRule(input, current, later);
	return plan.kind === "invalid"
		? { kind: "invalid", message: emptyMessage() }
		: plan;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Failure
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Turns a save failure into one sentence a person can read.
 *
 * The raw Dexie error (`QuotaExceededError: ...`) is not shown: it does not say what the user can
 * do, and the string carries internal structure. Rename and delete already use the same rule
 * (`rename-room.ts`).
 */
export const editFailureMessage = (): string =>
	translator("chat")("messageActions.editFailed");

export const deleteFromFailureMessage = (): string =>
	translator("chat")("messageActions.deleteFromFailed");

export const regenerateFailureMessage = (): string =>
	translator("chat")("messageActions.regenerateFailed");
