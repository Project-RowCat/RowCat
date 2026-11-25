import type { ChatGenerationRequest } from "@rowcat/contracts";
import type { ReasoningEffort } from "./reasoning.ts";

/**
 * Anthropic models whose thinking runs whether or not a thinking parameter is sent: adaptive models
 * whose default is thinking on (the Fable 5 family and Opus 5.5 cannot turn it off at all).
 *
 * Why the list exists. A tool round trip's follow-up request used to drop reasoning for every model
 * (`nextChatToolRequest`), because Anthropic's extended form requires a thinking block at the start
 * of the last assistant turn and the assembled turn has none, so keeping reasoning was a 400. For
 * the models listed here, dropping the parameter never turned thinking off: it only reset the depth
 * to the model's own default. A room set to `low` then paid for `medium` or `high` thinking on every
 * follow-up round, and a Sonnet 5.5 room set to `off` (`between_tools`) thought at `high`. Keeping
 * the chosen level changes depth only, never whether the model thinks, so it cannot bring that 400
 * back. Measured live on Sonnet 5.5 on 2026-11-02: thinking kept or omitted on the follow-up, both
 * answered without replayed thinking blocks.
 *
 * Models that default to thinking off (Opus 4.8, 4.7, 4.6, Sonnet 4.6) and manual-budget models (the
 * 4.5 generation) are left out: for them the parameter is what turns thinking on, and dropping it
 * is the original fix. Every other provider keeps the old drop as well.
 */
const THINKS_WITHOUT_PARAMETER: ReadonlySet<string> = new Set([
	"claude-fable-5-1",
	"claude-fable-5",
	"claude-opus-5-5",
	"claude-opus-5",
	"claude-sonnet-5-5",
	"claude-sonnet-5",
	"claude-haiku-5-5",
]);

/**
 * One name for the three spellings the adapters see: the direct API id (`claude-opus-5-5`), the
 * gateway slug (`anthropic/claude-opus-5.5`) and its variants (`~…`, `…:nitro`).
 */
function anthropicModelKey(model: string): string {
	return model
		.replace(/^~/, "")
		.replace(/^anthropic\//, "")
		.split(":")[0]
		.replace(/\./g, "-");
}

/**
 * The reasoning level an adapter should send for this request. Ordinary requests pass through
 * unchanged. A tool round trip's follow-up (the request ends in a tool result) keeps the turn's level
 * only for a model that thinks without a parameter; anything else gets `null`, as before.
 *
 * The decision lives with the model, so each adapter calls this with the model id it is about to
 * send (`@rowcat/chat` does not know which target a loop runs on).
 */
export function chatToolRoundReasoning(
	model: string,
	request: Pick<ChatGenerationRequest, "messages" | "reasoningEffort">,
): ReasoningEffort | null {
	if (request.messages.at(-1)?.role !== "tool") return request.reasoningEffort;
	return THINKS_WITHOUT_PARAMETER.has(anthropicModelKey(model))
		? request.reasoningEffort
		: null;
}
