import { compareMessagePosition } from "@rowcat/chat";

/**
 * Copy and small display helpers for the scene controls. The chat folder has not moved to the
 * dictionary yet (`lib/i18n`), so its sentences live next to the screen like the memory panel's
 * (`memory/form.ts`); the wording matches web's English (`chat.scene` in its dictionary). No rule
 * lives here: which scene is in effect, what a control writes and how history is classified all come
 * from `@rowcat/chat` (`scene-controls.ts`).
 */
export const SCENE_COPY = {
	chipNone: "Scene",
	chipEveryone: "Everyone present",
	chipNarrator: "No character present",
	chipLabel: (state: string) => `Scene: ${state}`,
	title: "Scene",
	description:
		"Who is present decides which characters can know what is said. A change applies from the next message.",
	nowNone: "No scene yet. Every character knows everything said here.",
	nowEveryone: "Everyone is present.",
	nowNarrator: "No character is present.",
	nowParticipants: (names: string) => `Present: ${names}`,
	unknownNames: "characters no longer in this conversation",
	start: "Start a scene",
	change: "Change who's here",
	end: "End scene",
	endHint: "Everyone is present again from the next message.",
	waitForReply: "Wait for the reply to finish before changing the scene.",
	pickLabel: "Who's present?",
	pickEmpty: "Pick at least one.",
	pickTooMany: (max: number) => `Up to ${max} can be present.`,
	kindEveryone: "Everyone",
	kindParticipants: "Only these",
	kindNarrator: "No character",
	you: (name: string) => `${name} (you)`,
	apply: "Apply",
	cancel: "Cancel",
	historyQuestion:
		"This conversation already has messages. How should characters treat what was said before this scene?",
	history: {
		shared: { label: "Shared", effect: "Every character keeps knowing it." },
		private: {
			label: "Private",
			effect: "No character can recall it. It stays on screen.",
		},
		review: {
			label: "Decide later",
			effect: "Treated as private until you decide.",
		},
	},
	unclassified: (count: number) =>
		count === 1
			? "1 earlier message is unclassified. Until you decide, no character can recall it."
			: `${count} earlier messages are unclassified. Until you decide, no character can recall them.`,
	listTitle: "Scenes in this conversation",
	listNoMessages: "No messages yet",
	listEveryone: "Everyone",
	listNarrator: "No character",
	correct: "Correct",
	correctFor: (excerpt: string) => `Correct who was present from ${excerpt}`,
	correctNote:
		"This changes who witnessed what was already said in this scene.",
	delete: "Delete",
	deleteFor: (excerpt: string) => `Delete the scene from ${excerpt}`,
	deleteWarning:
		"Its messages will belong to the scene before it, so whoever was present there will know them. With no scene before it, they become unclassified earlier history.",
	failed: "Couldn't save the scene. Please try again.",
} as const;

/**
 * The head of a message, so a scene in the list says where it starts. Whitespace is folded (a
 * message that opens with a blank line would otherwise read as empty) and the cut is counted in
 * code points so an emoji is never halved. Same as web's `scene/copy.ts`.
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
