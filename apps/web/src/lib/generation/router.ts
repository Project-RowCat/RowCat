import type {
	ByoProvider,
	ChatGenerationPlan,
	ChatTool,
	GenerationTarget,
} from "@rowcat/chat";
import { runChatToolLoop } from "@rowcat/chat";
import { deliveredChatSystem } from "@rowcat/chat/guards";
import type {
	ChatGenerationRequest,
	ChatStreamEvent,
	RowCatManagedModel,
} from "@rowcat/contracts";
import type { RowCatClient } from "@rowcat/sdk";
import type { ProviderCredentialAccess } from "#/lib/local-provider/store.ts";
import { ProviderError } from "./errors.ts";
import type { ByoAdapter, GenerationTransport } from "./transport.ts";

/**
 * Generation router: the only place where the provider differs.
 *
 * The chat hook must not branch on provider. Once it does, adding a provider changes the
 * conversation lifecycle, and rules such as what is saved when a stream drops start to differ per
 * provider.
 *
 * Transport targets:
 * - rowcat: SDK -> /v2/chat/generate -> RowCat server -> upstream provider
 * - anthropic-byo: browser -> api.anthropic.com
 * - gemini-byo: browser -> generativelanguage.googleapis.com
 *
 * The managed model is attached here, and only for the rowcat target. The assembler's request is
 * provider-neutral and does not know the model, and BYO adapters would ignore a managed-model
 * field. The browser knows only the public identity (for example claude-sonnet-5). Mapping it to
 * the upstream slug happens on the server alone.
 *
 * The platform safety policy is attached here for BYO only, via applyPlatformSafetyPolicy. The
 * assembler must not carry the guard text, because the request body would expose the full text
 * outside the device. Managed requests get it from the server (apps/api/src/routes/chat.ts). BYO
 * has no such server, so it is applied here (deliveredChatSystem) before the request goes to the
 * provider. Every transport therefore sends a prompt that starts with the prohibition guard and
 * ends with the guard for the room's rating.
 *
 * The product prompt is still built only in buildChatGenerationRequest. Adapters map it and add
 * nothing. This file adds only the platform policy, through the same function the server uses.
 *
 * The enforcement strength differs. The managed path has a server-side verdict that does not trust
 * the client. BYO relies entirely on code running in this browser. See
 * docs/settings/ARCHITECTURE.md for the exact difference. Doing more on BYO would mean sending the
 * prompt to our server, which breaks the definition of this feature.
 */

export const PROVIDER_CONNECT_ORIGINS: readonly string[] = [
	"https://api.anthropic.com",
	"https://generativelanguage.googleapis.com",
];

/**
 * Adapters are loaded on demand.
 *
 * The goal is that users who only use managed models do not download the bytes of both adapters on
 * the first chat screen. Each adapter has its own parser and mapping table and is not small. Most
 * users never execute this code.
 *
 * Modules are not split further. The unit is one provider; splitting below that only adds requests.
 */
const ADAPTERS: Record<ByoProvider, () => Promise<ByoAdapter>> = {
	"anthropic-byo": async () =>
		(await import("./anthropic.ts")).anthropicAdapter,
	"gemini-byo": async () => (await import("./gemini.ts")).geminiAdapter,
};

export interface GenerationRouterDeps {
	/** Managed transport. This one client is the only path to the RowCat server. */
	client: RowCatClient;
	/**
	 * BYO credential accessor. null means BYO targets cannot run, because the scope is not open yet or
	 * the user is a guest.
	 */
	credentials: ProviderCredentialAccess | null;
	/** Test seam for swapping adapters. When unset, the dynamic import above is used. */
	/** Test seam for swapping adapters. When unset, the dynamic import above is used. */
	loadAdapter?: (provider: ByoProvider) => Promise<ByoAdapter>;
	/**
	 * Tools for this conversation. Without them this axis behaves as if it did not exist.
	 *
	 * Tools are chosen at the transport point for the same reason managed identity is attached here:
	 * every round trip is a new request, and each request is one attempt. A loop in the hook would put
	 * per-provider branching there. A loop in each adapter would produce four copies of the same loop.
	 */
	toolAccess?: GenerationToolAccess;
}

/**
 * Builds the transport for one target.
 *
 * Availability is not decided here. The pure function resolveGenerationExecution already decided
 * it, and callers pass only executable targets. Judging in two places would let one of them loosen
 * someday and create silent substitution.
 *
 * A vanished credential is still checked here. Another tab can disconnect in the window between the
 * decision and execution. In that case the correct result is a failure, not a move to another
 * provider.
 */
export function createGenerationTransport(
	target: GenerationTarget,
	deps: GenerationRouterDeps,
): GenerationTransport {
	const transport =
		target.provider === "rowcat"
			? rowcatTransport(deps.client, target.model)
			: byoTransport(target.provider, target.model, deps);
	return withToolLoop(transport, deps.toolAccess);
}

/**
 * Decides where an assembled plan is sent. The generation hook calls only this function.
 *
 * - assembled: device-assembled request -> the target's transport (managed or BYO, with tool
 *   loop)
 * - story: server-assembled request -> protected path (client.chat.streamStory). The server runs
 *   the tool loop.
 *
 * The split lives here, not in the hook, because the decision belongs to the transport. An `if
 * (protected)` in the hook would be duplicated in web and mobile. If someone wrapped the protected
 * path with a tool loop, tools would be declared that search lore the device does not have.
 *
 * The protected room is already blocked for BYO at execution decision time (managed_only). The
 * throw here is a last safety net for callers that skip that decision. It never falls back to
 * another provider.
 */
export function streamChatGenerationPlan(
	plan: ChatGenerationPlan,
	target: GenerationTarget,
	deps: GenerationRouterDeps,
	options: { signal: AbortSignal },
): AsyncIterable<ChatStreamEvent> {
	if (plan.kind === "assembled")
		return createGenerationTransport(target, deps).stream(
			plan.request,
			options,
		);
	if (target.provider !== "rowcat")
		throw new Error(
			"A protected-prompt story is generated only by RowCat-provided models.",
		);
	return deps.client.chat.streamStory(
		plan.storyId,
		{ ...plan.request, model: target.model },
		{ signal: options.signal },
	);
}

/**
 * Everything the router needs to know about tools.
 *
 * The handlers live here because the things tools read (lore, memory, characters) are on the
 * device. The server does not know the room, so execution has to happen on the device. Managed and
 * BYO therefore share the same loop.
 *
 * Judgment and assembly are not in this object. The tool layer in @rowcat/chat does that.
 */
export interface GenerationToolAccess {
	/**
	 * Registered tools. An empty array makes the transport behave exactly as it did before this axis
	 * existed.
	 */
	tools: readonly ChatTool[];
	/**
	 * Whether this generation is still inside its own conversation. Asked again between every round
	 * trip.
	 *
	 * The abort signal does not substitute for this. The signal cancels a request already in flight.
	 * This question decides whether the next request is sent at all. If round trips continue after
	 * leaving the room, managed usage is billed.
	 */
	isValid(): boolean;
}

/**
 * A transport with tools. It changes nothing except running round trips.
 *
 * With an empty registration it returns the original transport. It is not wrapped with an internal
 * branch because that is the compatibility guarantee of this axis: a conversation without tools
 * never runs this code.
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
				 * The transport is called anew on every round trip. Managed transport creates the billing
				 * identity inside this call, so this one line makes one round trip exactly one attempt.
				 * Reservation and settlement run per attempt, and server accounting does not change at all.
				 */
				stream: (next) => transport.stream(next, options),
				tools: access.tools,
				isValid: () => access.isValid(),
				signal: options.signal,
			}),
	};
}

/**
 * Managed transport: sends the provider-neutral request to the SDK with the one managed model
 * chosen.
 *
 * The model is taken as an argument. It is not read from the request object because it is not there
 * (the assembler knows neither the provider nor the model). It is not read from storage either,
 * because this turn's target is already fixed: the generation hook resolves it once at start and
 * passes it to this router. Reading it again here would send the next frame of a user who changed
 * settings mid-response with a different model.
 */
function rowcatTransport(
	client: RowCatClient,
	model: RowCatManagedModel,
): GenerationTransport {
	return {
		stream: (request, options) =>
			client.chat.stream({ ...request, model }, { signal: options.signal }),
	};
}

function byoTransport(
	provider: ByoProvider,
	model: string,
	deps: GenerationRouterDeps,
): GenerationTransport {
	const load = deps.loadAdapter
		? () => deps.loadAdapter?.(provider) ?? ADAPTERS[provider]()
		: ADAPTERS[provider];
	return {
		stream: (request, options) =>
			streamByo({ provider, model, request, options, deps, load }),
	};
}

async function* streamByo(input: {
	provider: ByoProvider;
	model: string;
	request: ChatGenerationRequest;
	options: { signal: AbortSignal };
	deps: GenerationRouterDeps;
	load: () => Promise<ByoAdapter>;
}): AsyncGenerator<ChatStreamEvent> {
	const { credentials } = input.deps;
	if (!credentials) throw new ProviderError("invalid_credential");

	const adapter = await input.load();

	/**
	 * Reads the credential here, for this request only. It is not kept in module-global state. If
	 * another tab replaced the key, this request goes out with the new key. If the connection was
	 * removed, the value is null and the request does not start at all.
	 *
	 * The stream is not fully consumed inside the callback. That would collect the whole response in
	 * memory and defeat streaming. Instead a generator is created and returned outward. The plaintext
	 * key lives only until that generator is created. Once the adapter has sent the request, nothing
	 * needs the key.
	 */
	const events = await credentials.withCredential(
		input.provider,
		async (secret) =>
			adapter.stream({
				request: withPlatformPolicy(input.request),
				model: input.model,
				secret,
				signal: input.options.signal,
			}),
	);

	/**
	 * The connection disappeared between the decision and execution. Do not fall back to another
	 * provider. That substitution is the most dangerous thing this feature could do.
	 */
	if (!events) throw new ProviderError("invalid_credential");

	yield* events;
}

/**
 * The request with the platform policy applied.
 *
 * The safety level is already carried by the request (context.requestedMode). That value is the
 * client's judgment from the room rating and membership (resolveAllAges). On the managed path the
 * server re-judges it from the session. BYO has no such re-judgment, so this browser's judgment is
 * final.
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
 * Asks the provider whether a credential is valid. The connection dialog calls this before saving.
 *
 * It lives here, not in the store, because verification is a network operation. If the store knew
 * this, that module would depend on provider endpoints and error vocabulary and stop being a pure
 * storage port.
 */
export async function probeProviderCredential(
	provider: ByoProvider,
	secret: string,
	options: {
		signal: AbortSignal;
		loadAdapter?: (provider: ByoProvider) => Promise<ByoAdapter>;
	},
) {
	const adapter = await (options.loadAdapter
		? options.loadAdapter(provider)
		: ADAPTERS[provider]());
	return adapter.probe({ secret, signal: options.signal });
}
