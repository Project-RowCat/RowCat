import type { ChatCharacter } from "./character.ts";
import type { ChatSeed } from "./model.ts";
import type { ChatPersonaSnapshot } from "./persona.ts";

/**
 * Replaces `{{char}}` and `{{user}}`, and their single-brace forms `{char}` and `{user}`, with
 * names. Authoring tools all have such a placeholder, so names can change later without editing
 * every scenario, character card and lore entry.
 *
 * Only unsaved text is substituted. Seed text (scenario, start scene, play guide, character cards,
 * partner description, lore) is substituted in the built prompt and the opening. The room's cast
 * and user-role description are substituted only in the request copy. Messages are substituted only
 * when rendered. Memory lines are never substituted, since the user typed them and can edit them in
 * a form.
 *
 * Messages were once not substituted at all, because stored text and screen text would diverge.
 * That was reversed when a model echoing `{{char}}` showed the raw word on screen. Stored values
 * stay unchanged, so copy, search and the edit form still see the original. Markdown normalization
 * (`normalizeChatMarkdown`) already follows the same render-only rule.
 *
 * If no name is known, the placeholder is kept. Deleting it would silently drop a sentence's
 * subject.
 *
 * Names themselves are not substituted; they are the source, and substituting them would be
 * circular.
 *
 * The default user name is the same value as the assembler's speaker prefix, so the model and the
 * scenario never name the user differently.
 */

/**
 * Name for the user when no persona is set. Must stay equal to the speaker prefix the prompt
 * assembler uses (`context.ts`).
 */
export const CHAT_DEFAULT_USER_NAME = "유저";

/**
 * A pair of names used for substitution. An empty string means the name is unknown, and the
 * placeholder is then left in the text.
 */
export interface ChatPlaceholderNames {
	char: string;
	user: string;
}

/**
 * The subset of fields needed to determine the names. `ChatSeed` and replay snapshots are both
 * supersets of this shape.
 */
export type ChatPlaceholderSource = Pick<ChatSeed, "persona" | "characters">;

/**
 * Reads only the names of characters added to this conversation. The type is narrowed rather than
 * using `ChatCharacter` because this file reads none of its other fields (sync metadata, tombstone,
 * parent room). The narrow type also lets character cards from replay snapshots fit the same slot,
 * since both answer 'who is in this story'.
 */
export type ChatCastName = Pick<ChatCharacter, "name">;

/**
 * Seed fields that can be substituted: all authored text. This set matches `ChatRuntimeSeed` by
 * design, since every authored value that reaches the prompt is text. The two types are still kept
 * separate. A non-text field, such as a number or flag, added to the runtime seed would make the
 * sets diverge.
 */
export type ChatPlaceholderSeed = Pick<
	ChatSeed,
	| "scenario"
	| "firstScene"
	| "playGuide"
	| "persona"
	| "characters"
	| "lore"
	| "startScenes"
>;

/**
 * Accepted notation: one or two braces, case-insensitive, inner whitespace allowed. Brace pairs are
 * counted in the replace callback, so `{{char}` and `{char}}` pass through unchanged. A single
 * regex listing `{{…}}` and `{…}` as alternatives would match the inner `{char}` in `{{char}` and
 * turn `{Sera` into a name. That half-brace leak is what this avoids. Lookbehind is not used because
 * this package also runs on Hermes, and mobile follows the same rule. The vocabulary is
 * deliberately only these two words. Macros such as `{{time}}` and `{{random}}` are
 * non-deterministic: they break the prompt cache prefix on every request and expose the clock and
 * RNG to the assembler.
 */
const PLACEHOLDER = /(\{{1,2})\s*(char|user)\s*(\}{1,2})/gi;

/**
 * What `{{char}}` and `{{user}}` mean for this seed. The second argument is the persona that
 * actually plays the user in this conversation. The default `seed.persona` exists because some
 * callers, such as the opening preview and the authoring tool, still pass only a seed. Conversation
 * runtime always passes `effectiveChatPersona(room)`. If the room's override does not win at this
 * point, the name the user picked never reaches the prompt. Priority is not restated here. The
 * caller decides it, so adding a new axis does not change this function.
 */
export function chatPlaceholderNames(
	seed: ChatPlaceholderSource,
	userPersona: ChatPersonaSnapshot | null = seed.persona,
	/**
	 * Characters entered into this conversation, as child records of the room (`character.ts`).
	 *
	 * Warning: until this parameter existed, `{{char}}` was never substituted in v2 works. The publish
	 * assembler always sends an empty `play.characters` (see the draft body section of `AGENTS.md`),
	 * so `seed.characters[0]` is always undefined there. The function then returned an empty name and
	 * left placeholders raw. The rule to leave raw text when the name is unknown is correct; the bug
	 * was that a name existed and was not read.
	 *
	 * The symptom was silent. `{{char}}` in scenario, lore and narration packs reached the model
	 * as-is, the model copied it, and the output showed the word. The cause was here, not on screen.
	 *
	 * The order matches the prompt's cast block (`context.ts`): the work's characters first, then the
	 * conversation's. Diverging would make the first character the model reads differ from the one
	 * `{{char}}` refers to.
	 */
	cast: readonly ChatCastName[] = [],
): ChatPlaceholderNames {
	return {
		/*
		 * In a room with several characters, `{{char}}` is the first card. The author's order marks the
		 * work's representative character, and there is no other basis for choosing. Choosing arbitrarily
		 * would make one work point at different characters on different runs. A whitespace-only name
		 * counts as absent (`||` rather than `??`). The save boundary rejects such names, but older
		 * records and replay snapshots skipped that check. One blank entry would otherwise hide a valid
		 * character behind it, and the symptom would again be no substitution.
		 */
		char: seed.characters[0]?.name.trim() || cast[0]?.name.trim() || "",
		user: userPersona?.name.trim() || CHAT_DEFAULT_USER_NAME,
	};
}

/**
 * Substitutes placeholders in one block of text with names. Idempotent: running it on
 * already-substituted text changes nothing, unless a name itself contains a placeholder. The
 * assembler substitutes the whole seed and then picks the opening, so the same text can pass
 * through twice. That must not change the result, which is what lets the two paths sit side by
 * side.
 */
export function resolveChatPlaceholders(
	text: string,
	names: ChatPlaceholderNames,
): string {
	/* Most text has no braces, so this cheap check skips the regex. */
	if (!text.includes("{")) return text;
	return text.replace(
		PLACEHOLDER,
		(match, open: string, key: string, close: string) => {
			if (open.length !== close.length) return match;
			const name = key.toLowerCase() === "char" ? names.char : names.user;
			return name || match;
		},
	);
}

/**
 * Returns a copy of the seed with all authored text substituted. Names are read from the original
 * seed, because the source of substitution is not itself substituted. The result is a new object on
 * purpose. Mutating the room record in place would push substituted text into storage, and then
 * changing the persona could not undo a name already baked in.
 */
export function resolveSeedPlaceholders<T extends ChatPlaceholderSeed>(
	seed: T,
	/**
	 * A name pair that has already been decided. If omitted, it is derived from the seed. The
	 * conversation runtime always passes it. Deriving it here would ignore the room's persona
	 * override. The symptom is not an error: only the `{{user}}` inside the scenario keeps the work's
	 * default name. The on-screen speaker would be right while the prompt is wrong, a mismatch no one
	 * can see.
	 */
	names: ChatPlaceholderNames = chatPlaceholderNames(seed),
): T {
	const at = (text: string) => resolveChatPlaceholders(text, names);
	/*
	 * The single cast is needed. Every replaced value is a `string` slot, so the shape of `T` is
	 * unchanged, but TypeScript will not accept an object literal for a generic `T`. Narrowing the
	 * return type would make callers that pass a `ChatSeed` lose `storyId` and `title`.
	 */
	return {
		...seed,
		scenario: at(seed.scenario),
		firstScene: at(seed.firstScene),
		playGuide: at(seed.playGuide),
		persona: seed.persona
			? { ...seed.persona, description: at(seed.persona.description) }
			: seed.persona,
		characters: seed.characters.map((character) => ({
			...character,
			description: at(character.description),
			personality: at(character.personality),
			speechStyle: at(character.speechStyle),
			exampleDialogue: at(character.exampleDialogue),
			prompt: at(character.prompt),
		})),
		/*
		 * Keys are substituted too. Keys are matched against recent conversation (`selectLore`), so a
		 * `{{char}}` key left as-is would never fire.
		 */
		lore: seed.lore.map((entry) => ({
			...entry,
			keys: entry.keys.map(at),
			content: at(entry.content),
		})),
		/*
		 * A scene's title is an authoring-tool label. It reaches neither the prompt nor the screen, so
		 * only the content is substituted.
		 */
		startScenes: seed.startScenes.map((scene) => ({
			...scene,
			content: at(scene.content),
		})),
	} as T;
}
