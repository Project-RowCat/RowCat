import type { ChatGenerationRequest, ChatStreamEvent } from "@rowcat/contracts";
import type { ProviderError } from "./errors.ts";

/**
 * The shape a BYO adapter fills. Adding a provider must mean filling this interface in one module.
 * If it requires touching the conversation lifecycle, settings, storage or sync, the boundary is
 * drawn wrong. The web's `lib/generation/transport.ts` honors the same contract.
 *
 * ```text
 * buildChatGenerationRequest()   ← product prompt assembly, one per path
 *          ↓  ChatGenerationRequest
 * ByoAdapter.start()             ← the only place providers diverge. **The secret ends here.**
 *          ↓  AsyncIterable<ChatStreamEvent>
 * useChatGeneration              ← knows no provider
 * ```
 *
 * Adapters only map. They do not add to the system prompt, rebuild personas or add safety text. If
 * that code lived in an adapter, the product prompt would differ per provider and nobody would
 * review the difference.
 *
 * Adapters know neither React nor storage. The key is an argument on purpose, so the secret's
 * lifetime is visibly one call: the adapter keeps it nowhere.
 *
 * ## Why `start()` is split from the body: the secret's lifetime ends inside the credential callback
 *
 * A generator function does not run its body when called. A generator returned from inside a
 * credential callback would still carry the plaintext key when it was streamed after the callback
 * had closed. The contract expresses the order in the type:
 *
 * ```text
 * before start() resolves   request assembly · auth header · provider fetch · first-response validation
 * after start() resolves    response body parsing · event normalization   ← neither the secret nor the header is here
 * ```
 *
 * Returning a Promise states it: when it resolves, the provider request is already out and the
 * response headers are read, and the iterator returned only reads the open body. The response is
 * not buffered and returned whole; that would defeat streaming and extend the secret's life until
 * the response ended.
 */

/**
 * The transport function adapters use.
 *
 * Not typed as `typeof globalThis.fetch`: on React Native the default `fetch` (an XHR polyfill)
 * buffers the whole body before it resolves, so "streaming" built on it is not streaming. On device
 * the function passed in is `expo/fetch` (`native-fetch.ts`), which yields a real `ReadableStream`
 * body. Taking it as an argument makes the implementation visible at the call site, and tests can
 * swap it.
 */
export type ByoFetch = (
	url: string,
	init: {
		method: string;
		headers: Record<string, string>;
		body?: string;
		signal: AbortSignal;
	},
) => Promise<ByoResponse>;

/** Everything an adapter reads from a response. **There is no method that returns the body as text.** */
export interface ByoResponse {
	ok: boolean;
	status: number;
	headers: Headers;
	body: ReadableStream<Uint8Array> | null;
}

export interface ByoTransportInput {
	request: ChatGenerationRequest;
	/** The provider model name for this request only (the catalogue's `model`). */
	model: string;
	secret: string;
	signal: AbortSignal;
	fetch: ByoFetch;
}

/**
 * Result of a credential check. Success and failure are values, not exceptions, because the caller
 * is a screen: the connect dialog turns a failure into guidance, not into an exception boundary.
 */
export type CredentialCheck =
	| { ok: true }
	| { ok: false; error: ProviderError };

/** Cheaply checks whether one credential works with this provider. Does not start generation. */
export type ByoCredentialProbe = (input: {
	secret: string;
	signal: AbortSignal;
	fetch: ByoFetch;
}) => Promise<CredentialCheck>;

export interface ByoAdapter {
	/**
	 * Sends the request and **returns an iterator that reads the open response.**
	 *
	 * Four things must finish before this resolves: request assembly, the auth header, the provider
	 * `fetch`, and validation of the first response. That all of it happens inside the credential
	 * callback is why this is named `start`, not `stream`: a lazy name invites a lazy implementation,
	 * and here the laziness would be the secret's lifetime.
	 *
	 * The returned iterator does not know the credential: no secret, no auth header, no original
	 * `ByoTransportInput`. It keeps only the already-open body and the minimal values needed for
	 * parsing.
	 *
	 * Failure has two places (the SDK's generation stream works the same way):
	 * - **Before the stream starts**, throw `ProviderError`. No text exists yet, so the caller can
	 *   leave the turn unanswered. That failure shows up as `start()` rejecting.
	 * - **After it starts**, emit an `error` event. Text already received must be saved.
	 *
	 * Cancellation is `signal`. There is no second cancel mechanism: leaving the screen, switching
	 * rooms, signing out and switching accounts all use this same signal, and an adapter that ignored
	 * it would leak exactly those paths (and the user would pay for those tokens). The signal applies
	 * to `fetch` and to reads of the body, because the upstream socket is tied to it.
	 *
	 * **No automatic retry.** Generation bills the user's provider account. A retry after the stream
	 * has started bills twice and produces two responses in different wording. The user decides
	 * whether to retry.
	 */
	start(input: ByoTransportInput): Promise<AsyncIterable<ChatStreamEvent>>;
	/** Called before a connection is saved. */
	probe: ByoCredentialProbe;
}
