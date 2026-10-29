import type { ChatSeedSceneImageDto } from "@rowcat/contracts/chat";
import { isTruncationFinishReason } from "./continuation.ts";
import type { AppendMessageInput } from "./model.ts";
import { finalizeWithSceneImage } from "./scene-image.ts";
import { splitChatTrackingBlocks } from "./tracking-block.ts";

/**
 * Turn state transitions for generation: pure save rules only.
 *
 * The rules live outside the React handlers because they are product decisions and need to be
 * checkable as a table:
 *
 * - completed, body: saved as complete; answered
 * - completed, no body: not saved; unanswered (retry)
 * - stopped or failed, body: saved as incomplete; answered
 * - stopped or failed, no body: not saved; unanswered (retry)
 *
 * The user message is never removed, even when generation fails.
 *
 * The verdict uses the response body, not the raw text. With a narrative pack, most of a response
 * may be tracking block, which the screen draws as a folded panel (tracking-block.ts). Judging by
 * raw length would save responses that have no body. The verdict is made on the text minus tracking
 * blocks, but the saved value is the original text.
 */

export type ChatGenerationEnd =
	/** The server sent `done`. */
	| "completed"
	/** The user stopped (AbortController). */
	| "stopped"
	/** A network, provider, or protocol error broke the stream. */
	| "failed";

/**
 * Usage reported by the provider. Every field is optional because some providers report none. Names
 * come from the contract (ChatStreamEvent in @rowcat/contracts) and are passed through unchanged:
 *
 * - inputTokens: total input for this request, including cache reads.
 * - cachedInputTokens: the part of input read from the provider cache.
 * - cacheWriteInputTokens: tokens written to the cache by this request. This is a separate axis
 *   and is not subtracted from inputTokens.
 *
 * Raw provider fields do not map one-to-one onto these. Adapters normalize them (web
 * lib/generation/*, server services/generation/chat.ts); this package sees only normalized values.
 */
export interface ChatGenerationUsage {
	model?: string;
	inputTokens?: number;
	cachedInputTokens?: number;
	cacheWriteInputTokens?: number;
	outputTokens?: number;
}

/**
 * The assistant message the save decision produces. Where it attaches is not decided here, so the
 * type is AppendMessageInput without roomId. This rule never reads roomId, and requiring it would
 * force conversations that are never persisted (the work test) to invent a room id. The saving side
 * attaches it: local rooms know their own id, and replay sessions have no room to attach to.
 */
export type GeneratedAssistantMessage = Omit<AppendMessageInput, "roomId">;

export interface GenerationOutcomeInput {
	/**
	 * Assistant text accumulated from the stream. If the stream was cut, pass what was received as-is.
	 */
	text: string;
	end: ChatGenerationEnd;
	usage?: ChatGenerationUsage;
	/**
	 * The provider's raw finish reason from the `done` event, unnormalized. continuation.ts normalizes
	 * it. This is the only basis for telling a completion cut at the output limit (truncated) from a
	 * normal one. If it is not passed, the result is byte-for-byte the same as before this field
	 * existed, because no caller can claim truncation without it.
	 */
	finishReason?: string;
	/**
	 * The room's scene images. If there are none, this step does nothing.
	 *
	 * The image is attached at finalize time, for three reasons. Attaching while streaming would make
	 * tokens appear and then vanish on screen. Attaching after save would make the saved text differ
	 * from the rendered text, while copy, search, and edit all read the saved text. Attaching on
	 * screen would make web and mobile react differently to the same response.
	 *
	 * It is also attached to responses that were stopped or failed: whatever was received is the
	 * user's conversation, and any scene in it is part of the picture.
	 */
	sceneImages?: readonly ChatSeedSceneImageDto[];
}

export interface GenerationOutcome {
	/**
	 * Assistant message to save. null saves nothing. An empty message would leave an empty bubble in
	 * the conversation, and the next turn's context would carry an empty assistant turn.
	 */
	message: GeneratedAssistantMessage | null;
	/**
	 * Whether the last user turn was left unanswered. This is what makes the screen offer `Regenerate`. A
	 * saved partial response sets this to false: the turn got some answer, and continuing differs from
	 * regenerating. Offering a retry there would imply that text the user just read could disappear.
	 */
	unanswered: boolean;
}

/**
 * Maps a stream result to a save decision.
 *
 * The verdict uses trimmed text, but the saved value is the original. Whitespace-only output counts
 * as no response. Leading and trailing whitespace and indentation may be the author's style, so
 * they are left alone.
 */
/**
 * The body used for the verdict: the text with tracking blocks removed, both closed ones and an
 * unfinished one at the tail.
 *
 * `streaming: true` is the point. A response cut at the output limit inside a block has no closing
 * tag, so a plain split would miss it, and the fragment of the tag would count as evidence of a
 * body. The streaming rule already hides unfinished blocks while streaming (tracking-block.ts), and
 * the question asked here ('is there prose left for the reader?') matches it exactly.
 *
 * For conversations without a pack, which is most of them, this does one closing-tag check and one
 * regex.
 */
const chatResponseBody = (text: string): string =>
	splitChatTrackingBlocks(text, { streaming: true }).body.trim();

export function resolveGenerationOutcome(
	input: GenerationOutcomeInput,
): GenerationOutcome {
	if (!chatResponseBody(input.text)) return { message: null, unanswered: true };

	/**
	 * Cut at the output limit: `done` arrived, but the provider gave the limit as the reason. This
	 * flag is the basis for continuation (continuation.ts).
	 */
	const truncated =
		input.end === "completed" && isTruncationFinishReason(input.finishReason);

	/**
	 * Scene-image attachment happens once, right before save (`finalizeWithSceneImage` in
	 * @rowcat/chat). If there is nothing to attach, the string comes back unchanged, so for
	 * a work without scene images this line changes no characters.
	 *
	 * Not attached to cut-off completions. The end of such a body is mid-sentence, and continuation
	 * appends text after it, so a token there would sit inside the next continuation's sentence.
	 * Attachment belongs to the point where continuation finishes without a cut
	 * (`extendAssistantRecord`).
	 */
	const content = truncated
		? input.text
		: finalizeWithSceneImage(input.text, input.sceneImages ?? []);

	return {
		message: {
			role: "assistant",
			content,
			...(input.usage?.model !== undefined ? { model: input.usage.model } : {}),
			...(input.usage?.inputTokens !== undefined
				? { inputTokens: input.usage.inputTokens }
				: {}),
			...(input.usage?.cachedInputTokens !== undefined
				? { cachedInputTokens: input.usage.cachedInputTokens }
				: {}),
			...(input.usage?.cacheWriteInputTokens !== undefined
				? { cacheWriteInputTokens: input.usage.cacheWriteInputTokens }
				: {}),
			...(input.usage?.outputTokens !== undefined
				? { outputTokens: input.usage.outputTokens }
				: {}),
			// Anything other than a normal completion gets an `incomplete` mark. The content itself is kept
			// as-is.
			...(input.end === "completed" ? {} : { incomplete: true }),
			...(truncated ? { truncated: true } : {}),
		},
		unanswered: false,
	};
}

export interface StartGenerationCheck {
	/**
	 * The user's input as typed. Empty for a turn started without input, such as `Regenerate`.
	 */
	text: string;
	generating: boolean;
	/** Local storage is open and the room has loaded. */
	ready: boolean;
	/** Whether the turn starts without input, as with `Regenerate`. */
	allowEmpty?: boolean;
}

/**
 * Whether generation may start now.
 *
 * The check lives outside the screen because of duplicate sends. The button's `disabled` state
 * alone does not block several paths: repeated Enter, confirming during IME composition, and
 * retries triggered from outside. Repeating the conditions in each path would drop one of them.
 * Starting twice saves two responses for one turn, and the room's conversation then stays
 * misaligned.
 */
export function canStartGeneration(check: StartGenerationCheck): boolean {
	if (!check.ready || check.generating) return false;
	return check.allowEmpty ? true : check.text.trim().length > 0;
}
