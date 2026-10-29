import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import { buildChatGenerationRequest } from "./context.ts";
import {
	assistantTailOpen,
	CONTINUATION_FALLBACK_NUDGE,
	continuationTarget,
	extendAssistantRecord,
	isTruncationFinishReason,
	trimContinuationPrefill,
} from "./continuation.ts";
import { resolveGenerationOutcome } from "./generation.ts";
import type { ChatMessage } from "./model.ts";
import { createRoomRecord } from "./model.ts";

/**
 * Tests for continue-generation, covering pure rules only (no React, no storage). Three things are
 * locked here:
 * - Normalization of provider finish-reason vocabulary. A wrong value puts the paid action in the
 *   wrong place.
 * - The merge table for appending a continuation. A wrong value leaves a different body on each
 *   device.
 * - The prefill shape built by the assembler. A wrong value makes the model start a new turn
 *   instead of continuing.
 */

const assistantMessage = (
	overrides: Partial<ChatMessage> = {},
): ChatMessage => ({
	id: "m1",
	roomId: "r1",
	role: "assistant",
	speaker: "",
	content: "그는 문을 열고",
	createdAt: "2026-08-28T00:00:00.000Z",
	updatedAt: "2026-08-28T00:00:00.000Z",
	deletedAt: null,
	dirty: 0,
	serverVersion: 3,
	rev: { t: 1, c: 0, d: "device" },
	truncated: true,
	...overrides,
});

describe("isTruncationFinishReason", () => {
	it("folds all three paths' vocabulary into truncated", () => {
		// OpenRouter, Anthropic and Gemini each send a different raw value in the same field.
		expect(isTruncationFinishReason("length")).toBe(true);
		expect(isTruncationFinishReason("max_tokens")).toBe(true);
		expect(isTruncationFinishReason("MAX_TOKENS")).toBe(true);
	});

	it("normal ends and unknown values fold to not truncated", () => {
		expect(isTruncationFinishReason("stop")).toBe(false);
		expect(isTruncationFinishReason("end_turn")).toBe(false);
		expect(isTruncationFinishReason("STOP")).toBe(false);
		expect(isTruncationFinishReason(undefined)).toBe(false);
		// An unknown value must not open the paid action. A wrong true costs more than a wrong false.
		expect(isTruncationFinishReason("content_filter")).toBe(false);
	});
});

describe("resolveGenerationOutcome: truncated completion", () => {
	it("done + cap reason → the truncated mark remains and it is not incomplete", () => {
		const outcome = resolveGenerationOutcome({
			text: "그는 문을 열고",
			end: "completed",
			finishReason: "length",
		});
		expect(outcome.message?.truncated).toBe(true);
		expect(outcome.message?.incomplete).toBeUndefined();
	});

	it("truncated completions get no scene image: it is mid-sentence", () => {
		const sceneImages = [{ trigger: "문", assetId: "a1" }];
		const truncated = resolveGenerationOutcome({
			text: "그는 문을 열고",
			end: "completed",
			finishReason: "max_tokens",
			sceneImages,
		});
		expect(truncated.message?.content).toBe("그는 문을 열고");

		// A complete body still runs scene-image attachment. Truncation is the only exception.
		const complete = resolveGenerationOutcome({
			text: "그는 문을 열고",
			end: "completed",
			finishReason: "stop",
			sceneImages,
		});
		expect(complete.message?.content).toContain("[img:문]");
	});

	it("without finishReason the result is as before this axis existed", () => {
		const outcome = resolveGenerationOutcome({
			text: "안녕하세요.",
			end: "completed",
		});
		expect(outcome.message).not.toHaveProperty("truncated");
	});
});

describe("assistantTailOpen", () => {
	it("both axes give the same answer: cap or cut stream, the tail is open", () => {
		expect(assistantTailOpen({ truncated: true })).toBe(true);
		expect(assistantTailOpen({ incomplete: true })).toBe(true);
	});

	it("a normal completion has neither axis", () => {
		expect(assistantTailOpen({})).toBe(false);
	});
});

describe("continuationTarget", () => {
	it("holds when the last message is a truncated assistant", () => {
		expect(
			continuationTarget([
				{ id: "u1", role: "user" },
				{ id: "m1", role: "assistant", truncated: true },
			]),
		).toEqual({ id: "m1", reason: "truncated" });
	});

	/**
	 * This is the fixed state from this change. For a while this position was `null`, and no `Regenerate`
	 * (regenerate) appeared over that response either. A turn whose partial response was saved counts
	 * as answered, so a conversation whose output stopped midway offered the user nothing to press.
	 */
	it("holds for a response saved without seeing a normal end", () => {
		expect(
			continuationTarget([{ id: "m1", role: "assistant", incomplete: true }]),
		).toEqual({ id: "m1", reason: "incomplete" });
	});

	it("when both axes hold, the output cap comes first: that sentence explains more", () => {
		expect(
			continuationTarget([
				{ id: "m1", role: "assistant", truncated: true, incomplete: true },
			]),
		).toEqual({ id: "m1", reason: "truncated" });
	});

	it("does not hold when the conversation continued after: that is history rewriting", () => {
		expect(
			continuationTarget([
				{ id: "m1", role: "assistant", truncated: true },
				{ id: "u2", role: "user" },
			]),
		).toBeNull();
	});

	it("does not stand on complete responses, user turns or empty lists", () => {
		expect(continuationTarget([{ id: "m1", role: "assistant" }])).toBeNull();
		expect(
			continuationTarget([{ id: "u1", role: "user", truncated: true }]),
		).toBeNull();
		expect(continuationTarget([])).toBeNull();
	});
});

describe("extendAssistantRecord", () => {
	it("completing continuation: the body continues and truncated disappears", () => {
		const next = extendAssistantRecord(assistantMessage(), {
			text: " 밖으로 나갔다.",
			end: "completed",
			finishReason: "stop",
		});
		expect(next?.content).toBe("그는 문을 열고 밖으로 나갔다.");
		expect(next).not.toHaveProperty("truncated");
		expect(next).not.toHaveProperty("incomplete");
		// Identity, timestamps and sync metadata stay as they are. Issuing revisions is the storage
		// layer's job.
		expect(next?.id).toBe("m1");
		expect(next?.createdAt).toBe("2026-08-28T00:00:00.000Z");
		expect(next?.serverVersion).toBe(3);
	});

	it("truncated again: truncated remains so the next attempt holds", () => {
		const next = extendAssistantRecord(assistantMessage(), {
			text: " 밖으로",
			end: "completed",
			finishReason: "length",
		});
		expect(next?.truncated).toBe(true);
		expect(next).not.toHaveProperty("incomplete");
	});

	/**
	 * The change in this slice is that `truncated` no longer stays set. That value records the
	 * provider naming the output cap as the reason. The provider never said that here, so the code
	 * never received that reason. An open tail is conveyed by `incomplete`, and the next attempt works
	 * from that alone.
	 */
	it("interrupted continuation: stays incomplete with the tail open", () => {
		const next = extendAssistantRecord(assistantMessage(), {
			text: " 밖으로",
			end: "stopped",
		});
		expect(next?.incomplete).toBe(true);
		expect(next).not.toHaveProperty("truncated");
		expect(
			continuationTarget([
				{ id: next?.id ?? "", role: "assistant", incomplete: next?.incomplete },
			]),
		).toEqual({ id: "m1", reason: "incomplete" });
	});

	it("an empty continuation changes nothing", () => {
		expect(
			extendAssistantRecord(assistantMessage(), {
				text: "   ",
				end: "completed",
				finishReason: "stop",
			}),
		).toBeNull();
	});

	it("does not append to user messages: stops here even if the caller is wrong", () => {
		expect(
			extendAssistantRecord(assistantMessage({ role: "user" }), {
				text: "이어쓰기",
				end: "completed",
			}),
		).toBeNull();
	});

	it("the scene image attaches only at an untruncated end", () => {
		const sceneImages = [{ trigger: "문", assetId: "a1" }];
		const still = extendAssistantRecord(assistantMessage(), {
			text: " 밖으로",
			end: "completed",
			finishReason: "length",
			sceneImages,
		});
		expect(still?.content).not.toContain("[img:");

		const done = extendAssistantRecord(assistantMessage(), {
			text: " 밖으로 나갔다.",
			end: "completed",
			finishReason: "stop",
			sceneImages,
		});
		expect(done?.content).toContain("[img:문]");
	});

	it("usage sums per axis, and an axis unknown on either side loses its key", () => {
		const next = extendAssistantRecord(
			assistantMessage({
				model: "claude-sonnet-5",
				inputTokens: 100,
				outputTokens: 2048,
				cachedInputTokens: 40,
			}),
			{
				text: " 밖으로 나갔다.",
				end: "completed",
				finishReason: "stop",
				usage: { model: "deepseek-v4-pro", inputTokens: 150, outputTokens: 30 },
			},
		);
		expect(next?.inputTokens).toBe(250);
		expect(next?.outputTokens).toBe(2078);
		// The continuation did not report the cache axis, so no half-value that looks like a total is
		// kept.
		expect(next).not.toHaveProperty("cachedInputTokens");
		expect(next?.model).toBe("claude-sonnet-5");
	});
});

describe("buildChatGenerationRequest — continuation", () => {
	const room = createRoomRecord(
		{
			originStoryId: "story-1",
			seed: StoryChatSeedDto.parse({
				version: 1,
				storyId: "story-1",
				title: "테스트 작품",
				adult: false,
				promptProtected: false,
				scenario: "비 내리는 항구 도시.",
				firstScene: "",
			}),
		},
		{
			id: "room-1",
			routingSessionId: "0f1e2d3c-4b5a",
			now: "2026-01-01T00:00:00.000Z",
			rev: { t: 1, c: 0, d: "test-device" },
		},
	);

	const messages = [
		{ role: "user" as const, speaker: "유저", content: "문을 연다" },
		{ role: "assistant" as const, speaker: "", content: "그는 문을 열고" },
	];

	it("continue ends with an assistant prefill: no nudge attached", () => {
		const request = buildChatGenerationRequest({
			room,
			messages,
			allAges: true,
			continuation: true,
		});
		const last = request.messages[request.messages.length - 1];
		expect(last?.role).toBe("assistant");
		expect(last?.content).toBe("그는 문을 열고");
	});

	it("without continuation the nudge attaches as before", () => {
		const request = buildChatGenerationRequest({
			room,
			messages,
			allAges: true,
		});
		const last = request.messages[request.messages.length - 1];
		expect(last?.role).toBe("user");
	});

	it("continuation does nothing when the last turn is the user's", () => {
		const request = buildChatGenerationRequest({
			room,
			messages: [messages[0] as (typeof messages)[number]],
			allAges: true,
			continuation: true,
		});
		const last = request.messages[request.messages.length - 1];
		expect(last?.role).toBe("user");
	});
});

describe("prefill normalization", () => {
	/**
	 * Anthropic rejects a final assistant message that ends in trailing whitespace (HTTP 400). A
	 * truncated response is cut mid-sentence, so a trailing space is common. In that case `Continue`
	 * (continue) always fails in that conversation.
	 */
	it("trims only trailing whitespace", () => {
		expect(trimContinuationPrefill("그는 문을 열고  ")).toBe("그는 문을 열고");
		expect(trimContinuationPrefill("그는 문을 열고\n\n")).toBe(
			"그는 문을 열고",
		);
	});

	/**
	 * Leading whitespace may be paragraph indentation, and the provider rejects only trailing
	 * whitespace.
	 */
	it("leaves leading whitespace alone", () => {
		expect(trimContinuationPrefill("  그는 문을 열고")).toBe(
			"  그는 문을 열고",
		);
	});

	it("returns the original when nothing applies", () => {
		expect(trimContinuationPrefill("그는")).toBe("그는");
		expect(trimContinuationPrefill("")).toBe("");
	});

	/**
	 * The nudge is a different sentence from `CONTINUE_NUDGE`. That one says to develop the next turn.
	 * This one says to finish the cut-off sentence. Folding them together would make a continuation
	 * start a new turn.
	 */
	it("the fallback nudge says to keep writing", () => {
		expect(CONTINUATION_FALLBACK_NUDGE).toContain("끊긴 바로 그 지점부터");
		expect(CONTINUATION_FALLBACK_NUDGE).toContain(
			"새 장면이나 새 턴을 시작하지",
		);
	});
});

/**
 * This is the last link of the continuation chain for conversations with a narration pack. When a
 * continuation is appended to a truncated response, the stored body stays intact, and the
 * continuation does not create another tracking block on its own.
 */
describe("continuing a response with tracking blocks", () => {
	const LOGIC = "<details><summary>Logic</summary>\n[Turn] 3\n</details>";

	/**
	 * Appending is a pure concatenation. It neither redraws nor removes blocks in the stored body.
	 * Without this rule, the text after a continuation would become a value we generated.
	 */
	it("does not rewrite the stored body: appending is pure concatenation", () => {
		const current = assistantMessage({ content: "문이 열리고 그는" });
		const next = extendAssistantRecord(current, {
			text: ` 웃었다.\n\n${LOGIC}`,
			end: "completed",
			finishReason: "end_turn",
		});
		expect(next?.content).toBe(`문이 열리고 그는 웃었다.\n\n${LOGIC}`);
		expect(next?.content.split("<summary>Logic</summary>")).toHaveLength(2);
	});

	/**
	 * When the truncated half already has a tracking block and the continuation draws another, neither
	 * one is edited. The code cannot know which is newer (see `tracking-block.ts`). The duplicate is
	 * prevented by the output convention, not by appending: the block goes at the very end of the
	 * response, so a truncated half never contains one (see `narration-output.ts`).
	 */
	it("we do not edit a result that came with two blocks", () => {
		const current = assistantMessage({ content: `${LOGIC}\n\n문이 열리고` });
		const next = extendAssistantRecord(current, {
			text: ` 그는 웃었다.\n\n${LOGIC}`,
			end: "completed",
			finishReason: "end_turn",
		});
		expect(next?.content).toBe(
			`${LOGIC}\n\n문이 열리고 그는 웃었다.\n\n${LOGIC}`,
		);
	});

	/**
	 * The continuation was truncated again. The flag stays, so the next attempt is still valid. If the
	 * chain stalls on its second round, the user is left with only `Regenerate`, and that
	 * button erases text they have already read.
	 */
	it("continue stands again if truncated again", () => {
		const current = assistantMessage({ content: "문이 열리고" });
		const next = extendAssistantRecord(current, {
			text: " 그는",
			end: "completed",
			finishReason: "length",
		});
		expect(next?.truncated).toBe(true);
		expect(
			continuationTarget([
				{ id: next?.id ?? "", role: "assistant", truncated: next?.truncated },
			]),
		).toEqual({ id: next?.id, reason: "truncated" });
	});

	/**
	 * A first response that contains only a tracking block and no body is not saved (see
	 * `resolveGenerationOutcome`). Such a response has no target to continue, so the user is prompted
	 * to regenerate instead. This keeps `Continue` from appearing on an empty bubble.
	 */
	it("a tracking-block-only response has nothing to continue", () => {
		const outcome = resolveGenerationOutcome({
			text: LOGIC,
			end: "completed",
			finishReason: "length",
		});
		expect(outcome.message).toBeNull();
		expect(outcome.unanswered).toBe(true);
	});
});
