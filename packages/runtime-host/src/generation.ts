import type {
	RuntimeCapabilityRegistry,
	RuntimeHostCallContext,
} from "./capabilities.ts";
import { RUNTIME_HOST_ERROR_CODE, RuntimeHostError } from "./errors.ts";
import type { RuntimeWireValue } from "./wire.ts";

/**
 * Generation capability: the point where the trusted host calls RowCat's generation stack.
 *
 * - Flow: the VM calls useGeneration().generate(request) over the rowcat:internal/host bridge as
 *   capability "generation.generate". This file authorizes, validates, limits concurrency, and
 *   handles cancellation, then calls RuntimeGenerationPort. The port is injected, so this file does
 *   not know what is on its other side (resolveEffectiveGeneration, resolveGenerationExecution,
 *   createGenerationTransport in the app).
 * - Unknown here: providers, models, API keys, SDK clients, fetch, balances, rates, and the
 *   billing ledger. The runtime-host boundary check rejects those names. This layer only knows that
 *   text was requested and text came back.
 */

/**
 * The request the port receives. The VM side has already validated it, and the host validates it
 * again.
 */
export interface RuntimeGenerationHostMessage {
	readonly role: "user" | "assistant";
	readonly content: string;
}

export interface RuntimeGenerationHostRequest {
	readonly messages: readonly RuntimeGenerationHostMessage[];
	/** The creator's role and persona. It does not replace the host's safety instructions. */
	readonly instructions: string;
	/** Upper bound hint for answer length, in characters. The port converts it to its own unit. */
	readonly maxOutputCharacters: number;
}

export interface RuntimeGenerationHostContext {
	readonly sessionId: string;
	/**
	 * Aborted when the session is disposed. The port must pass this signal through to the transport
	 * unchanged.
	 */
	readonly signal: AbortSignal;
}

/**
 * The actual generator. The result is one complete text.
 *
 * Streaming is outside this contract. Streaming inside the port is fine and is what makes
 * cancellation meaningful, but only the finished text crosses out.
 */
export interface RuntimeGenerationPort {
	generate(
		request: RuntimeGenerationHostRequest,
		context: RuntimeGenerationHostContext,
	): Promise<string>;
}

/**
 * The channel through which the port reports failures with a named reason. Every other exception is
 * `failed`.
 */
export type RuntimeGenerationFailureReason =
	| "unavailable"
	| "not-authorized"
	| "insufficient-balance"
	| "cancelled"
	| "failed";

export class RuntimeGenerationError extends Error {
	readonly reason: RuntimeGenerationFailureReason;

	constructor(reason: RuntimeGenerationFailureReason, message: string) {
		super(message);
		this.name = "RuntimeGenerationError";
		this.reason = reason;
	}
}

const REASON_CODE: Readonly<Record<RuntimeGenerationFailureReason, string>> =
	Object.freeze({
		unavailable: RUNTIME_HOST_ERROR_CODE.generationUnavailable,
		"not-authorized": RUNTIME_HOST_ERROR_CODE.generationNotAuthorized,
		"insufficient-balance":
			RUNTIME_HOST_ERROR_CODE.generationInsufficientBalance,
		cancelled: RUNTIME_HOST_ERROR_CODE.generationCancelled,
		failed: RUNTIME_HOST_ERROR_CODE.generationFailed,
	});

/**
 * Host-side limits: the same numbers as the VM, at a different trust level.
 *
 * The VM counts first so the creator gets an exact error on the spot. Counting again here is the
 * last line of defense if that check is bypassed. The limits do not rely only on the provider's
 * cap: that cap is not ours, and its rejection arrives after the request has already gone out.
 */
export interface RuntimeGenerationLimits {
	readonly maxMessages: number;
	readonly maxMessageCharacters: number;
	readonly maxInstructionsCharacters: number;
	readonly maxTotalCharacters: number;
	readonly maxOutputCharacters: number;
	/**
	 * Generations running concurrently per session. V1 uses 1, which makes double presses
	 * deterministic.
	 */
	readonly maxConcurrent: number;
	/**
	 * Total generations this session may issue. This is a budget, not a price. Billing is answered by
	 * the payment layer.
	 */
	readonly maxPerSession: number;
}

export const DEFAULT_GENERATION_LIMITS: RuntimeGenerationLimits = Object.freeze(
	{
		maxMessages: 100,
		maxMessageCharacters: 32_768,
		maxInstructionsCharacters: 32_768,
		maxTotalCharacters: 262_144,
		maxOutputCharacters: 16_000,
		maxConcurrent: 1,
		maxPerSession: 200,
	},
);

export interface RuntimeGenerationOptions {
	port: RuntimeGenerationPort;
	limits?: Partial<RuntimeGenerationLimits>;
	/**
	 * Whether generation may run only from executions started by user interaction. Defaults to true.
	 * This is the billing invariant: a useEffect that runs on every mount must not bill on every mount
	 * (see §79). Turning it off is up to the harness and tests.
	 */
	requireInteraction?: boolean;
	/** Observation hook for counting starts and ends. It is not an axis of correctness. */
	onSettled?: (outcome: { ok: boolean; reason: string | null }) => void;
}

const GENERATE_CAPABILITY = "generation.generate";

const invalid = (why: string): RuntimeHostError =>
	new RuntimeHostError(RUNTIME_HOST_ERROR_CODE.generationInvalidRequest, why);

const record = (
	value: RuntimeWireValue,
): { readonly [key: string]: RuntimeWireValue } | null =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as { readonly [key: string]: RuntimeWireValue })
		: null;

/**
 * Wire value to request. This is an allowlist: unknown keys are dropped silently, and a wrong shape
 * is rejected.
 */
export function readGenerationRequest(
	payload: RuntimeWireValue,
	limits: RuntimeGenerationLimits,
): RuntimeGenerationHostRequest {
	const object = record(payload);
	if (object === null) throw invalid("generation payload is not an object");
	const { messages } = object;
	if (!Array.isArray(messages))
		throw invalid("generation payload has no messages array");
	if (messages.length === 0)
		throw invalid("generation request has no messages");
	if (messages.length > limits.maxMessages)
		throw invalid(
			`generation request has more than ${limits.maxMessages} messages`,
		);

	let total = 0;
	const read: RuntimeGenerationHostMessage[] = [];
	for (let index = 0; index < messages.length; index += 1) {
		const entry = record(messages[index] as RuntimeWireValue);
		if (entry === null) throw invalid(`messages[${index}] is not an object`);
		const { role, content } = entry;
		if (role !== "user" && role !== "assistant")
			throw invalid(`messages[${index}].role is not a generation role`);
		if (typeof content !== "string")
			throw invalid(`messages[${index}].content is not a string`);
		if (content.length > limits.maxMessageCharacters)
			throw invalid(
				`messages[${index}] exceeds ${limits.maxMessageCharacters} characters`,
			);
		total += content.length;
		read.push({ role, content });
	}

	const rawInstructions = object.instructions ?? "";
	if (typeof rawInstructions !== "string")
		throw invalid("instructions is not a string");
	if (rawInstructions.length > limits.maxInstructionsCharacters)
		throw invalid(
			`instructions exceeds ${limits.maxInstructionsCharacters} characters`,
		);
	total += rawInstructions.length;
	if (total > limits.maxTotalCharacters)
		throw invalid(
			`generation request exceeds ${limits.maxTotalCharacters} characters`,
		);

	const requested = object.maxOutputCharacters;
	if (typeof requested !== "number" || !Number.isFinite(requested))
		throw invalid("maxOutputCharacters is not a finite number");

	return {
		messages: read,
		instructions: rawInstructions,
		maxOutputCharacters: Math.min(
			limits.maxOutputCharacters,
			Math.max(1, Math.floor(requested)),
		),
	};
}

/**
 * Per-session generation instrumentation. It is for observation only.
 *
 * No counter feeds authorization, limits, or cancellation. Those decisions are made by the handler
 * using its own state. The counters live only as long as the session, with no telemetry pipeline or
 * storage. `issued` counts only requests that actually reached the trusted stack.
 *
 * Rejections are split into two buckets, and this is the easiest place to get the table wrong. The
 * policy bucket holds what policy blocked: not an interaction, session budget exceeded, or session
 * closing. The limits bucket holds requests that broke the contract's shape or limits. Merging them
 * would combine "the creator wrote it wrong" with "this run cannot generate", which are fixed by
 * different people. Neither bucket reaches the port.
 */
export interface RuntimeGenerationMetrics {
	issued: number;
	completed: number;
	/** Requests where the provider or transport failed. Cancellations are counted in the row below. */
	failed: number;
	/** Requests ended by session disposal or surface stop. */
	cancelled: number;
	/**
	 * Requests blocked by authorization, concurrency, or the session budget. None reached the port.
	 */
	rejectedByPolicy: number;
	/** Requests blocked by shape or limits. These also never reached the port. */
	rejectedByLimits: number;
	/**
	 * The maximum number that ran concurrently. Since the V1 limit is 1, this re-checks that fact as a
	 * value.
	 */
	maxConcurrent: number;
}

export interface RuntimeGenerationCapability {
	/** Spread as-is into the session option `capabilities`. */
	readonly capabilities: RuntimeCapabilityRegistry;
	active(): number;
	issued(): number;
	/** A copy of the counters so far. Callers can keep it; it does not change afterward. */
	metrics(): RuntimeGenerationMetrics;
}

/**
 * Creates one capability. Its only job is to put one name into the table.
 *
 * Creators never touch this string. On the VM side, only the internal module
 * `rowcat:internal/generation` knows the name, and the compiler allowlist blocks that module from
 * user code.
 */
export function createGenerationCapability(
	options: RuntimeGenerationOptions,
): RuntimeGenerationCapability {
	const limits: RuntimeGenerationLimits = {
		...DEFAULT_GENERATION_LIMITS,
		...options.limits,
	};
	const requireInteraction = options.requireInteraction !== false;
	let active = 0;
	let issued = 0;
	const counters: RuntimeGenerationMetrics = {
		issued: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
		rejectedByPolicy: 0,
		rejectedByLimits: 0,
		maxConcurrent: 0,
	};

	const generate = async (
		payload: RuntimeWireValue,
		context: RuntimeHostCallContext,
	): Promise<RuntimeWireValue> => {
		/**
		 * Authorization comes before validation. Placed after it, unauthorized requests would get
		 * different errors depending on whether their shape is valid, and that difference would become a
		 * detector.
		 */
		if (requireInteraction && context.origin !== "event") {
			counters.rejectedByPolicy += 1;
			throw new RuntimeHostError(
				RUNTIME_HOST_ERROR_CODE.generationNotAuthorized,
				"generation must start from a user interaction",
			);
		}
		if (context.signal.aborted) {
			counters.rejectedByPolicy += 1;
			throw new RuntimeHostError(
				RUNTIME_HOST_ERROR_CODE.generationCancelled,
				"session is closing",
			);
		}
		if (active >= limits.maxConcurrent) {
			counters.rejectedByPolicy += 1;
			throw new RuntimeHostError(
				RUNTIME_HOST_ERROR_CODE.generationBusy,
				"another generation is already running",
			);
		}
		if (issued >= limits.maxPerSession) {
			counters.rejectedByPolicy += 1;
			throw new RuntimeHostError(
				RUNTIME_HOST_ERROR_CODE.generationNotAuthorized,
				`this session reached its generation budget of ${limits.maxPerSession}`,
			);
		}
		/**
		 * Validation runs after authorization on purpose; this does not contradict §15. An unauthorized
		 * request whose shape is checked first would get shape-dependent errors, and that difference
		 * would become a detector. Validation still runs before the port, which is what §15 requires.
		 */
		let request: RuntimeGenerationHostRequest;
		try {
			request = readGenerationRequest(payload, limits);
		} catch (cause) {
			counters.rejectedByLimits += 1;
			throw cause;
		}

		active += 1;
		issued += 1;
		counters.issued += 1;
		if (active > counters.maxConcurrent) counters.maxConcurrent = active;
		try {
			const text = await options.port.generate(request, {
				sessionId: context.sessionId,
				signal: context.signal,
			});
			if (typeof text !== "string")
				throw new RuntimeGenerationError(
					"failed",
					"generation port returned a non-string",
				);
			counters.completed += 1;
			options.onSettled?.({ ok: true, reason: null });
			return { text };
		} catch (cause) {
			/**
			 * Provider error objects, stacks, and response bodies never reach the VM. Only a reason and one
			 * sentence go out. A failure with no stated reason becomes `failed`. Inventing a name for an
			 * unknown failure would eventually give wrong guidance.
			 */
			const reason: RuntimeGenerationFailureReason =
				cause instanceof RuntimeGenerationError
					? cause.reason
					: context.signal.aborted
						? "cancelled"
						: "failed";
			if (reason === "cancelled") counters.cancelled += 1;
			else counters.failed += 1;
			options.onSettled?.({ ok: false, reason });
			throw new RuntimeHostError(
				REASON_CODE[reason] as never,
				cause instanceof RuntimeGenerationError
					? cause.message
					: "generation failed",
			);
		} finally {
			active -= 1;
		}
	};

	return {
		capabilities: { [GENERATE_CAPABILITY]: generate },
		active: () => active,
		issued: () => issued,
		metrics: () => ({ ...counters }),
	};
}

export const RUNTIME_GENERATION_CAPABILITY_NAME = GENERATE_CAPABILITY;
