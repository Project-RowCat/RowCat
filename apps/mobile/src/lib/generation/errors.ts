/**
 * RowCat vocabulary for provider failures. Vendor responses end here.
 *
 * Same place as the web's `lib/generation/errors.ts`, with one fewer kind, and that difference is
 * the most important fact in this file:
 *
 * ```text
 * web       browser_blocked   CORS, an extension or CSP blocked the request
 * native    (none)            this runtime has no origin, extensions or CSP
 * ```
 *
 * Copying the web kind over would tell someone whose Wi-Fi dropped on Android that the browser
 * could not reach the provider, and there is no browser to act on. A native transport failure is a
 * network failure.
 *
 * This file exists for two reasons:
 * - **Leakage.** Provider error bodies carry account, org and request ids, and sometimes echo
 *   back the prompt. Showing or throwing them would let error reporters collect the user's
 *   conversation text. So adapters never throw vendor objects: they translate the status code into
 *   this vocabulary and do not read the body.
 * - **Guidance.** What the user can do differs per failure (fix the key, retry later, check the
 *   provider account, pick another model). A status code alone cannot tell the screen which one to
 *   say.
 */

/**
 * The kinds of failure. Each value is **the next thing the user can do.**
 *
 * Vendor error types are not copied (`overloaded_error`, `RESOURCE_EXHAUSTED`). As providers grow,
 * the vocabulary grows too, and the screen would end up branching on each name.
 */
export type ProviderErrorCode =
	/** Key missing or rejected (401/403). Next step: reconnect the key. */
	| "invalid_credential"
	/** Rate limited (429). Next step: retry later. */
	| "rate_limited"
	/** Credits or quota exhausted (402). Next step: check the provider account. */
	| "quota_exceeded"
	/** This account cannot use that model (404). Next step: pick another model. */
	| "model_unavailable"
	/** The request never reached the provider. Next step: check the connection and retry. */
	| "network"
	/**
	 * **The provider's content policy blocked this response.** It is a different layer from our safety
	 * guards: the guards decide what the prompt asks for, while this is the provider's own policy on
	 * top. A BYO request goes out under the user's key, so we have no place in that relationship.
	 *
	 * It has its own code because it cannot be read as anything else. For a while it arrived as a
	 * stream that ended without a completion reason, which mapped to `provider_error` (a cut stream),
	 * and the screen offered only `Regenerate`, which gets the same answer back.
	 */
	| "content_blocked"
	/** Any other provider failure (5xx or an unknown response). */
	| "provider_error";

/**
 * What the user reads. **Never contains the original error.**
 *
 * Short, states the next action, and does not name the provider (the screen already knows which
 * one). It does not include the status code either: the user's options do not change with it. **No
 * sentence suggests a RowCat-managed fallback.** That substitution would break BYO's definition
 * (the key and prompt pass through our server), so neither the code nor the copy contains it.
 */
const MESSAGES: Record<ProviderErrorCode, string> = {
	invalid_credential: "Please check your API key.",
	rate_limited:
		"You've hit the provider's request limit. Please try again in a moment.",
	quota_exceeded:
		"You've exceeded your provider account's usage limit. Please check your provider account.",
	model_unavailable:
		"This model isn't available for this account. Please choose another model.",
	network: "Couldn't reach the provider. Please check your network.",
	/**
	 * **It must not read as our block.** This deployment allows adult content for verified adults;
	 * what blocked it here is the provider's policy, not that judgment. If the sentence does not say
	 * so, the user goes hunting for something to change in settings. Same sentence as the web.
	 */
	content_blocked:
		"The provider's content policy blocked this response. Change the scene or choose another model.",
	provider_error: "The provider couldn't process the request.",
};

/**
 * A provider failure: a **boundary error**.
 *
 * Extends `Error` but carries no vendor fields. Diagnostics serialize errors, and vendor fields
 * would be serialized along with everything listed above.
 */
export class ProviderError extends Error {
	readonly code: ProviderErrorCode;
	/**
	 * Retry delay in seconds, safe to show. Set only when the provider sent `retry-after`.
	 *
	 * Never invented: the number is a promise to the user, and a wrong wait is worse than none.
	 */
	readonly retryAfterSeconds: number | undefined;

	constructor(code: ProviderErrorCode, retryAfterSeconds?: number) {
		super(MESSAGES[code]);
		this.name = "ProviderError";
		this.code = code;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

/**
 * Maps an HTTP status to the vocabulary.
 *
 * Both providers share this table. HTTP defines what the codes mean, and the two providers return
 * the same codes in the same places. Separate tables would eventually let one of them fold 429 into
 * `provider_error`.
 *
 * **The response body never selects the branch.** Its text changes whenever the provider likes, and
 * reading it would reopen the leakage path above.
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
	 * 402 is billing and credits. It is kept apart from 429 because the user's next step differs:
	 * waiting does not fix it.
	 */
	if (status === 402) return new ProviderError("quota_exceeded");
	return new ProviderError("provider_error");
}

/**
 * Reads `Retry-After` **only within a safe range.**
 *
 * Accepts integer seconds only. HTTP also allows a date, but parsing it would make the wait wrong
 * by however far the user's clock is off. The cap stops a provider's accidental huge value from
 * making the screen say "retry in 3 days".
 */
export function readRetryAfterSeconds(headers: Headers): number | undefined {
	const raw = headers.get("retry-after");
	if (!raw) return undefined;
	const seconds = Number.parseInt(raw, 10);
	if (!Number.isFinite(seconds) || seconds < 0) return undefined;
	return Math.min(seconds, 3600);
}

/**
 * Maps a value thrown by `fetch` into the vocabulary.
 *
 * **Abort is not an error.** Callers must treat it as the user's stop, so it is rethrown. There are
 * two checks because of the runtime: `expo/fetch` throws `FetchError` for an abort before the
 * stream starts and an error named `AbortError` mid-stream. Checking the name alone would record
 * the first case as a network failure.
 *
 * Everything else is `network`. There is no browser-blocked kind: this runtime has no CORS,
 * extensions or CSP, and guidance for a cause that does not exist would send the user somewhere
 * useless.
 */
export function providerErrorForThrown(
	thrown: unknown,
	signal?: AbortSignal,
): ProviderError {
	if (thrown instanceof ProviderError) return thrown;
	if (signal?.aborted) throw thrown;
	if (
		typeof thrown === "object" &&
		thrown !== null &&
		"name" in thrown &&
		(thrown as { name?: unknown }).name === "AbortError"
	)
		throw thrown;
	return new ProviderError("network");
}
