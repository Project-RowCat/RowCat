import { translator } from "#/lib/i18n/current.ts";
/**
 * Copy for runtime library rows. The rules are not here.
 *
 * Which rows are drawn and in what order is decided by mergeConversationLibrary in
 * @rowcat/domain and two functions in @rowcat/chat, which mobile also calls. Korean copy
 * stays here because the rules are tied to the locale.
 *
 * The words below must have the same values as the mobile counterpart file.
 */

/**
 * The only action on a runtime row, and it does not clear progress.
 *
 * `Delete conversation` is deliberately not used. That label means the room's messages and
 * memory are removed together (DELETE_ROOM_CONFIRM). Here only one library row is removed.
 * Playthrough progress and the records of earlier runs are kept, and reopening the work brings the
 * same row back with that progress.
 *
 * There is no confirmation dialog because the action is reversible and loses nothing.
 */
export const runtimeConversationRemoveLabel = (): string =>
	translator("chatLibrary")("runtime.remove");

/**
 * Accessible name of the row's menu trigger. It has the same shape as the room's `Manage … conversation` label
 * but uses a different noun.
 */
export function runtimeConversationActionsLabel(title: string): string {
	return translator("chatLibrary")("runtime.manage", { title });
}

/**
 * A line whose title is not known yet. This happens when the work's detail lookup failed on first
 * open.
 *
 * The next open fills in the title. A blank line would leave the user unable to tell which work it
 * is.
 */
export const runtimeConversationUntitled = (): string =>
	translator("chatLibrary")("runtime.untitled");

/**
 * Suffix for users who cannot see the screen, stating that this row is a runtime work and not a
 * room.
 */
export const runtimeConversationKindLabel = (): string =>
	translator("chatLibrary")("runtime.kind");

export const runtimeConversationRemoveFailure = (): string =>
	translator("chatLibrary")("runtime.removeFailed");

export const runtimeConversationTitle = (title: string): string =>
	title.trim().length > 0 ? title : runtimeConversationUntitled();
