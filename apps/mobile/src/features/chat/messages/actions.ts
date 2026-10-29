import type {
	ChatMessageEditPlan,
	ChatRoomTitleRejection,
	MessageAction,
} from "@rowcat/chat";
import {
	CHAT_ROOM_TITLE_MAX_LENGTH,
	planMessageEdit as planMessageEditRule,
	planRoomRename,
} from "@rowcat/chat";
import type { IconName } from "@rowcat/ui-native";

/**
 * Copy and icons for the message and rename forms; the rules belong to `@rowcat/chat`. This file
 * makes no decisions: the per-role action list, delete count and save/skip all go through the
 * shared functions (`messageActionsFor`, `countLaterMessages`, `planMessageEdit`,
 * `planRoomRename`). Separate tables per app would diverge in only one app (web deleting 12
 * messages while the app deletes 13).
 *
 * What stays here is locale- and platform-bound: Korean copy (the pure package carries none), the
 * action-to-icon-name map (web calls Lucide components directly) and the words drawn in the
 * overflow menu rows.
 */

export type { MessageAction } from "@rowcat/chat";
export { countLaterMessages, messageActionsFor } from "@rowcat/chat";

/**
 * Action to on-screen label. Shorter than web's wide-screen icon labels (`Regenerate from this reply`), which are
 * hover tooltips; here the word is drawn in a menu row and must read in a narrow width. Web's
 * narrow menu uses the same words. Which reply it applies to is already said by the message that
 * opened the menu.
 */
export const MESSAGE_ACTION_LABEL: Record<MessageAction, string> = {
	copy: "Copy",
	edit: "Edit message",
	regenerate: "Regenerate",
	report: "Report",
	"delete-from": "Delete from here",
};

/** Same set web uses for the same actions (`icon.tsx` holds the pairing). */
export const MESSAGE_ACTION_ICON: Record<MessageAction, IconName> = {
	copy: "copy",
	edit: "edit",
	regenerate: "regenerate",
	report: "report",
	"delete-from": "delete-from",
};

/**
 * Accessible name of the overflow trigger. It names the role, not the body: every line has one, and
 * putting the body in the name would make screen readers read the same text twice. Same judgment as
 * web.
 */
export const messageMenuLabel = (role: "user" | "assistant"): string =>
	role === "user" ? "My message menu" : "Reply menu";

/* Confirmation copy */

/**
 * Confirmation for `Delete from here`. It states the count because the action deletes everything after the
 * anchor, and for a message high up that reaches beyond the screen.
 */
export const deleteFromMessageCopy = (later: number): string =>
	later === 0
		? "This message will be deleted."
		: `This message and the ${later} after it will be deleted.`;

/**
 * Warning for regenerating an assistant response that has a tail; `null` when there is none.
 * Regenerating the last response is common and needs no confirmation (only the response the user
 * just rejected is removed). Regenerating a higher one discards the conversation below it, and
 * doing that quietly leaves the user not knowing what they lost.
 */
export const regenerateWarningCopy = (later: number): string | null =>
	later === 0
		? null
		: `Regenerating from this reply deletes the ${later} messages after it.`;

/** The edit dialog's line above the save button; silent when nothing is deleted. */
export const editWarningCopy = (later: number): string | null =>
	later === 0 ? null : `Saving deletes the ${later} messages after this one.`;

export const DELETE_FROM_CONFIRM_TITLE = "Delete from here?";
export const REGENERATE_CONFIRM_TITLE = "Regenerate from this reply?";

/**
 * Description when there is no tail to delete. The dialog normally does not open then
 * (`regenerateWarningCopy` is null so it runs immediately); it opens only when that immediate run
 * fails, and an empty description would not say what is being redone.
 */
export const REGENERATE_PLAIN_COPY = "Deletes this reply and makes it again.";

/* Forms */

/** This app's edit plan: the shared branches with sentences attached. */
export type MessageEditPlan =
	| { kind: "invalid"; message: string }
	| { kind: "unchanged" }
	| { kind: "save"; content: string };

const EMPTY_MESSAGE = "Please enter a message.";

export function planMessageEdit(
	input: string,
	current: string,
	later: number,
): MessageEditPlan {
	const plan: ChatMessageEditPlan = planMessageEditRule(input, current, later);
	return plan.kind === "invalid"
		? { kind: "invalid", message: EMPTY_MESSAGE }
		: plan;
}

export type RenamePlan =
	| { kind: "invalid"; message: string }
	| { kind: "unchanged" }
	| { kind: "save"; title: string };

const TITLE_REJECTION_COPY: Record<ChatRoomTitleRejection, string> = {
	empty: "Please enter a conversation name.",
	too_long: `Names can be up to ${CHAT_ROOM_TITLE_MAX_LENGTH} characters.`,
};

export function planRename(input: string, currentTitle: string): RenamePlan {
	const plan = planRoomRename(input, currentTitle);
	return plan.kind === "invalid"
		? { kind: "invalid", message: TITLE_REJECTION_COPY[plan.reason] }
		: plan;
}

/* Failures */

export const EDIT_FAILURE_MESSAGE =
	"Couldn't edit the message. Please try again.";

export const DELETE_FROM_FAILURE_MESSAGE =
	"Couldn't delete the conversation. Please try again.";

export const REGENERATE_FAILURE_MESSAGE =
	"Couldn't regenerate. Please try again.";
