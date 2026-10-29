import type { ConversationDisplayMessage } from "./conversation.ts";
import type { MessageAction } from "./message-actions.ts";
import { messageActionsFor } from "./message-actions.ts";
import type { ChatSeed } from "./model.ts";
import type { ChatPersonaSnapshot } from "./persona.ts";
import type { ChatCastName } from "./placeholder.ts";
import {
	chatPlaceholderNames,
	resolveChatPlaceholders,
} from "./placeholder.ts";

/**
 * The opening: the start scene drawn as the first line of the record.
 *
 * Before this, the value existed only in the prompt. The assembler folded the scene into the system
 * side (foldFirstScene in context.ts), and the screen drew nothing. A user who had just pressed `Start
 * conversation` saw an empty screen and a hint line. The model knew the scene; the user did not.
 *
 * Not saved. The line is never written to the room (ChatStore.appendMessage). A stored record would
 * get dirty flags, a revision and a tombstone, and would ship in the next push, so the same text
 * would live in two places: the system prompt and history. If the user deleted the line with
 * 'delete from here', the prompt's copy would stay.
 *
 * The return type is ConversationDisplayMessage, a type for rows that are drawn but not persisted.
 * It keeps such a line from having to invent sync metadata. This file is that type's second
 * consumer; the first is the streaming response.
 *
 * No migrations: the server route, the database, the Dexie and SQLite schemas and the sync protocol
 * are unchanged.
 *
 * What the opening is gets decided in one place. resolveOpeningScene is called by both the
 * assembler and the screen. If they split, the drawn text and the sent text could differ. That
 * shows up not as an error but as the model continuing a scene absent from the screen, which the
 * user blames on the model.
 *
 * Protected prompts still get an opening. promptProtected hides the creative prompt (scenario,
 * progress guidance, character cards); the opening scene was written to be read. The input type
 * omits that field, because a field nothing reads should not be passed as an argument. Someone
 * would eventually attach a condition to it.
 *
 * No display labels here. A label such as `Opening scene` would bind the pure package to a locale. That word
 * is the authoring tool's vocabulary; to a reader this line is simply the start of the story.
 */

/**
 * Stable string identity of the opening line, not an index. The virtualizer keys on this value, so
 * when a page loads above, the opening's measured height is not handed to another row. It cannot
 * collide with stored ids: those are hyphen-less UUIDs, which contain no colon. The streaming
 * temporary id follows the same convention (`streaming:pending`).
 */
export const OPENING_MESSAGE_ID = "opening:first-scene";

/** Whether this line is the opening. Answered from the id alone, without searching storage. */
export const isOpeningMessage = (id: string): boolean =>
	id === OPENING_MESSAGE_ID;

/**
 * Only the fields actually read to decide the opening. ChatSeed and PlaytestSnapshot['seed'] are
 * supersets of this shape, so callers pass them through. The name fields were added later. The
 * opening really contains {{char}} and {{user}}, and those names belong to the character card and
 * the counterpart. The rule that a type takes no axis it does not read still holds: the placeholder
 * replacer reads those two.
 */
export type OpeningSeed = Pick<
	ChatSeed,
	"firstScene" | "startScenes" | "persona" | "characters"
>;

/**
 * The opening text: the explicit value if present, otherwise the first candidate. Ignoring
 * candidates would leave a work that offers its opening only as candidates starting with no
 * opening, so the context is empty from the first turn. A whitespace-only value counts as absent:
 * an empty bubble is worse than saying there is no opening.
 */
export function resolveOpeningScene(
	seed: OpeningSeed,
	/**
	 * The role the user plays in this conversation. If omitted, the work's suggested counterpart. The
	 * opening contains {{user}}, and that name can differ per room. If the room's override is not
	 * passed, the conversation starts with the name the user chose, but the first line keeps the
	 * work's default name. No error appears, and the user cannot tell what they got wrong.
	 */
	userPersona: ChatPersonaSnapshot | null = seed.persona,
	/**
	 * The characters in this conversation: the second source of {{char}}. Many works put {{char}} in
	 * their opening, and a v2 work's seed.characters is always empty. If not passed, the placeholder
	 * shows on the first line only. The assembler replaces the same sentence with the name before
	 * sending it to the model, so the screen and the prompt diverge.
	 */
	cast: readonly ChatCastName[] = [],
): string {
	const explicit = seed.firstScene.trim();
	const scene = explicit || (seed.startScenes[0]?.content.trim() ?? "");
	/*
	 * Name substitution happens here, extending the rule above that the opening is decided in one
	 * place. If the screen and the assembler each substituted, it would be possible to draw text with
	 * one name and send it with another. The symptom is not an error but the model addressing the
	 * counterpart by a name that differs from the screen. Substitution is idempotent, so passing an
	 * already-substituted seed gives the same result.
	 */
	return resolveChatPlaceholders(
		scene,
		chatPlaceholderNames(seed, userPersona, cast),
	);
}

/**
 * The opening as the first record line. null if there is none, so no empty line is created. The
 * speaker is empty, as it is for assistant replies. The opening can involve several characters, so
 * attaching one name would be wrong information.
 */
export function openingMessage(
	seed: OpeningSeed,
	userPersona: ChatPersonaSnapshot | null = seed.persona,
	cast: readonly ChatCastName[] = [],
): ConversationDisplayMessage | null {
	const content = resolveOpeningScene(seed, userPersona, cast);
	if (!content) return null;
	return {
		id: OPENING_MESSAGE_ID,
		role: "assistant",
		speaker: "",
		content,
	};
}

/**
 * The only action available on the opening is copy. Why the other four cannot be here:
 * - edit: a user-message action, and the role differs.
 * - regenerate: this text was never generated. It is the author's manuscript.
 * - delete from here: the tail to delete is the entire conversation, and it is redrawn on the
 *   next render because it is not a record.
 * - report: not the target of 'report AI response'. Reporting the creator's content belongs to
 *   work reporting. Actions that cannot be fulfilled are not drawn disabled. A disabled button is a
 *   promise that cannot be kept.
 */
const OPENING_ACTIONS: readonly MessageAction[] = ["copy"];

/**
 * First question for a record row: is it a stored record, not which role it has. This function
 * exists so the screen does not write `isOpeningMessage(...) ? [...] : messageActionsFor(...)`
 * itself. If web and mobile wrote that condition separately, they would diverge in a known
 * direction: one app keeps 'delete from here', which is pressable but does nothing, because there
 * is no record to delete. The per-role table is still messageActionsFor alone. It is not repeated
 * here.
 */
export function conversationRowActions(
	row: Pick<ConversationDisplayMessage, "id" | "role">,
): readonly MessageAction[] {
	return isOpeningMessage(row.id)
		? OPENING_ACTIONS
		: messageActionsFor(row.role);
}
