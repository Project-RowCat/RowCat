import type { SafeGenerationFailure } from "@rowcat/chat";
import { failureCode, generationFailureMessage } from "./error.ts";

/**
 * Observation-only projection of one failure; the provider's raw message never passes through.
 *
 * Same shape as the web's `features/conversation/generation-debug.ts` but a different message
 * table, on purpose: each app's failure copy is its own screen vocabulary, and merging would make
 * the pure layer know locale and screen copy. What is carried is decided by `SafeGenerationFailure`
 * alone, which has no `message` field, so there is no slot for a provider SDK sentence.
 */
export function safeGenerationFailure(error: Error): SafeGenerationFailure {
	return {
		name: error.name,
		code: failureCode(error),
		summary: generationFailureMessage(error),
	};
}
