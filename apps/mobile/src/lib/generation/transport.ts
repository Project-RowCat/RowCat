import type {
	ByoProvider,
	ChatGenerationPlan,
	ChatTool,
	GenerationTarget,
} from "@rowcat/chat";
import { runChatToolLoop } from "@rowcat/chat";
import { deliveredChatSystem } from "@rowcat/chat/guards";
import type { ChatGenerationRequest, ChatStreamEvent } from "@rowcat/contracts";
import type { RowCatClient } from "@rowcat/sdk";
import type { ProviderCredentialAccess } from "../local-provider/store.ts";
import { anthropicAdapter } from "./anthropic.ts";
import type { ByoAdapter, ByoFetch } from "./byo.ts";
import { ProviderError } from "./errors.ts";
import { geminiAdapter } from "./gemini.ts";

/**
 * Generation transport: the one place where providers diverge (mobile).
 *
 * Same place and same rule as `lib/generation/router.ts` on web: the conversation lifecycle has no
 * `if (provider === …)`. A provider branch in the hook would turn adding a provider into a
 * lifecycle change, and rules such as "what is saved when the stream breaks" would start to differ
 * per provider.
 *
 * ```text
 * rowcat        → SDK → /v2/chat/generate → RowCat server → upstream → **billed by RowCat**
 * anthropic-byo → device → api.anthropic.com                          → not billed by RowCat
 * gemini-byo    → device → generativelanguage.googleapis.com          → not billed by RowCat
 * ```
 *
 * - Managed model identity is attached here, not in the request. The assembler is
 *   provider-neutral and knows no model, and a model field on the shared request would be one BYO
 *   ignores.
 * - Safety guards are attached here only for BYO. The guard text is applied by
 *   `applyPlatformSafetyPolicy`, and the assembler does not include it: in the request body it
 *   would be readable off-device. The managed path gets it from the server
 *   (`apps/api/src/routes/chat.ts`). BYO has no server, so this is the last point before the
 *   request reaches the provider (`deliveredChatSystem`). Whichever transport is used, the model
 *   sees the absolute guard first and the rating's tail guard last.
 * - Not attaching guards on managed requests is deliberate. The server does not wrap an
 *   already-wrapped body, so the result would be the same, but the full guard text would ride in
 *   the request body again.
 * - Product prompt content is still built only in `buildChatGenerationRequest`. Adapters map the
 *   result and do not reassemble it.
 * - Adapters are imported statically. Web splits them with dynamic imports so managed-only users
 *   skip the BYO bytes. This app ships its bundle whole, so splitting would not reduce first-screen
 *   bytes. `loadAdapter` is the test seam.
 */

export interface GenerationTransport {
	/**
	 * Sends the request and yields normalized events in order.
	 *
	 * Failures have two places, matching the SDK's generation stream:
	 * - A failure **before the stream starts** is thrown. No text exists yet, so the caller can
	 *   leave the turn unanswered.
	 * - A failure **after it starts** is yielded as an `error` event. Text already received must
	 *   still be saved.
	 */
	stream(
		request: ChatGenerationRequest,
		options: { signal: AbortSignal },
	): AsyncIterable<ChatStreamEvent>;
}

/** Provider → adapter. Adding a provider should be one line in this table. */
const ADAPTERS: Record<ByoProvider, ByoAdapter> = {
	"anthropic-byo": anthropicAdapter,
	"gemini-byo": geminiAdapter,
};

export interface GenerationTransportDeps {
	/** Managed transport. This client is the only route to the RowCat server. */
	client: RowCatClient;
	/**
	 * BYO credential accessor. **If `null`, a BYO target cannot run**, either because the scope is not
	 * open yet or the user is a guest. It does **not** fall back to managed.
	 */
	credentials?: ProviderCredentialAccess | null;
	/**
	 * Transport function for BYO requests.
	 *
	 * Injected because this file must also load under Node. Importing the device wiring (`expo/fetch`)
	 * here would make every test that loads this module require a native module, and the only option
	 * left would be mocking it. Streaming that passes under a mock can break on a device for the first
	 * time (see the header of `native-fetch.ts`).
	 */
	fetch?: ByoFetch | undefined;
	/** Test seam for swapping adapters. When unset, the table above is used. */
	loadAdapter?: ((provider: ByoProvider) => ByoAdapter) | undefined;
	/**
	 * This conversation's **tools**. Without them, this axis does not exist.
	 *
	 * It sits here, where the transport is chosen, for the same reason managed identity is attached
	 * here: every round trip sends a new request, and each request is one attempt. A loop in the hook
	 * would put per-provider branching there, and a loop in each adapter would make four copies of it.
	 */
	toolAccess?: GenerationToolAccess;
}

/**
 * This device has no transport for that target.
 *
 * This error exposes a caller that skipped the decision, not a failure the user sees. The screen
 * message comes from the blocked reason (`GenerationExecution`), and that decision was already
 * settled before the transport was created.
 */
export class GenerationTransportUnavailableError extends Error {
	readonly provider: GenerationTarget["provider"];

	constructor(provider: GenerationTarget["provider"]) {
		super("This generation target can't run on this device.");
		this.name = "GenerationTransportUnavailableError";
		this.provider = provider;
	}
}

/**
 * Decides **where** a plan is sent. Generation turns call only this function (same name and
 * branches as web, for the same reason).
 *
 * ```text
 * assembled   device-assembled request → target transport (managed or BYO, including the tool loop)
 * story       server-assembled request → protected-story path (`client.chat.streamStory`). The server runs the tool loop
 * ```
 *
 * Protected-story rooms are already blocked for BYO at execution time (`managed_only`). The throw
 * here is a last net for a caller that skipped that check. It does not fall through to another
 * provider.
 */
export function streamChatGenerationPlan(
	plan: ChatGenerationPlan,
	target: GenerationTarget,
	deps: GenerationTransportDeps,
	options: { signal: AbortSignal },
): AsyncIterable<ChatStreamEvent> {
	if (plan.kind === "assembled")
		return createGenerationTransport(target, deps).stream(
			plan.request,
			options,
		);
	if (target.provider !== "rowcat")
		throw new Error(
			"protected stories generate only with RowCat-provided models.",
		);
	return deps.client.chat.streamStory(
		plan.storyId,
		{ ...plan.request, model: target.model },
		{ signal: options.signal },
	);
}

/**
 * Builds a transport for one target.
 *
 * **Availability is not checked here.** The pure function already decided it
 * (`resolveGenerationExecution`), and callers pass in only executable targets. Checking in two
 * places would create a silent substitution the day one check loosens: the billing target and the
 * server that sees the prompt would change together, while the user sees nothing change.
 *
 * A credential that disappears is still blocked here. The user can disconnect a provider in
 * settings between the decision and execution, and the right outcome then is a failure, not a
 * switch to another provider.
 */
export function createGenerationTransport(
	target: GenerationTarget,
	deps: GenerationTransportDeps,
): GenerationTransport {
	const transport =
		target.provider === "rowcat"
			? rowcatTransport(deps.client, target.model)
			: byoTransport(target.provider, target.model, deps);
	return withToolLoop(transport, deps.toolAccess);
}

/**
 * Everything the router needs to know about tools.
 *
 * Handlers live here because the data tools read (lore, memory, characters) is **on the device**.
 * The server does not know the room, so execution must happen on the device, and managed and BYO
 * share the same loop. Judgement and assembly are not in this object; the tool layer of
 * `@rowcat/chat` does them.
 */
export interface GenerationToolAccess {
	/** Registered tools. **An empty array makes the transport behave exactly as it did before this axis existed.** */
	tools: readonly ChatTool[];
	/**
	 * Whether this generation is still inside its conversation. Asked **before every round trip**.
	 *
	 * This is not replaced by the abort signal. The signal cancels a request already in flight; this
	 * question decides whether to send the next one. If round trips continued after the user left the
	 * room, managed generation would be billed for them.
	 */
	isValid(): boolean;
}

/**
 * A transport with tools. **It changes nothing except running the round-trip loop.**
 *
 * With no tools registered, it returns the original transport unchanged. It wraps instead of
 * branching inside because this axis must stay compatible: a conversation without tools never runs
 * this code.
 */
function withToolLoop(
	transport: GenerationTransport,
	access: GenerationToolAccess | undefined,
): GenerationTransport {
	if (!access || access.tools.length === 0) return transport;
	return {
		stream: (request, options) =>
			runChatToolLoop(request, {
				/**
				 * The transport is **called anew for each round trip.** Managed transport builds the billing
				 * identity inside this call, so that one line makes each round trip one attempt. Reservation
				 * and settlement run per attempt, and the server's accounting does not change at all.
				 */
				stream: (next) => transport.stream(next, options),
				tools: access.tools,
				isValid: () => access.isValid(),
				signal: options.signal,
			}),
	};
}

/**
 * Managed transport: sends the provider-neutral request with **the chosen managed model** attached,
 * through the SDK.
 *
 * The model comes in as an argument, and that is all this function does with it. It is not read
 * from the request object because the value is not there (the assembler knows neither provider nor
 * model), and it is not read from storage because this turn's target is already fixed.
 *
 * Mapping to an upstream slug does not happen here. The device knows only the public identity
 * (`claude-sonnet-5`); only the server knows whether it goes to `anthropic/claude-sonnet-5`.
 *
 * **It does not touch the credential port.** That no secret-opening code runs in this branch is the
 * structural form of "managed requests do not need the user's API key". Router tests pass in a port
 * and check by value that it is never used.
 */
function rowcatTransport(
	client: RowCatClient,
	model: Extract<GenerationTarget, { provider: "rowcat" }>["model"],
): GenerationTransport {
	return {
		stream: (request, options) =>
			client.chat.stream(
				/**
				 * Guards are **not applied here.** On the managed path the server applies them; if the device
				 * sent them, the full guard text would ride in the request body again (see the
				 * `applyPlatformSafetyPolicy` header). BYO has no server, so only that branch has this device
				 * apply them.
				 */
				{ ...request, model },
				{ signal: options.signal },
			),
	};
}

function byoTransport(
	provider: ByoProvider,
	model: string,
	deps: GenerationTransportDeps,
): GenerationTransport {
	return {
		stream: (request, options) =>
			streamByo({ provider, model, request, options, deps }),
	};
}

async function* streamByo(input: {
	provider: ByoProvider;
	model: string;
	request: ChatGenerationRequest;
	options: { signal: AbortSignal };
	deps: GenerationTransportDeps;
}): AsyncGenerator<ChatStreamEvent> {
	const { credentials, fetch } = input.deps;
	/**
	 * No scope, or the transport is not wired. **Does not fall back to managed** — that substitution
	 * is the one thing this feature must never do.
	 */
	if (!credentials || !fetch) throw new ProviderError("invalid_credential");

	const adapter =
		input.deps.loadAdapter?.(input.provider) ?? ADAPTERS[input.provider];

	/**
	 * Reads the credential **here, for this request.** It is not stored in a module global, so if the
	 * user replaced the key, this request goes out with the new key, and if the user disconnected, the
	 * read returns `null` and nothing starts.
	 *
	 * ## The secret's lifetime ends inside this callback
	 *
	 * The promise is that `start()` is an **`async function`, not an `async function*`** (see the
	 * header of `byo.ts`). When that promise resolves, everything below has already happened:
	 *
	 * ```text
	 * inside the callback   build request → auth header → provider fetch → validate the first Response
	 * after the callback    only reading the already-open response body and converting it to events remains
	 * ```
	 *
	 * Opening happens inside the callback. Do not turn the adapter into an async generator: its call
	 * would then only create the generator object, and the first byte would go out after the callback
	 * closed, with the plaintext key still alive in the generator's closure. The stream is also not
	 * consumed to completion inside the callback, because that would collect the whole response in
	 * memory and keep the secret alive until the response ends. Opening belongs to the callback;
	 * reading does not.
	 */
	const events = await credentials.withCredential(
		input.provider,
		async (secret) =>
			adapter.start({
				request: withPlatformPolicy(input.request),
				model: input.model,
				secret,
				signal: input.options.signal,
				fetch,
			}),
	);

	/**
	 * The connection disappeared between the decision and execution. **It does not switch to another
	 * provider.**
	 *
	 * If we are here, no provider request was sent: the callback never called the adapter.
	 */
	if (!events) throw new ProviderError("invalid_credential");

	yield* events;
}

/**
 * Request with platform policy applied. **Only the BYO branch calls this.**
 *
 * The rating is already on the request (`context.requestedMode`). The client computed it from the
 * room's rating and the member's entitlement (`resolveAllAges`). On the managed path the server
 * recomputes it from the session and attaches the guards. **BYO has no server**, so this device's
 * judgement and this one line are the last point of that policy.
 */
function withPlatformPolicy(
	request: ChatGenerationRequest,
): ChatGenerationRequest {
	return {
		...request,
		system: deliveredChatSystem(request),
	};
}

/**
 * Asks the provider whether one credential is valid. The connect dialog calls this **before
 * saving**.
 *
 * It lives here rather than in the store because validation is a network operation. If the store
 * knew about it, that module would need the provider endpoints and error vocabulary, and would stop
 * being a pure storage port.
 */
export function probeProviderCredential(
	provider: ByoProvider,
	secret: string,
	options: {
		signal: AbortSignal;
		fetch: ByoFetch;
		loadAdapter?: ((provider: ByoProvider) => ByoAdapter) | undefined;
	},
) {
	const adapter = options.loadAdapter?.(provider) ?? ADAPTERS[provider];
	return adapter.probe({
		secret,
		signal: options.signal,
		fetch: options.fetch,
	});
}
