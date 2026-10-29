import { assistantTailOpen } from "./continuation.ts";
import type { ChatMessage, ChatRole } from "./model.ts";

/**
 * Vocabulary and rules of suggestions: what is suggested, when it can appear, and what it reads.
 * Suggestions never send anything. A picked sentence goes into the input box, and a person sends
 * it.
 *
 * - Never sends on pick: a model-written sentence would otherwise become the user's own message
 *   before they read it. The repository already holds this line once: even in the narration pack's
 *   assisted or auto modes, which let the AI write the user's side, it never writes a consent
 *   sentence on the user's behalf (`ROLEPLAY_CONSENT`). A suggestion is a draft, not an utterance.
 *   It also keeps one press from costing two paid operations.
 * - Nothing is stored: no record, codec, TABLE_ORDER slot or server table. An unpicked suggestion
 *   disappears; a picked one becomes an ordinary user message through the existing save path.
 *   Storing it would add a fifth child record type to the room, with sync, tombstone and merge
 *   rules, for a value nobody reads back.
 * - No contract change: the request is an existing ChatGenerationRequest, sent through the
 *   existing managed router and BYO adapters. No new endpoint, migration or sync record.
 * - Not here: React or hooks, transport/provider/SDK, and screen copy. The app owns the
 *   failure-to-message mapping; both apps already have that table.
 */

/**
 * Number of suggestions: three. One would be an instruction with nothing to choose from; five take
 * longer to read than to write. Three fits a narrow screen and is the smallest count where the
 * directions genuinely differ: ask, act, or back off.
 *
 * Not a user setting. A setting would invite weighing count against cost, and the screen has no way
 * to show what one run costs.
 */
export const CHAT_REPLY_SUGGESTION_COUNT = 3;

/**
 * Length cap per suggestion, in code points. Kept short because a suggestion is a draft: a
 * paragraph takes time to read and leaves no room to edit, so that turn effectively becomes
 * model-written text.
 *
 * It differs from the conversation cap (`CHAT_MAX_MESSAGE_CHARS`) because they answer different
 * questions. That one asks whether a message can be sent; this one asks whether it reads as a
 * suggestion.
 */
export const CHAT_REPLY_SUGGESTION_MAX_LENGTH = 200;

/**
 * Length of the recent conversation read by suggestions. Much shorter than the conversation turn
 * window (`CHAT_HISTORY_LIMIT`, 40), because the questions differ: a turn must see the whole flow
 * to continue the story, while a suggestion only answers what to say to the last message. Twelve is
 * about six turns.
 *
 * A longer window costs three things: each call becomes as expensive as a roleplay turn, old topics
 * produce suggestions unrelated to the current scene, and the response slows, leaving the user
 * waiting in front of the input box.
 */
export const CHAT_REPLY_SUGGESTION_HISTORY_LIMIT = 12;

/**
 * Minimal shape of a message read by suggestions. Ids, timestamps, sync metadata and usage are not
 * read.
 */
export type ReplySuggestionMessage = Pick<
	ChatMessage,
	"role" | "speaker" | "content"
>;

/**
 * Minimal shape of a row read by the availability check. The two axes are optional on purpose: an
 * opening is not a stored record and has no such axes, and absence is the accurate representation.
 * No `false` is invented.
 */
export interface ReplySuggestionRow {
	role: ChatRole;
	/**
	 * Whether the response was cut by the output cap. Only stored assistant records carry this axis.
	 */
	truncated?: boolean;
	/**
	 * Whether a stored response was saved without seeing a normal stop. Together with `truncated`, it
	 * answers whether the tail is open.
	 */
	incomplete?: boolean;
}

export interface SelectReplySuggestionWindowInput {
	/**
	 * Stored messages of the room, ascending. May be longer than the window; trimming happens here in
	 * `selectReplySuggestionWindow`.
	 */
	messages: readonly ReplySuggestionMessage[];
	/**
	 * The room's opening. Used only when no messages are stored at all.
	 *
	 * It is not put in front of every request, for two reasons: openings are long (some works run to
	 * thousands of characters), so each call would stop being cheap; and after twelve turns, 'what do
	 * I say now' is not a question the opening answers. In a room where nothing has happened yet,
	 * though, the opening is everything: the scene in front of the user is that text.
	 *
	 * The assembler folds the opening into the system prompt for a different purpose, preserving style
	 * over hundreds of turns. Here the need is the immediate scene.
	 */
	opening: string | null;
}

/**
 * The conversation this suggestion reads: ascending order, possibly empty. Trimming happens in this
 * one function, and that is the rule. Availability and request assembly both pass through it, so
 * 'conversation that can show suggestions' and 'conversation actually read' cannot diverge.
 */
export function selectReplySuggestionWindow(
	input: SelectReplySuggestionWindowInput,
): ReplySuggestionMessage[] {
	if (input.messages.length)
		return input.messages.slice(-CHAT_REPLY_SUGGESTION_HISTORY_LIMIT);
	const opening = input.opening?.trim();
	return opening ? [{ role: "assistant", speaker: "", content: opening }] : [];
}

export interface CanSuggestReplyInput {
	generating: boolean;
	/**
	 * Whether the input box is empty. This axis makes the conflict unrepresentable. A draft could be
	 * erased (irreversible) or the suggestion spliced into the middle of it (meaning breaks). Neither
	 * is acceptable, so a third answer was chosen: if the user is already writing, no suggestion is
	 * needed. Filling therefore always goes into an empty box, and no conflict rule is needed.
	 */
	composerEmpty: boolean;
	/**
	 * Whether a failure notice is showing. The answer in that slot is `Regenerate`, not 'what
	 * to say'. Two suggestions in the same slot would blur which one answers the failure just shown.
	 * This is the same rule by which the continue-generation notice folds into the failure notice.
	 */
	failed: boolean;
	/**
	 * Rows as the screen draws them, including the opening, in exact display order. The last row
	 * decides the turn.
	 */
	rows: readonly ReplySuggestionRow[];
}

/**
 * Whether a suggestion may appear in this conversation now. True only when all five hold: not
 * generating; input empty; no failure notice; the last response's tail closed
 * (`assistantTailOpen`); and the last line is not the user's own turn awaiting an answer.
 *
 * The input must be empty because any other state would force erasing or splicing a draft. Sharing
 * the tail predicate with `Continue` means the two notices never compete for the same slot: reading
 * the tail as `truncated` alone would show both side by side above a cut-off response. The function
 * is pure and both apps call it, so a suggestion button cannot appear in one app only.
 */
export function canSuggestReply(input: CanSuggestReplyInput): boolean {
	if (input.generating || !input.composerEmpty || input.failed) return false;
	const last = input.rows[input.rows.length - 1];
	if (!last) return false;
	if (last.role !== "assistant") return false;
	return !assistantTailOpen(last);
}

/**
 * Identity of the turn the screen is showing. When it changes, held suggestions are discarded.
 *
 * Without it, the same three sentences survive after the conversation moves on: one is sent, a
 * response arrives, and when the input empties again, a suggestion from an earlier turn reappears.
 * It looks plausible and gives no error, so the user cannot tell it is stale.
 *
 * The key is the last row's id because both apps already have such ids (openings have stable ids
 * too) and the screen draws in the same array order. Apps must not each define their own key: a
 * count- or length-based key can stay the same across tail deletion, and the divergence would show
 * in one app only.
 *
 * Editing the last assistant response keeps its id, so this does not catch it. That limit is
 * accepted: the input must be empty, and the suggestions usually still fit.
 */
export const replySuggestionTurnKey = (
	rows: readonly { id: string }[],
): string | null => rows[rows.length - 1]?.id ?? null;
