import type { ChatMemoryContentRejection } from "@rowcat/chat";
import {
	CHAT_MEMORY_CONTENT_MAX_LENGTH,
	CHAT_MEMORY_MAX_PER_ROOM,
	ChatMemoryLimitError,
	planMemorySave as planMemorySaveRule,
} from "@rowcat/chat";

/**
 * Copy for the memory form; the rules live in `@rowcat/chat`. Both apps go through the shared
 * `planMemorySave`, so only wording is allowed to differ here.
 */

export type MemoryPlan =
	| { kind: "invalid"; message: string }
	| { kind: "unchanged" }
	| { kind: "save"; content: string };

const REJECTION_COPY: Record<ChatMemoryContentRejection, string> = {
	empty: "Please enter something to remember.",
	too_long: `Memories can be up to ${CHAT_MEMORY_CONTENT_MAX_LENGTH} characters.`,
};

export function planMemorySave(input: string, current?: string): MemoryPlan {
	const plan = planMemorySaveRule(input, current);
	return plan.kind === "invalid"
		? { kind: "invalid", message: REJECTION_COPY[plan.reason] }
		: plan;
}

/**
 * Only the count limit gets its own sentence: retrying cannot fix it, something has to be deleted.
 * Every other failure folds into one sentence because the user's next step is the same.
 */
export function memorySaveFailureMessage(failure: unknown): string {
	return failure instanceof ChatMemoryLimitError
		? `Up to ${CHAT_MEMORY_MAX_PER_ROOM} memories can be saved per conversation. Delete one and try again.`
		: "Couldn't save the memory. Please try again.";
}

export const MEMORY_DELETE_FAILURE_MESSAGE =
	"Couldn't delete the memory. Please try again.";

/** An operation that arrived after the room was gone; it is not resurrected, and the user is told. */
export const MEMORY_ROOM_GONE_MESSAGE =
	"This conversation no longer exists, so the memory can't be saved.";

/** The counter appears only near the limit (same margin as web); always-on it says nothing most of the time. */
export const MEMORY_COUNTER_THRESHOLD = CHAT_MEMORY_CONTENT_MAX_LENGTH - 100;

export const MEMORY_EMPTY_MESSAGE =
	"Write down what this conversation should keep remembering, and it's passed along whenever a reply is made.";
