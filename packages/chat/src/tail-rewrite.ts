import type { ChatRole } from "./model.ts";

/**
 * Tail rewrite: fixing an earlier message removes everything after it. This is one rule.
 * - V1 conversations are linear: no branches, alternate responses, or cross-generation
 *   operations. Editing a middle message alone creates a state that cannot be represented. Later
 *   responses were generated from the pre-edit message, so their causality breaks silently: nothing
 *   shows on screen, and the next turn's context is built on a conversation that no longer exists.
 * - Edit, regenerate, and delete-from-here are three faces of one operation: choose an anchor and
 *   remove what follows it. If each chose its own tail, one boundary mismatch (inclusive versus
 *   exclusive, or sort axis) would leave orphans or delete too much. This file owns the rule.
 * - The order axis is (createdAt, id) because the repository already sorts that way (the
 *   [roomId+createdAt+id] index and the listRecentMessages contract). Do not add a second order
 *   field such as sequence or position: its values would diverge from the index, and the screen
 *   order and the deletion range would split in a way visible only after deletion.
 * - The module knows nothing of React or the store. The web app and the future Expo app must
 *   delete the same range, and the rule must be checkable without rendering, because it is the
 *   boundary of an irreversible operation.
 */

/**
 * Whether the anchor itself is included.
 * - from: deletes the anchor and everything after it (`Delete from here`, assistant `Regenerate`).
 * - after: keeps the anchor and deletes only what follows it (user message edit).
 */
export type ChatTailMode = "after" | "from";

/**
 * What tail selection actually reads: the order axis and identity. It does not require the full
 * message.
 */
export interface ChatMessageOrder {
	id: string;
	/** ISO 8601. The first component of the repository's sort axis. */
	createdAt: string;
}

/**
 * Total order in the same sequence the repository scans. The point is breaking ties on createdAt by
 * id. Two messages can be saved in the same millisecond (a response right after a paste, or a fake
 * clock in tests). Without a deterministic tie-break, the screen order and the deletion range
 * diverge. The composite index already sorts this way, so this comparator only restates that rule.
 */
export function compareChatMessageOrder(
	a: ChatMessageOrder,
	b: ChatMessageOrder,
): number {
	if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
	if (a.id === b.id) return 0;
	return a.id < b.id ? -1 : 1;
}

/**
 * Messages to delete, in ascending order. Selection uses order keys, not array indexes: the input
 * may not be the whole room (the screen holds only the latest page) and may not be sorted, so
 * slicing by position goes wrong right after older messages are loaded. If the anchor is not in the
 * list, returns null rather than an empty array. Merging the two would make 'nothing to delete' and
 * 'unknown anchor' the same value, and code that silently proceeds in the latter case ends up
 * deleting the whole room with no anchor. Callers do nothing on null.
 */
export function selectChatTail<T extends ChatMessageOrder>(
	messages: readonly T[],
	anchorId: string,
	mode: ChatTailMode,
): T[] | null {
	const anchor = messages.find((message) => message.id === anchorId);
	if (!anchor) return null;
	const floor = mode === "from" ? 0 : 1;
	return messages
		.filter((message) => compareChatMessageOrder(message, anchor) >= floor)
		.sort(compareChatMessageOrder);
}

/**
 * The result of one tail rewrite. `applied` exists because `removed: 0` has two meanings: either
 * nothing came after the last message being edited, or the anchor had already vanished (deleted in
 * another tab, or a remote tombstone arrived) so nothing happened. In the second case, starting
 * generation afterward would attach a response to an edit the user had effectively cancelled.
 */
export interface ChatTailRewrite {
	/**
	 * Whether the anchor was still alive, so the rewrite was actually applied. If false, the store
	 * changed nothing.
	 */
	applied: boolean;
	/** Number of messages tombstoned. The anchor itself counts only in `from` mode. */
	removed: number;
}

/**
 * The table lives here because the screen and the store must agree on the answer. The screen's
 * rendering guarantees nothing to the store, and a value that breaks the rule would sync to other
 * devices.
 *
 * Editing is now allowed for both roles, and that is the table's only change. Assistant editing was
 * closed earlier on the reasoning that a hand edit is a different product from regeneration. That
 * was a reason to build the operation differently, not to withhold it: users want to fix one word
 * in a model paragraph and continue.
 *
 * The tail rule and provenance metadata (`model`, usage) are unchanged. A role change is still
 * never allowed: an edited assistant message does not fold into a user utterance, since that would
 * falsify the speaker name, reportability, and speaker prefix together.
 */
export const canEditMessageRole = (role: ChatRole): boolean =>
	role === "user" || role === "assistant";

/** Regeneration applies to assistant responses only. A user message has nothing to regenerate. */
export const canRegenerateMessageRole = (role: ChatRole): boolean =>
	role === "assistant";

/* Copy and `Delete from here` have no predicate: both roles allow them, so there is nothing to check. */

export type ChatMessageContentRejection = "empty";

export type ChatMessageContentCheck =
	| { ok: true; content: string }
	| { ok: false; reason: ChatMessageContentRejection };

/**
 * Whether an edit is an acceptable value. It uses the same rule as sending (`canStartGeneration`'s
 * `text.trim().length > 0`) and nothing more. No new length cap is added for edits, because an
 * already-saved long message would become unsaveable in its own editor. The request-side cap is
 * already enforced by the assembler (`clampContent` in context.ts). An empty value is deliberately
 * not treated as deletion. `Delete from here` exists separately, and a save button that silently becomes a
 * delete button is the most common way to trigger an irreversible action by mistake.
 */
export function checkMessageContent(input: string): ChatMessageContentCheck {
	const content = input.trim();
	if (content.length === 0) return { ok: false, reason: "empty" };
	return { ok: true, content };
}

/**
 * Thrown when an edit breaks the content rule. It records that the store does not trust the screen
 * to have checked this.
 */
export class ChatMessageContentError extends Error {
	readonly reason: ChatMessageContentRejection;
	constructor(reason: ChatMessageContentRejection) {
		super("a message cannot be empty");
		this.name = "ChatMessageContentError";
		this.reason = reason;
	}
}

/**
 * The operation received a role it does not accept. This is a caller bug, not user input. Since
 * both roles became editable, the meaning narrowed: it used to mean 'this role cannot be edited'
 * and now means 'this is not the role this door accepts'. Sending an assistant message through
 * editUserMessage is still a bug, and passing it silently would commit a speaker prefix and
 * reportability that disagree with the stored role.
 */
export class ChatMessageRoleError extends Error {
	readonly role: ChatRole;
	/** The role this operation accepts. The diagnostic states what the call should have been. */
	readonly expected: ChatRole;
	constructor(role: ChatRole, expected: ChatRole) {
		super(`a ${role} message arrived at a ${expected} message edit`);
		this.name = "ChatMessageRoleError";
		this.role = role;
		this.expected = expected;
	}
}

export function requireMessageContent(input: string): string {
	const checked = checkMessageContent(input);
	if (!checked.ok) throw new ChatMessageContentError(checked.reason);
	return checked.content;
}

/**
 * Throws unless the role is the one this edit operation accepts. The repository calls it right
 * before writing. The expected role is an argument because a predicate asking only whether a
 * message is editable blocks nothing once both roles are editable. What must be blocked is entry
 * through the wrong door: an assistant response passed to editUserMessage would get user-edit rules
 * (cut the tail at `after`, keep the speaker) applied to another record. Taking the expected role
 * as an argument makes each operation pin its own role as a value.
 */
export function requireEditableRole(role: ChatRole, expected: ChatRole): void {
	if (role !== expected) throw new ChatMessageRoleError(role, expected);
}
