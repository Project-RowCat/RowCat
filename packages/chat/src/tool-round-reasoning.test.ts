import type { ChatGenerationRequest } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { chatToolRoundReasoning } from "./tool-round-reasoning.ts";

const opening: Pick<ChatGenerationRequest, "messages" | "reasoningEffort"> = {
	messages: [{ role: "user", content: "안녕" }],
	reasoningEffort: "low",
};
const roundTrip: Pick<ChatGenerationRequest, "messages" | "reasoningEffort"> = {
	messages: [
		{ role: "user", content: "안녕" },
		{
			role: "assistant",
			content: "",
			toolCall: { id: "c1", name: "lore_search", arguments: {} },
		},
		{ role: "tool", callId: "c1", content: "결과" },
	] as ChatGenerationRequest["messages"],
	reasoningEffort: "low",
};

describe("chatToolRoundReasoning", () => {
	it("passes an ordinary request through for every model", () => {
		for (const model of ["claude-opus-4-8", "gemini-3-pro", "gpt-5"])
			expect(chatToolRoundReasoning(model, opening)).toBe("low");
	});

	/**
	 * These models think whether or not the parameter is sent, so dropping it only reset the depth to
	 * the model's default: a room set to `low` paid for deeper thinking on every follow-up round.
	 */
	it("keeps the turn's level on a round trip for models that think without a parameter", () => {
		for (const model of [
			"claude-opus-5-5",
			"anthropic/claude-opus-5.5",
			"~anthropic/claude-sonnet-5.5",
			"anthropic/claude-fable-5.1:nitro",
			"claude-haiku-5-5",
		])
			expect(chatToolRoundReasoning(model, roundTrip)).toBe("low");
	});

	/**
	 * For these the parameter is what turns thinking on, and the assembled assistant turn carries no
	 * thinking block, which the extended form requires (a 400 after the body already streamed).
	 */
	it("drops reasoning on a round trip for every other model", () => {
		for (const model of [
			"claude-opus-4-8",
			"anthropic/claude-sonnet-4.6",
			"claude-sonnet-4-5",
			"gemini-3-pro",
			"openai/gpt-5",
		])
			expect(chatToolRoundReasoning(model, roundTrip)).toBeNull();
	});
});
