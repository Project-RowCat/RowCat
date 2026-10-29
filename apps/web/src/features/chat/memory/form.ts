import type {
	ChatMemoryContentRejection,
	ChatMemorySavePlan,
} from "@rowcat/chat";
import {
	CHAT_MEMORY_CONTENT_MAX_LENGTH,
	chatTextLength,
	planMemorySave as planMemorySaveRule,
} from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Copy for the memory form. The rules live in `@rowcat/chat`.
 *
 * The rules moved out for the same reason as a rename: there are now two consumers (the web dialog
 * and the mobile sheet), and when any of these three is wrong the failure is silent. The add button
 * does nothing, an unfixed memory is saved and travels to other devices, or the order on screen
 * diverges from the order in the prompt.
 */

export type MemoryPlan =
	/** A value that cannot be saved. The reason is stated on the spot. */
	| { kind: "invalid"; message: string }
	/** Nothing changed. **Close without writing**, because an edit issues a revision. */
	| { kind: "unchanged" }
	| { kind: "save"; content: string };

const rejectionCopy = (reason: ChatMemoryContentRejection): string =>
	translator("chat")(`memory.rejection.${reason}`, {
		max: CHAT_MEMORY_CONTENT_MAX_LENGTH,
	});

export function planMemorySave(input: string, current?: string): MemoryPlan {
	const plan: ChatMemorySavePlan = planMemorySaveRule(input, current);
	return plan.kind === "invalid"
		? { kind: "invalid", message: rejectionCopy(plan.reason) }
		: plan;
}

/**
 * Turns a failure into one sentence a person can read.
 *
 * The raw Dexie error is not shown: it does not say what the user can do, and it carries internal
 * structure. Not splitting the cases is deliberate. Quota exceeded and a connection closed during
 * an account switch need the same action from the user.
 *
 * The count limit is separate. It is not a failure that retrying resolves; it means something must
 * be deleted, so folding it into the same sentence would make the user repeat the failure.
 */
export const memorySaveFailureMessage = (): string =>
	translator("chat")("memory.saveFailed");

export const memoryDeleteFailureMessage = (): string =>
	translator("chat")("memory.deleteFailed");

/** An operation arriving after the room is gone. It tells the user the room is not revived. */
export const memoryRoomGoneMessage = (): string =>
	translator("chat")("memory.roomGone");

/**
 * Whether to **show** the character count.
 *
 * Always visible, the number follows the user while typing and in most cases says nothing. It
 * appears only when the limit comes into view (the same rule and margin as renaming).
 */
export const MEMORY_COUNTER_THRESHOLD = CHAT_MEMORY_CONTENT_MAX_LENGTH - 100;

/** The length the screen counts. It must use the same unit as the store (code points). */
export const memoryContentLength = chatTextLength;

export { groupMemories } from "@rowcat/chat";
