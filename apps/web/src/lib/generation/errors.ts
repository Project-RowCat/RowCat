import { translator } from "#/lib/i18n/current.ts";

/**
 * The RowCat vocabulary for provider failures. Vendor responses end in this file.
 *
 * - Leakage: vendor error bodies can carry account, org and request ids, upstream routing data,
 *   and sometimes echo the prompt. If shown or thrown, error reporters would collect the user's
 *   conversation. So adapters never throw vendor objects. They translate the status code into this
 *   vocabulary and drop the body.
 * - Guidance: what the user can do depends on the failure (fix the key, retry later, pick another
 *   model, report it). A status code alone cannot tell the screen which one to say.
 *
 * The server applies the same rule (logProviderFailure in apps/api/src/services/generation/chat.ts
 * logs only the status code). BYO bypasses that server, so the rule is re-established in the
 * browser. Whichever side enforces it, the promise must be the same.
 */

/**
 * Each value is what the user can do next.
 *
 * Vendor error types (overloaded_error, RESOURCE_EXHAUSTED) are not copied. As providers multiply,
 * the vocabulary would grow and the screen would end up branching on each vendor's names.
 */
export type ProviderErrorCode =
	/** Key missing or rejected (401 or 403). Next action: reconnect the key. */
	| "invalid_credential"
	/** Rate limited (429). Next action: retry after a while. */
	| "rate_limited"
	/** Credits or quota exhausted. Next action: check the provider account. */
	| "quota_exceeded"
	/** Model not available on this account (404 or a model error). Next action: pick another model. */
	| "model_unavailable"
	/** Network unreachable. Next action: check the connection and retry. */
	| "network"
	/**
	 * The provider's content policy blocked this response.
	 *
	 * This is a different layer from our safety guard. The guard decides what gets written. This is
	 * the policy between the provider and the user's account. BYO requests go out on the user's key,
	 * so we have no place in that relationship.
	 *
	 * It has its own code because no other reading is right. For a time this case fell through to a
	 * stream with no finish reason, so it showed as provider_error (a cut stream). The screen showed
	 * only `Regenerate`, which gets the same answer again.
	 */
	| "content_blocked"
	/**
	 * Blocked by the browser or an organization policy (CORS, an extension, or CSP). See the note on
	 * providerErrorForThrown below.
	 */
	| "browser_blocked"
	/** Any other provider failure (5xx or an unrecognized response). */
	| "provider_error";

/**
 * The sentence the user reads. It must not contain raw error text.
 *
 * It is short, states the next action, and does not name the provider (the screen already knows
 * which provider it is). It also does not put the status code in the sentence. The code does not
 * change what the user can do, and diagnostics already record it.
 */
const messageFor = (code: ProviderErrorCode): string =>
	translator("generation")(`providerError.${code}`);

/*
 * Two of the sentences in `providerError` carry rules of their own:
 *
 * - `content_blocked` must not read as if we blocked it. This deployment allows adult content for
 *   users who completed adult verification. What blocks here is the provider's policy, not that
 *   judgment. If the sentence does not say so, users go looking in settings for something to fix.
 *   The rule of not naming the provider holds here too. The sentence lists two things the user can
 *   do. Retrying is not one of them, because the same answer comes back (canRetryGeneration).
 * - `browser_blocked` must not offer to send the request to RowCat servers instead. That
 *   substitution breaks the BYO definition (the key and prompt would pass through our server), so it
 *   appears neither in the code nor in the guidance.
 */

/**
 * A provider failure is a bounded error. It extends Error but carries no vendor fields.
 *
 * If it did, error reporters would serialize them, and that serialization would contain everything
 * the file header lists.
 */
export class ProviderError extends Error {
	readonly code: ProviderErrorCode;
	/**
	 * Retry delay in seconds that is safe to expose; undefined when unknown.
	 *
	 * Filled only when the provider sent retry-after. The number is not invented, because it becomes a
	 * promise to the user, and a wrong wait time is worse than none.
	 */
	readonly retryAfterSeconds: number | undefined;

	constructor(code: ProviderErrorCode, retryAfterSeconds?: number) {
		super(messageFor(code));
		this.name = "ProviderError";
		this.code = code;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

/**
 * Maps an HTTP status to the vocabulary. Both providers share this table.
 *
 * The meaning of a status code comes from HTTP, not from vendor docs, and both providers return the
 * same codes in the same places. Separate tables would eventually send 429 to provider_error on one
 * side only.
 */
export function providerErrorForStatus(
	status: number,
	retryAfterSeconds?: number,
): ProviderError {
	if (status === 401 || status === 403)
		return new ProviderError("invalid_credential");
	if (status === 404) return new ProviderError("model_unavailable");
	if (status === 429)
		return new ProviderError("rate_limited", retryAfterSeconds);
	/**
	 * 402 is billing or credits. It is kept apart from 429 because the user's action differs: waiting
	 * does not fix it.
	 */
	if (status === 402) return new ProviderError("quota_exceeded");
	return new ProviderError("provider_error");
}

/**
 * Reads Retry-After only within a safe range. Only integer seconds are accepted.
 *
 * HTTP also allows a date, but parsing it would make the stated wait as wrong as the user's clock.
 * The cap keeps a huge value from a provider mistake from producing a message like 'retry in 3
 * days'.
 */
export function readRetryAfterSeconds(headers: Headers): number | undefined {
	const raw = headers.get("retry-after");
	if (!raw) return undefined;
	const seconds = Number.parseInt(raw, 10);
	if (!Number.isFinite(seconds) || seconds < 0) return undefined;
	return Math.min(seconds, 3600);
}

/**
 * Maps whatever fetch threw into the vocabulary.
 *
 * An abort is not an error. It is rethrown unchanged, because the caller must treat it as the user
 * pressing stop.
 *
 * Any other TypeError in a browser is one of two things: the network really was unreachable, or
 * CORS, an extension or a policy blocked the request. The browser does not tell them apart, and
 * making it possible would leak cross-origin information. So the two are not folded into one. The
 * code admits that no usable signal separates them, and the guidance text names both possibilities,
 * which is the honest choice.
 */
export function providerErrorForThrown(thrown: unknown): ProviderError {
	if (thrown instanceof ProviderError) return thrown;
	if (thrown instanceof DOMException && thrown.name === "AbortError")
		throw thrown;
	return new ProviderError("browser_blocked");
}

/**
 * Why this function exists: a failure that only happens in continuations (a 400 from the prefill
 * and thinking combination) logged nothing to the browser console. The user saw only 'the provider
 * could not process the request', which matches 401, 429 and 5xx alike. Reproducing it would
 * require the user's model, settings and conversation state.
 *
 * Logged: provider, model, HTTP status, our failure code, whether it was a continuation, whether
 * reasoning was on, and the vendor error type when it has slug shape. Not logged: API key, system
 * prompt, conversation text, sentences from the error body, account, org or request ids.
 *
 * The vendor type is narrowed by shape rather than taken as-is. It is an enumeration, not a
 * sentence (overloaded_error, invalid_request_error). A value that is not slug-shaped means the
 * field is not what we expect, so it is dropped. Without this check, free text would eventually end
 * up in this line.
 */
const VENDOR_CODE_SHAPE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

export interface ProviderDiagnostics {
	provider: string;
	model: string;
	code: ProviderErrorCode;
	/** HTTP status. Absent for failures that happen mid-stream. */
	status?: number;
	/** Whether this request was a continuation. Some failures occur only in continuations. */
	continuation: boolean;
	/** Whether a reasoning parameter was sent. The other half of the combination above. */
	reasoning: boolean;
	/** The vendor's error type. Dropped unless it has slug shape (see VENDOR_CODE_SHAPE). */
	vendorCode?: string | undefined;
}

/**
 * Writes one console line for a provider failure. The sentence shown to the user is still the one
 * in the `providerError` messages. This line is read only by people in developer tools and server logs.
 *
 * The split is the rule of this slice: the user needs to know what to do next, and we need to know
 * the cause.
 */
export function logProviderFailure(diagnostics: ProviderDiagnostics): void {
	const vendor =
		diagnostics.vendorCode && VENDOR_CODE_SHAPE.test(diagnostics.vendorCode)
			? ` vendor=${diagnostics.vendorCode}`
			: "";
	console.error(
		`[generation] provider failure: provider=${diagnostics.provider} model=${diagnostics.model}` +
			`${diagnostics.status === undefined ? "" : ` status=${diagnostics.status}`}` +
			` code=${diagnostics.code} continuation=${diagnostics.continuation}` +
			` reasoning=${diagnostics.reasoning}${vendor}`,
	);
}
