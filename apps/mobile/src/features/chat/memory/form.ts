import type {
	ChatMemoryContentRejection,
	ChatMemoryStatus,
	MemoryVisibility,
	MemoryVisibilityOption,
} from "@rowcat/chat";
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

/**
 * How many human-written memories are withheld until classified (`unresolvedMemoryCount` in
 * `@rowcat/chat` decides when; this is only the sentence). Web's memory window states the same fact.
 */
export const needsClassificationMessage = (count: number): string =>
	count === 1
		? "1 memory needs classifying. Until you choose who knows it, it isn't used in this conversation."
		: `${count} memories need classifying. Until you choose who knows them, they aren't used in this conversation.`;

/** One line stating who may know a memory (`memoryVisibility`), or null where scenes do not apply. */
export function memoryVisibilityText(
	visibility: MemoryVisibility,
): string | null {
	switch (visibility.state) {
		case "not-applicable":
			return null;
		case "unresolved":
			return visibility.blocking
				? "Needs classifying · not used until you choose"
				: "Not classified yet";
		case "shared":
			return "Every character knows this";
		case "narrator":
			return "No character knows this";
		case "restricted":
			return visibility.names.length > 0
				? `Known by: ${visibility.names.join(", ")}`
				: "Known by: characters no longer in this conversation";
	}
}

/** The label of one choice `memoryVisibilityOptions` offers. */
export function memoryVisibilityOptionLabel(
	option: MemoryVisibilityOption,
): string {
	switch (option.kind) {
		case "share":
			return "Every character";
		case "current-scene":
			return `Only this scene: ${option.names.join(", ") || "characters no longer in this conversation"}`;
		case "choose":
			return "Choose characters…";
		case "narrator":
			return "No character";
	}
}

/** The accessible name of a choice, carrying which memory it acts on (same reason as pin/edit). */
export const memoryVisibilityOptionAccessibilityLabel = (
	option: MemoryVisibilityOption,
	label: string,
): string =>
	`Who knows memory ${label}: ${memoryVisibilityOptionLabel(option)}`;

export const CHOOSE_AUDIENCE_LABEL = "Characters who know this memory";

/**
 * Whether long-term memory works here (`memoryStatusFor`). `ready` stays quiet, and so does
 * `degraded`: that is a per-turn fact this screen cannot know before a turn ran. No backend is named.
 */
export function memoryStatusMessage(status: ChatMemoryStatus): string | null {
	if (status === "unavailable")
		return "Long-term memory isn't available on this device. Only the recent conversation and the memories you wrote are used.";
	if (status === "indexing")
		return "Long-term memory is still catching up on this conversation.";
	return null;
}
