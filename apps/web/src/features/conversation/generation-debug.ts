import type { SafeGenerationFailure } from "@rowcat/chat";
import { failureCode, generationFailureMessage } from "./generation-error.ts";

/**
 * Observation projection of one failure. Provider raw text must not pass through here.
 *
 * The repo has already learned this once. The runtime preview's generation failure states in its
 * header that a named reason is not a pass for raw text (runtime-preview-generation-failure.ts).
 * The same mistake is easier here, because a debugger screen is where showing raw text looks
 * helpful.
 *
 * Fields:
 * - name: the exception class name. It carries no secret.
 * - code: our failure code. Only names the server attached.
 * - summary: our own sentence, chosen by the failure table on the screen (generation-error.ts).
 *
 * The `message` field is deliberately absent. Exceptions on the BYO path come from the provider
 * SDK, and what they carry depends on the day. A line like `401 … Authorization: Bearer sk-live-…`
 * would travel to the maker's screen, screenshots and bug reports. This is that exact path.
 *
 * The summary is not written directly here either. It must pass through the screen's table. Two
 * copies would make the inspector and the chat window describe the same failure differently, and
 * that mismatch would teach the maker to trust one of them.
 */
export function safeGenerationFailure(error: Error): SafeGenerationFailure {
	return {
		name: error.name,
		code: failureCode(error),
		summary: generationFailureMessage(error),
	};
}
