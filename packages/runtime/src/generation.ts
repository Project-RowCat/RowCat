import {
	RUNTIME_ERROR_CODE,
	RuntimeError,
	type RuntimeErrorCode,
} from "./internal/errors.ts";
import { runtimeHostCapability } from "./internal/host-capability.ts";
import { runtimePhase } from "./internal/phase.ts";

/**
 * The generation capability: the only route by which an author calls RowCat's AI.
 *
 * - Flow: the author passes a narrow product request. The trusted RowCat generation stack on the
 *   host resolves the target, handles managed billing and BYO routing, and sends it. The author
 *   gets back `{ text }` and decides where it goes.
 * - The request has no provider, model, apiKey, temperature or reasoningEffort. Those follow
 *   RowCat product rules (device preference, managed vs BYO resolution, connection check). If an
 *   author could pin a provider, the work would halt when that provider disappeared. Authors
 *   therefore do not know whether a call is managed or BYO, and should not branch on it.
 * - The result is a proposal. `generate` does not change saved state. Appending the reply to
 *   history is the author's `setStoryState` call, in an order the author chooses. If the host
 *   appended messages silently, the story would have two authors.
 * - No streaming in V1: one await returns the full text. Streaming happens inside the host, but
 *   deltas do not reach the VM, because then scheduler semantics, cancellation, state consistency
 *   and bridge traffic would all become API questions at once. Streaming can be added later as an
 *   addition.
 * - Not in the result, by design: token counts, cost, balance, provider name, model id, stop
 *   reason, request headers, raw response. Their absence is the boundary this contract keeps.
 */

/**
 * One conversation turn. Having no system role is the point: that slot belongs to `instructions`.
 */
export interface RuntimeGenerationMessage {
	role: "user" | "assistant";
	content: string;
}

/**
 * The role and character this experience needs. It does not replace the host's safety instructions.
 * Order of the prompt:
 * - [RowCat] absolute prohibitions and rating guard: set by the host, cannot be removed by the
 *   author.
 * - [author] instructions: this value, dependent application content.
 * - [author] messages: the conversation.
 * - [RowCat] rating tail guard: the last instruction before generation.
 */
export interface RuntimeGenerationRequest {
	messages: readonly RuntimeGenerationMessage[];
	instructions?: string;
	/**
	 * Upper-bound hint for answer length, in characters. The host converts it to its own unit and
	 * truncates to its own cap; tokenizers belong to the host, so this contract never says 'token'.
	 */
	maxOutputCharacters?: number;
}

export interface RuntimeGenerationResult {
	text: string;
}

/**
 * One generation capability. Returned by `useGeneration()`; its identity is stable within one
 * mounted slot. An object so later operations (cancel, streaming) have room. Only `generate` exists
 * for now.
 */
export interface RuntimeGeneration {
	generate(request: RuntimeGenerationRequest): Promise<RuntimeGenerationResult>;
}

/**
 * Request limits. The VM counts first and the host counts again. The VM count gives the author an
 * exact error at the call site; the host check is the last line of defense if this code is bypassed
 * (the same judgment as validating wire values twice). The unit is characters (UTF-16 code units)
 * so the two sides cannot disagree. Counting bytes would let two realms return different numbers
 * for the same string.
 */
export const RUNTIME_GENERATION_LIMITS = Object.freeze({
	maxMessages: 100,
	maxMessageCharacters: 32_768,
	maxInstructionsCharacters: 32_768,
	maxTotalCharacters: 262_144,
	maxOutputCharacters: 16_000,
	defaultOutputCharacters: 4_000,
});

/**
 * The capability name. Authors have no path to this string, since `index.ts` does not re-export
 * this module.
 */
const GENERATE_CAPABILITY = "generation.generate";

const invalid = (why: string): RuntimeError =>
	new RuntimeError(RUNTIME_ERROR_CODE.generationInvalidRequest, why);

/** Maps the codes the host returns to runtime codes. Anything not in the table becomes `failed`. */
const HOST_CODE: Readonly<Record<string, RuntimeErrorCode>> = Object.freeze({
	runtime_generation_unavailable: RUNTIME_ERROR_CODE.generationUnavailable,
	runtime_generation_not_authorized: RUNTIME_ERROR_CODE.generationNotAuthorized,
	runtime_generation_insufficient_balance:
		RUNTIME_ERROR_CODE.generationInsufficientBalance,
	runtime_generation_busy: RUNTIME_ERROR_CODE.generationBusy,
	runtime_generation_cancelled: RUNTIME_ERROR_CODE.generationCancelled,
	runtime_generation_invalid_request:
		RUNTIME_ERROR_CODE.generationInvalidRequest,
	runtime_generation_failed: RUNTIME_ERROR_CODE.generationFailed,
	runtime_cancelled: RUNTIME_ERROR_CODE.generationCancelled,
	runtime_disposed: RUNTIME_ERROR_CODE.generationCancelled,
	runtime_host_capability_unknown: RUNTIME_ERROR_CODE.generationUnavailable,
});

/**
 * Normalizes a request into wire values and validates it. Values that fail are thrown on the spot.
 * Silently dropping them as 'best effort' would leave the author unable to tell that the
 * conversation sent to the model differs from what they sent.
 */
function encodeRequest(request: RuntimeGenerationRequest): {
	messages: { role: string; content: string }[];
	instructions: string;
	maxOutputCharacters: number;
} {
	if (typeof request !== "object" || request === null)
		throw invalid("A generation request must be an object.");
	const { messages } = request;
	if (!Array.isArray(messages))
		throw invalid("A generation request's messages must be an array.");
	if (messages.length === 0)
		throw invalid("The generation request has no messages.");
	if (messages.length > RUNTIME_GENERATION_LIMITS.maxMessages)
		throw invalid(
			`At most ${RUNTIME_GENERATION_LIMITS.maxMessages} messages can be sent.`,
		);

	let total = 0;
	const encoded: { role: string; content: string }[] = [];
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (typeof message !== "object" || message === null)
			throw invalid(`messages[${index}] is not an object.`);
		const { role, content } = message;
		if (role !== "user" && role !== "assistant")
			throw invalid(`messages[${index}].role must be "user" or "assistant".`);
		if (typeof content !== "string")
			throw invalid(`messages[${index}].content is not a string.`);
		if (content.length > RUNTIME_GENERATION_LIMITS.maxMessageCharacters)
			throw invalid(
				`messages[${index}] exceeds ${RUNTIME_GENERATION_LIMITS.maxMessageCharacters} characters.`,
			);
		total += content.length;
		encoded.push({ role, content });
	}

	const instructions = request.instructions ?? "";
	if (typeof instructions !== "string")
		throw invalid("instructions is not a string.");
	if (instructions.length > RUNTIME_GENERATION_LIMITS.maxInstructionsCharacters)
		throw invalid(
			`instructions exceeds ${RUNTIME_GENERATION_LIMITS.maxInstructionsCharacters} characters.`,
		);
	total += instructions.length;
	if (total > RUNTIME_GENERATION_LIMITS.maxTotalCharacters)
		throw invalid(
			`The whole request exceeds ${RUNTIME_GENERATION_LIMITS.maxTotalCharacters} characters. Send only the recent conversation.`,
		);

	const requested =
		request.maxOutputCharacters ??
		RUNTIME_GENERATION_LIMITS.defaultOutputCharacters;
	if (typeof requested !== "number" || !Number.isFinite(requested))
		throw invalid("maxOutputCharacters is not a finite number.");
	const maxOutputCharacters = Math.min(
		RUNTIME_GENERATION_LIMITS.maxOutputCharacters,
		Math.max(1, Math.floor(requested)),
	);

	return { messages: encoded, instructions, maxOutputCharacters };
}

const hostCodeOf = (error: unknown): string | null => {
	if (typeof error !== "object" || error === null) return null;
	const code = (error as { rowcatHostCode?: unknown }).rowcatHostCode;
	return typeof code === "string" ? code : null;
};

function toRuntimeError(error: unknown): RuntimeError {
	if (error instanceof RuntimeError) return error;
	const code = hostCodeOf(error);
	const mapped =
		code === null
			? undefined
			: (HOST_CODE[code] as RuntimeErrorCode | undefined);
	const message =
		typeof error === "object" &&
		error !== null &&
		typeof (error as { message?: unknown }).message === "string"
			? (error as { message: string }).message
			: "Couldn't get an AI response.";
	return new RuntimeError(
		mapped ?? RUNTIME_ERROR_CODE.generationFailed,
		message,
	);
}

async function generate(
	request: RuntimeGenerationRequest,
): Promise<RuntimeGenerationResult> {
	/**
	 * Do not start during render. The same tree rendered twice would send twice, and both sends are
	 * billed. This check runs before the host's authorization so the author gets an exact name. The
	 * host rejects the same request, but its name is 'not authorized', which does not say what to
	 * change.
	 */
	if (runtimePhase() === "render")
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.generationDuringRender,
			"generate() can't be called during render. Call it from an event handler.",
		);
	const payload = encodeRequest(request);
	let value: unknown;
	try {
		value = await runtimeHostCapability()(GENERATE_CAPABILITY, payload);
	} catch (error) {
		throw toRuntimeError(error);
	}
	if (
		typeof value !== "object" ||
		value === null ||
		typeof (value as { text?: unknown }).text !== "string"
	)
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.generationFailed,
			"The AI response has an invalid shape.",
		);
	return { text: (value as { text: string }).text };
}

/**
 * The session's capability object is a module singleton. It holds no state (concurrency limits and
 * cancellation live in the host), so there is no reason for each component to get its own object.
 * As a singleton, the rule 'no new { generate } per render' (section 24) holds by construction.
 * Freezing stops authors from replacing `generation.generate`; it is not a security boundary, since
 * that is inside the author's own realm.
 */
export const RUNTIME_GENERATION: RuntimeGeneration = Object.freeze({
	generate,
});
