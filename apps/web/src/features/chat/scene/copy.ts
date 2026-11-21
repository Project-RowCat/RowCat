import { compareMessagePosition } from "@rowcat/chat";

/**
 * Small display helpers for the scene controls. No rule lives here: which scene is in effect, what a
 * control writes and how history is classified all come from `@rowcat/chat` (`scene-controls.ts`).
 */

/**
 * The head of a message, so a scene in the list says where it starts. Whitespace is folded (a
 * message that opens with a blank line would otherwise read as empty) and the cut is counted in
 * code points so an emoji is never halved.
 */
export function messageExcerpt(content: string, max = 28): string {
	const points = [...content.replace(/\s+/g, " ").trim()];
	return points.length > max
		? `${points.slice(0, max).join("")}…`
		: points.join("");
}

type Positioned = { id: string; createdAt: string };

/** The earliest of the room's messages by the shared position order, or null. */
export function earliestMessage<T extends Positioned>(
	messages: readonly T[],
): T | null {
	let first: T | null = null;
	for (const message of messages)
		if (!first || compareMessagePosition(message, first) < 0) first = message;
	return first;
}

/** The latest of the room's messages by the shared position order, or null. */
export function latestMessage<T extends Positioned>(
	messages: readonly T[],
): T | null {
	let last: T | null = null;
	for (const message of messages)
		if (!last || compareMessagePosition(message, last) > 0) last = message;
	return last;
}
