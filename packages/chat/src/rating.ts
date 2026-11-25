import type {
	ChatGenerationContext,
	ChatGenerationMode,
} from "@rowcat/contracts/chat";

/**
 * Decides whether this turn proceeds as all-ages: the server's final decision.
 *
 * This differs in axis from resolveAllAges (context.ts), which uses the room rating and member
 * settings on the device. This function caps the result using the membership eligibility the server
 * knows, whatever the request claims. Both exist because trust differs: the assembler runs inside
 * the client, while this function receives HTTP requests from anyone.
 *
 * The rule is one line: adult mode opens only when both the request and the eligibility hold.
 * Without eligibility, the request is all-ages regardless of what it asks for. What the rating still
 * moves is the expression-intensity block (`resolveChatIntensity`) and, on Gemini BYO, the provider's
 * filter thresholds; there are no platform guard blocks any more.
 */
export function resolvePlatformAllAges(input: {
	/**
	 * The rating the client requested. Unknown values were already filtered by the contract at the
	 * call site.
	 */
	requestedMode: ChatGenerationMode;
	/** Whether this member may view adult content. The server reads this from the session. */
	adultAllowed: boolean;
}): boolean {
	return !(input.requestedMode === "adult" && input.adultAllowed);
}

/**
 * The rating a runtime generation request (`useGeneration()`) declares. Web preview, web playback and
 * the mobile player all call this one function, so the three cannot disagree about it. The creator's
 * instructions go out as the system prompt verbatim.
 */
export function runtimeGenerationContext(
	allAges: boolean,
): ChatGenerationContext {
	return { requestedMode: allAges ? "all-ages" : "adult" };
}
