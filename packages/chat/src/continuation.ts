import type { ChatSeedSceneImageDto } from "@rowcat/contracts/chat";
import type { ChatGenerationEnd, ChatGenerationUsage } from "./generation.ts";
import type { ChatMessage } from "./model.ts";
import { finalizeWithSceneImage } from "./scene-image.ts";

/**
 * Continue generation: appends an unfinished response onto the same message bubble.
 *
 * It appends instead of creating a new bubble because the stored body is the source of truth. Copy,
 * search, edit and report evidence all read the stored body, so a sentence split across two records
 * would be half-visible to each of them.
 *
 * Owns:
 * - Normalizing provider finish reasons into 'cut off by the output cap'.
 * - Deciding whether a continuation applies (`assistantTailOpen`, `continuationTarget`).
 * - Turning a continuation result into the next record (`extendAssistantRecord`). Both storage
 *   backends (web Dexie, mobile SQLite) call this same function inside their own transactions, so
 *   usage and scene-image rules cannot drift between apps.
 *
 * Does not own:
 * - The prompt. The request shape lives in the assembler (the `continuation` axis of
 *   `buildChatGenerationRequest`): the last assistant turn is sent as prefill with no nudge, and
 *   nothing else changes.
 * - Provider-specific handling. Adapters decide which models accept prefill and under what
 *   conditions (`apps/{web,mobile}/src/lib/generation/*`, `apps/api/src/services/generation/*`).
 *   This file holds only the two pieces they share: prefill normalization and the fallback nudge.
 * - Triggers. The button belongs to the screen, and `scroll-advance.ts` decides what a scroll
 *   gesture starts.
 *
 * Never automatic: each continuation is a full upstream request (the user's key under BYO, or the
 * operator's key and daily cap when managed). No path may send a paid request the user did not
 * start.
 */

/**
 * Whether a finish reason says the output cap was reached.
 *
 * Three providers put different strings in the same field (`done.finishReason`): OpenRouter sends
 * `length`, Anthropic sends `max_tokens`, and Gemini sends `MAX_TOKENS`. If the normalization were
 * spread across screens, adding a provider would leave one screen not knowing the new string.
 *
 * Unknown values fold to the not-truncated side. This check opens a paid action (continue
 * generation), and a wrong true costs more than a wrong false. Suggesting continuation after a
 * normal finish would make the user pay for a request they do not need.
 */
export function isTruncationFinishReason(reason: string | undefined): boolean {
	if (reason === undefined) return false;
	const folded = reason.toLowerCase();
	return (
		folded === "length" ||
		folded === "max_tokens" ||
		folded === "max_output_tokens"
	);
}

/**
 * The fields the target check actually reads. It does not require the whole message, so the work
 * test can use the same shape.
 */
type ContinuableMessage = Pick<
	ChatMessage,
	"id" | "role" | "truncated" | "incomplete"
>;

/**
 * Whether this response's tail is still open, meaning the text never fully arrived.
 *
 * Two fields answer the same question. The save rules keep them separate on purpose (`model.ts`),
 * because they record what happened. This predicate asks a different question: is there text left
 * to continue?
 *
 * - truncated: a normal finish was received, and its reason was the output cap.
 * - incomplete: no normal finish was seen (stopped, connection lost, or provider failure).
 *
 * An earlier version answered only with `truncated`, which made the conversation a dead end. A
 * response that stopped midway is saved with `incomplete` and no `truncated`, and no regenerate
 * appears because saved text counts as answered (`awaitsAnswer`). The user then had nothing to
 * press.
 *
 * A wrongly true value is cheap on this axis. Continuing is a paid action, but a person presses it,
 * and continuing cut-off text is what they wanted. A completed response carries neither field, so
 * this predicate never suggests continuing completed text.
 */
export function assistantTailOpen(
	message: Pick<ChatMessage, "truncated" | "incomplete">,
): boolean {
	return message.truncated === true || message.incomplete === true;
}

/**
 * Why the tail is open. This is the basis for the sentence the screen shows, not a condition for
 * any action.
 *
 * The reason travels with the flag so both apps say the same thing. If only an id came back, each
 * screen would reread the stored record and write its own explanation, in two places. Fixing one
 * app would then leave the same response reading as a 'length limit' on web and 'interrupted
 * midway' on mobile.
 *
 * The reason words match the record's two fields on purpose. A third vocabulary such as `length` or
 * `interrupted` would make readers memorize the fields and the reasons separately.
 */
export type ChatContinuationReason = "truncated" | "incomplete";

export interface ChatContinuationTarget {
	id: string;
	reason: ChatContinuationReason;
}

/**
 * The message this continuation applies to, or null if there is none.
 *
 * Only the last message is a target. A response left cut off is not a target once the conversation
 * has moved past it. Appending there would insert an edit between turns that were already
 * exchanged. That is history rewriting, not continuation, and it has its own entry point
 * (`rewriteHistory`).
 *
 * The check lives outside the screens because there are several consumers: the banners in both
 * apps, and `scrollAdvanceAction`, which both apps' scroll gestures pass through. If each screen
 * wrote its own check, one might forget the 'last message' rule and offer continuation on a cut-off
 * response in the middle of a conversation.
 *
 * The output cap takes precedence. If a continuation is itself cut off, one record can carry both
 * fields, and the user learns the response hit the cap, which is the more informative sentence.
 */
export function continuationTarget(
	messages: readonly ContinuableMessage[],
): ChatContinuationTarget | null {
	const last = messages[messages.length - 1];
	if (!last || last.role !== "assistant" || !assistantTailOpen(last))
		return null;
	return {
		id: last.id,
		reason: last.truncated === true ? "truncated" : "incomplete",
	};
}

/**
 * The value storage receives when a continuation stream ends. It holds only the raw text and the
 * end status.
 */
export interface AssistantContinuation {
	/**
	 * Text received in this continuation, exactly as streamed. It is appended to the stored body as
	 * is.
	 */
	text: string;
	end: ChatGenerationEnd;
	usage?: ChatGenerationUsage;
	/** Raw provider finish reason. Normalization is done in this module. */
	finishReason?: string;
	/**
	 * This conversation's scene image. Attaching happens only when the continuation finishes without
	 * being cut off. Attaching a marker to a truncated body would make the next continuation append
	 * after that marker, so the image would land mid-sentence.
	 */
	sceneImages?: readonly ChatSeedSceneImageDto[];
}

/** Combines the observations of two requests. Only axes that both requests reported are summed. */
function mergeUsageAxis(
	base: number | undefined,
	added: number | undefined,
): number | undefined {
	return base !== undefined && added !== undefined ? base + added : undefined;
}

/**
 * Turns a truncated assistant message and a continuation result into the next record.
 *
 * Returns null to change nothing. A continuation with no text did not happen, so the truncated flag
 * stays and the next attempt still holds.
 *
 * Storage calls this inside its own transaction. Sync metadata (`dirty`, `rev`) and the update time
 * are not set here. `markLocalUpdate` owns that, since it knows the issuance order.
 *
 * Rules:
 * - completed, with text: appended. `truncated` is set if the finish reason says the output was
 *   cut again. The scene image attaches only when the continuation is not cut, and only the first
 *   time it is.
 * - stopped or failed, with text: appended, with `incomplete`. The open tail stays marked by that
 *   flag.
 * - No text, any end: null. The record is untouched.
 *
 * The point is that continue comes back after a stopped or failed continuation. Otherwise only
 * `Regenerate` would remain, and that button erases text the user has already read. Using
 * `incomplete` rather than `truncated` for this is the recent change to this table.
 *
 * Usage is summed per axis. If either request did not report an axis, that axis is cleared. Unknown
 * and zero are different values. `model` keeps the first responder, since one value cannot hold two
 * models, and the first model generated most of the body.
 */
export function extendAssistantRecord(
	current: ChatMessage,
	continuation: AssistantContinuation,
): ChatMessage | null {
	// No path appends to a user message. If a caller gets this wrong, the function stops here.
	if (current.role !== "assistant") return null;
	if (!continuation.text.trim()) return null;

	const completed = continuation.end === "completed";
	/**
	 * A stopped or failed continuation does not claim `truncated`.
	 *
	 * This used to be set to true, on the reasoning that clearing it would lose the way back to
	 * continuing. That premise no longer holds. Both fields together answer whether the tail is open
	 * (`assistantTailOpen`), so `incomplete` alone lets the next attempt proceed.
	 *
	 * What remains is honesty. `truncated` records that the provider named the output cap as the
	 * reason. For a continuation cut off midway, that reason was never received. The value also syncs
	 * to other devices unchanged.
	 */
	const truncated =
		completed && isTruncationFinishReason(continuation.finishReason);

	const combined = current.content + continuation.text;
	const content =
		completed && !truncated
			? finalizeWithSceneImage(combined, continuation.sceneImages ?? [])
			: combined;

	const usage = continuation.usage;
	const model = current.model ?? usage?.model;
	const inputTokens = mergeUsageAxis(current.inputTokens, usage?.inputTokens);
	const cachedInputTokens = mergeUsageAxis(
		current.cachedInputTokens,
		usage?.cachedInputTokens,
	);
	const cacheWriteInputTokens = mergeUsageAxis(
		current.cacheWriteInputTokens,
		usage?.cacheWriteInputTokens,
	);
	const outputTokens = mergeUsageAxis(
		current.outputTokens,
		usage?.outputTokens,
	);

	return {
		id: current.id,
		roomId: current.roomId,
		role: current.role,
		speaker: current.speaker,
		content,
		createdAt: current.createdAt,
		updatedAt: current.updatedAt,
		deletedAt: current.deletedAt,
		dirty: current.dirty,
		serverVersion: current.serverVersion,
		rev: current.rev,
		...(model !== undefined ? { model } : {}),
		...(inputTokens !== undefined ? { inputTokens } : {}),
		...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
		...(cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens } : {}),
		...(outputTokens !== undefined ? { outputTokens } : {}),
		/**
		 * If the end was not normal, mark the record `incomplete`. This matches the save rule for the
		 * base message (`resolveGenerationOutcome`). A completed end leaves the key out entirely, since
		 * the message was already complete before this continuation.
		 */
		...(completed ? {} : { incomplete: true }),
		...(truncated ? { truncated: true } : {}),
	};
}

/**
 * Trims trailing whitespace from the assistant content used as prefill.
 *
 * Anthropic rejects that value with a 400 ('final assistant content cannot end with trailing
 * whitespace'). The user would then see `Continue` fail every time. A truncated response
 * is cut mid-sentence, so a trailing space is common.
 *
 * The stored body is never changed. Only the copy sent in this request is trimmed. When the result
 * is appended, the new text goes after the original stored body (`extendAssistantRecord`), so
 * nothing trimmed for the request disappears from the result.
 *
 * Leading whitespace is left alone. It may be paragraph indentation, and providers reject only
 * trailing whitespace. Unneeded normalization is exactly where the stored text and the text
 * actually sent would diverge.
 */
export const trimContinuationPrefill = (content: string): string =>
	content.replace(/\s+$/u, "");

/**
 * The user turn used in place of prefill for models that do not accept prefill.
 *
 * It says what prefill would say: do not start a new turn, and continue from the exact point where
 * the text was cut. It is less precise than prefill, because the model may rewrite the last
 * sentence. Adapters therefore use prefill whenever it is available.
 *
 * This was once described as a last resort. That assumption was wrong. A live request on 2026-09-23
 * showed that Claude models from 4.6 onward reject prefill with a 400, so their continuations now
 * take this path. Which model takes which shape is in the adapter tables
 * (`apps/{web,mobile}/src/lib/generation/anthropic.ts`,
 * `apps/api/src/services/generation/managed-models.ts`). The `FALLBACK` in the name means 'used
 * when prefill is absent'.
 *
 * The wording is not shortened. A version that kept only the final sentence made Fable 5 rewrite
 * the cut sentence from its start on the same day. Continued text is appended after the stored
 * body, so that repeat shows up as the same sentence twice in one bubble. The 'do not repeat'
 * clause prevents it. When changing the wording, recheck with a live request on a nudge-path model.
 * In a short synthetic conversation, two Fable runs refused the request (`refusal`) depending on
 * wording.
 *
 * The text lives here because it is prompt content. If each adapter kept its own copy, the same
 * continuation would get different instructions per provider, and that would show up only as
 * 'continuation repeats earlier text on some models', with no way to trace the cause.
 */
export const CONTINUATION_FALLBACK_NUDGE =
	"[system] 직전 응답이 출력 한도로 중간에 끊겼습니다. 새 장면이나 새 턴을 시작하지 말고, 앞선 응답을 한 글자도 반복하지 말고, 끊긴 바로 그 지점부터 이어서 계속 써 주세요.";
