import { describe, expect, it } from "vitest";
import { canStartGeneration, resolveGenerationOutcome } from "./generation.ts";

/**
 * Generation transition tests: they check the save-rule table directly.
 *
 * React is not mounted. Testing the rule inside components would need a simulated stream and a
 * render, and such a test pins the implementation rather than the rule. It breaks when markup
 * changes and can still pass when the rule itself changes.
 */

/** The room id is not an input to this rule. Attaching it is the saving side's job. */
const base = {};

describe("resolveGenerationOutcome", () => {
	it("normal end: saves the response as complete", () => {
		const outcome = resolveGenerationOutcome({
			...base,
			text: "안녕하세요.",
			end: "completed",
		});
		expect(outcome.message).toMatchObject({
			role: "assistant",
			content: "안녕하세요.",
		});
		/**
		 * The room identity is not part of this result. The side that knows where to attach the message
		 * adds it.
		 */
		expect(outcome.message).not.toHaveProperty("roomId");
		expect(outcome.message?.incomplete).toBeUndefined();
		expect(outcome.unanswered).toBe(false);
	});

	/**
	 * A response that starts with an author-requested, closed status panel (`<details>`) is a response
	 * with a body. If the verdict read from the first `<details` to the end as tail, the whole
	 * response would be discarded.
	 */
	it("saves responses starting with a closed <details> too", () => {
		const text =
			"<details><summary>상태창</summary>HP 10</details>\n\n세라가 고개를 든다.";
		const outcome = resolveGenerationOutcome({ text, end: "completed" });
		expect(outcome.message?.content).toBe(text);
		expect(outcome.unanswered).toBe(false);
	});

	it("stop: keeps the partial response already received", () => {
		/**
		 * The user has already read those characters. Discarding them would make the text vanish from the
		 * screen, and the generation cost is already paid.
		 */
		const outcome = resolveGenerationOutcome({
			...base,
			text: "안녕하세요, 저는",
			end: "stopped",
		});
		expect(outcome.message?.content).toBe("안녕하세요, 저는");
		expect(outcome.message?.incomplete).toBe(true);
		expect(outcome.unanswered).toBe(false);
	});

	it("partial failure: saves what arrived even when cut off", () => {
		const outcome = resolveGenerationOutcome({
			...base,
			text: "말을 하다 말",
			end: "failed",
		});
		expect(outcome.message?.content).toBe("말을 하다 말");
		expect(outcome.message?.incomplete).toBe(true);
	});

	it("failure with not one character received: makes no empty message", () => {
		/**
		 * An empty assistant bubble left in the conversation would also appear as an empty assistant turn
		 * in the next turn's context. The user message stays, and the turn is marked unanswered so a
		 * retry can be offered.
		 */
		const outcome = resolveGenerationOutcome({
			...base,
			text: "",
			end: "failed",
		});
		expect(outcome.message).toBeNull();
		expect(outcome.unanswered).toBe(true);
	});

	it("a whitespace-only response counts as none too", () => {
		expect(
			resolveGenerationOutcome({ ...base, text: "\n  \t", end: "completed" })
				.message,
		).toBeNull();
	});

	it("stopping with nothing received makes no empty message", () => {
		const outcome = resolveGenerationOutcome({
			...base,
			text: "",
			end: "stopped",
		});
		expect(outcome.message).toBeNull();
		expect(outcome.unanswered).toBe(true);
	});

	it("usage carries only the reported items", () => {
		/**
		 * Missing values are not filled with 0. In managed billing, '0 tokens' and 'unknown' mean
		 * different things, and folding unknown into 0 makes the difference unrecoverable.
		 */
		const outcome = resolveGenerationOutcome({
			...base,
			text: "응답",
			end: "completed",
			usage: { model: "test/model", outputTokens: 12 },
		});
		expect(outcome.message).toMatchObject({
			model: "test/model",
			outputTokens: 12,
		});
		expect(outcome.message).not.toHaveProperty("inputTokens");
	});

	it("cache axes flow into the save input as is", () => {
		/**
		 * This assertion is the whole check that normalized stream values survive until the save. If they
		 * are lost here, cache accounting never recovers, because that conversation has already moved on.
		 */
		const outcome = resolveGenerationOutcome({
			...base,
			text: "응답",
			end: "completed",
			usage: {
				model: "test/model",
				inputTokens: 9_000,
				cachedInputTokens: 7_000,
				cacheWriteInputTokens: 0,
				outputTokens: 500,
			},
		});
		expect(outcome.message).toMatchObject({
			model: "test/model",
			inputTokens: 9_000,
			cachedInputTokens: 7_000,
			cacheWriteInputTokens: 0,
			outputTokens: 500,
		});
	});

	it("does not invent 0 when the provider says nothing about the cache", () => {
		/**
		 * cacheWriteInputTokens: 0 claims 'written, and it was zero'. An absent key means 'unknown'.
		 * Mixing them would make managed billing read a provider without caching as a cache miss.
		 */
		const outcome = resolveGenerationOutcome({
			...base,
			text: "응답",
			end: "completed",
			usage: { model: "test/model", outputTokens: 12 },
		});
		expect(outcome.message).not.toHaveProperty("cachedInputTokens");
		expect(outcome.message).not.toHaveProperty("cacheWriteInputTokens");
	});
});

describe("canStartGeneration", () => {
	const ready = { text: "안녕", generating: false, ready: true };

	it("starts for valid input", () => {
		expect(canStartGeneration(ready)).toBe(true);
	});

	it("a second does not start while already generating", () => {
		// Two responses saved for one turn would leave the room's conversation out of step from then on,
		// so a running generation must block a second start.
		expect(canStartGeneration({ ...ready, generating: true })).toBe(false);
	});

	it("does not start when the store is not ready", () => {
		expect(canStartGeneration({ ...ready, ready: false })).toBe(false);
	});

	it("does not start for whitespace-only input", () => {
		expect(canStartGeneration({ ...ready, text: "   " })).toBe(false);
	});

	it("regenerate starts without input", () => {
		expect(canStartGeneration({ ...ready, text: "", allowEmpty: true })).toBe(
			true,
		);
	});

	it("regenerate is blocked too while already generating", () => {
		expect(
			canStartGeneration({
				...ready,
				text: "",
				allowEmpty: true,
				generating: true,
			}),
		).toBe(false);
	});
});

describe("attaching scene images", () => {
	const images = [{ trigger: "night", assetId: "media-1" }];

	it("the token attaches right before the final save when a trigger matches", () => {
		const outcome = resolveGenerationOutcome({
			text: "night이 내린다.",
			end: "completed",
			sceneImages: images,
		});
		expect(outcome.message?.content).toBe("night이 내린다.\n\n[img:night]");
	});

	it("not one character changes without scene images passed", () => {
		const outcome = resolveGenerationOutcome({
			text: "night이 내린다.",
			end: "completed",
		});
		expect(outcome.message?.content).toBe("night이 내린다.");
	});

	it("attaches to stopped responses too: what arrived is still that person's conversation", () => {
		const outcome = resolveGenerationOutcome({
			text: "night이 내린",
			end: "stopped",
			sceneImages: images,
		});
		expect(outcome.message?.content).toBe("night이 내린\n\n[img:night]");
		expect(outcome.message?.incomplete).toBe(true);
	});

	it("empty responses are still not saved: an image does not make an empty bubble", () => {
		const outcome = resolveGenerationOutcome({
			text: "   ",
			end: "completed",
			sceneImages: images,
		});
		expect(outcome.message).toBeNull();
		expect(outcome.unanswered).toBe(true);
	});

	it("leaves a token the model already wrote as is", () => {
		const written = "문이 열린다.\n\n[img:night]";
		const outcome = resolveGenerationOutcome({
			text: written,
			end: "completed",
			sceneImages: images,
		});
		expect(outcome.message?.content).toBe(written);
	});
});

/**
 * Pins the failure chain for a conversation that uses a narrative pack, as a value:
 *
 * 1. The model draws a large tracking block first.
 * 2. That block uses a large share of the output limit.
 * 3. The response is cut off before the body.
 * 4. The screen keeps an empty bubble, and the turn is marked answered.
 *
 * The last step is what this slice fixes. Judging by raw length would count step 4 as a normal
 * save, so `Regenerate` is never offered.
 */
describe("responses with only tracking blocks and no body", () => {
	const LOGIC = "<details><summary>Logic</summary>\n[Turn] 3\n</details>";

	it("tracking blocks alone are not saved; the turn stays unanswered", () => {
		expect(resolveGenerationOutcome({ text: LOGIC, end: "completed" })).toEqual(
			{ message: null, unanswered: true },
		);
	});

	/**
	 * The response was cut at the limit in the middle of a tracking block, with no closing tag. It
	 * still has no body.
	 */
	it("the same with only an unclosed tracking block", () => {
		expect(
			resolveGenerationOutcome({
				text: "<details><summary>Logic</summary>\n[Turn] 3\n[Emo] 카이",
				end: "completed",
				finishReason: "length",
			}),
		).toEqual({ message: null, unanswered: true });
	});

	/**
	 * A response with at least one character of body is saved, and the saved value is the original
	 * text unchanged. The body is used only for the verdict, never to rewrite the text, so copy,
	 * search, edit, and abuse reports all see the same text.
	 */
	it("with a body, saves the original as is even with blocks attached", () => {
		const text = `문이 열렸다.\n\n${LOGIC}`;
		const outcome = resolveGenerationOutcome({ text, end: "completed" });
		expect(outcome.unanswered).toBe(false);
		expect(outcome.message?.content).toBe(text);
	});

	/** A block placed before the body gives the same answer. Order is not a factor here. */
	it("saves when a body exists even with blocks in front", () => {
		const text = `${LOGIC}\n\n문이 열렸다.`;
		expect(
			resolveGenerationOutcome({ text, end: "completed" }).message?.content,
		).toBe(text);
	});

	/** Verdicts for conversations that do not use a pack are unchanged, character for character. */
	it("the decision for responses without blocks is unchanged", () => {
		expect(
			resolveGenerationOutcome({ text: "안녕", end: "completed" }).message
				?.content,
		).toBe("안녕");
		expect(resolveGenerationOutcome({ text: "   ", end: "completed" })).toEqual(
			{ message: null, unanswered: true },
		);
	});
});
