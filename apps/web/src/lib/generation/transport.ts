import type { ChatGenerationRequest, ChatStreamEvent } from "@rowcat/contracts";

/**
 * The port of the generation transport: the boundary that keeps the screen unaware of providers.
 *
 * The input is ChatGenerationRequest. Our context assembler builds it (buildChatGenerationRequest
 * in
 * @rowcat/chat), and managed and BYO receive the same value. Per-provider input types would produce
 * two assemblers, and the safety guard, persona, lore, and history window would drift apart between
 * paths. That drift would be invisible on screen.
 *
 * The output is ChatStreamEvent, for the same reason. The chat hook knows four event kinds (delta,
 * usage, error, done), and our contract defines that vocabulary. If an adapter passed provider
 * chunks through, the screen would learn about providers, and adding a provider would mean editing
 * the screen.
 *
 * buildChatGenerationRequest()  <- product prompt assembly; one per path
 *   | ChatGenerationRequest
 * GenerationTransport.stream()  <- the only place where the provider varies
 *   | ChatStreamEvent
 * useChatGeneration             <- knows no provider
 *
 * Adapters only map. They do not add to the system prompt, rebuild the persona, or add safety
 * sentences. If such code appeared in an adapter, the product prompt would differ per provider, and
 * no one would review that difference.
 */
export interface GenerationTransport {
	/**
	 * Sends the request and emits normalized events in order.
	 *
	 * Failure has two places, matching the SDK's generation stream:
	 * - A failure before the stream starts is thrown (ProviderError). No text has arrived yet, so
	 *   the caller can leave the turn unanswered.
	 * - A failure after the stream has started is emitted as an error event. Text has already
	 *   arrived and must be saved.
	 *
	 * Cancellation is options.signal. There is no second stop mechanism. Leaving the screen, switching
	 * rooms, logging out, and switching accounts all use the same signal. If an adapter ignored it,
	 * those paths would leak silently, and the user would be charged for the tokens.
	 */
	stream(
		request: ChatGenerationRequest,
		options: { signal: AbortSignal },
	): AsyncIterable<ChatStreamEvent>;
}

/**
 * What a BYO adapter receives: the request plus the credential at that moment.
 *
 * The key is passed as an argument on purpose. If the adapter knew the store, that module would
 * depend on Dexie and the decryption path, and tests could not run without real IndexedDB. Passing
 * the key also makes its lifetime visibly limited to one call. The adapter must not keep it
 * anywhere.
 */
export interface ByoTransportInput {
	request: ChatGenerationRequest;
	/** Provider model name (the catalog's `model`), used only for this request. */
	model: string;
	secret: string;
	signal: AbortSignal;
	/** Test seam. When unset, the runtime's fetch is used. */
	fetch?: typeof globalThis.fetch;
}

/**
 * Result of credential verification.
 *
 * Success and failure are returned as values, not thrown, because the caller is a screen. The
 * connection dialog must turn a failure into guidance rather than treat it as an exception
 * boundary.
 */
export type CredentialCheck =
	| { ok: true }
	| { ok: false; error: import("./errors.ts").ProviderError };

/**
 * Checks, cheaply, whether one credential works with this provider. It is a verification call, not
 * a generation.
 */
export type ByoCredentialProbe = (input: {
	secret: string;
	signal: AbortSignal;
	fetch?: typeof globalThis.fetch;
}) => Promise<CredentialCheck>;

/**
 * The shape the two BYO adapters fill.
 *
 * Adding a provider should mean adding one module that fills this interface. If that is not enough,
 * and adding a provider requires touching the conversation lifecycle, room settings, global
 * settings, storage, or the protocol, the boundary has been drawn wrongly.
 */
export interface ByoAdapter {
	stream(input: ByoTransportInput): AsyncIterable<ChatStreamEvent>;
	/** Called before saving, from the connection dialog. It does not start a generation request. */
	probe: ByoCredentialProbe;
}
