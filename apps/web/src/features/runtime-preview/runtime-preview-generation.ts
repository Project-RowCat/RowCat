import {
	reasoningCapabilityFor,
	reasoningEffortForRequest,
	resolveEffectiveGeneration,
	resolveGenerationExecution,
} from "@rowcat/chat";
import { applyPlatformSafetyPolicy } from "@rowcat/chat/guards";
import {
	CHAT_MAX_OUTPUT_TOKENS,
	type ChatGenerationMessage,
	type ChatGenerationRequest,
} from "@rowcat/contracts";
import { canUseByoProvider, canViewAdultContent } from "@rowcat/domain";
import {
	generationModelsQueryOptions,
	viewerQueryOptions,
} from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { getRowCatClient } from "#/lib/api.ts";
import { GenerationBlockedError } from "#/lib/generation/availability.ts";
import { createGenerationTransport } from "#/lib/generation/router.ts";
import { useGenerationScope } from "#/lib/local-generation/scope.ts";
import {
	useProviderCredentialScope,
	useProviderScope,
} from "#/lib/local-provider/scope.ts";
import type {
	PreviewGenerationRequest,
	PreviewGenerationResult,
} from "./protocol.ts";
import { toPreviewGenerationFailure } from "./runtime-preview-generation-failure.ts";

/**
 * The preview's generation adapter: the one place connecting the runtime's narrow generation
 * requests to RowCat's generation stack.
 * - Pipeline: resolve the desired target (global preference plus per-work override), resolve the
 *   executable target for this device's connections and entitlements, map the desired reasoning to
 *   what this model can run, then create the transport (managed via SDK, or BYO from browser to
 *   provider). Stream events are collected into one text.
 * - No second AI stack. Target resolution, managed settlement, BYO routing and transport are the
 *   same functions the conversation uses. Adding a provider here would mean the boundary is drawn
 *   wrong.
 * - The work-override layer exists only for published works. The studio preview has none, because
 *   an unpublished draft has no work id, and an override keyed by a draft id would stay on the
 *   device and never reach the published play. The reason the value fills the resolver's room slot
 *   is in lib/local-generation/hooks.ts.
 * - Output length is not read here. The cap comes from the creator's request (outputTokensFor),
 *   which is why the work override screen has no such control.
 * - Creator instructions are dependent application content. The system prompt has three layers:
 *   RowCat's prohibitions and rating guard at the head, the creator's instructions in the middle
 *   (which cannot be removed or overridden), and a rating guard at the tail. A creator writing
 *   'ignore the rules above' still meets the tail guard.
 * - Adult status is decided by whether this member may view adult content, since the unpublished
 *   studio preview has no work rating. Creator status does not loosen the gate.
 * - Streaming does not flow into the VM. The transport still streams, because stop needs it, but
 *   the adapter collects deltas into one finished text. That keeps scheduling, cancellation, state
 *   consistency and bridge traffic simple.
 */

/**
 * Converts a character limit to a token limit as a conservative upper bound. In Korean one token
 * usually carries more than one character, so using the character count as the token count never
 * cuts the model off early. The conversion is not exact, which is why the contract is named
 * `maxOutputCharacters`; the tokenizer belongs to the provider, so creator-facing vocabulary has no
 * token term.
 */
const outputTokensFor = (characters: number): number =>
	Math.min(CHAT_MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(characters)));

export type RuntimePreviewGenerationAdapter = (
	request: PreviewGenerationRequest,
	options: { signal: AbortSignal },
) => Promise<PreviewGenerationResult>;

/**
 * Which work's override to place on top of the global preference. `null` means no override layer
 * (studio preview). A value means a published work is being played, and the id is the address the
 * play request arrived at after passing the entitlement gate. This adapter reads preferences by
 * that id only and does not re-check the work's existence or entitlement; an override for a missing
 * work is an empty preference.
 */
export interface RuntimeGenerationScope {
	storyId: string;
}

export function useRuntimePreviewGeneration(
	scope: RuntimeGenerationScope | null = null,
): RuntimePreviewGenerationAdapter {
	const { store: preferences } = useGenerationScope();
	const { store: providers } = useProviderScope();
	const { store: credentials } = useProviderCredentialScope();
	const client = getRowCatClient();
	const viewer = useQuery(viewerQueryOptions(client)).data ?? null;
	/**
	 * Reasoning-step capability comes from the catalog, using the same query key as the conversation
	 * hook, so no extra request is made. A failure does not block generation;
	 * reasoningEffortForRequest has a per-path answer for when support cannot be confirmed.
	 */
	const catalog = useQuery(generationModelsQueryOptions(client));
	const storyId = scope?.storyId ?? null;

	/**
	 * Latest values live in a ref so this callback's identity stays stable across renders. A changing
	 * identity would re-wire the preview hook on every render.
	 */
	const deps = useRef({
		preferences,
		providers,
		credentials,
		client,
		viewer,
		storyId,
		models: catalog.data ?? null,
		catalogLoaded: catalog.isSuccess,
	});
	deps.current = {
		preferences,
		providers,
		credentials,
		client,
		viewer,
		storyId,
		models: catalog.data ?? null,
		catalogLoaded: catalog.isSuccess,
	};

	return useCallback(async (request, options) => {
		const {
			preferences: preferenceStore,
			providers: providerStore,
			credentials: credentialStore,
			client: api,
			viewer: current,
			storyId: overrideStoryId,
			models,
			catalogLoaded,
		} = deps.current;

		try {
			/**
			 * Desired target: this work's override sits on top of the global preference (published works
			 * only). It is read directly from storage at the moment the request starts, not from render
			 * state, so a value changed in the settings sheet cannot depend on render timing.
			 */
			const effective = resolveEffectiveGeneration({
				global: await preferenceStore?.getGlobal(),
				room:
					overrideStoryId === null
						? null
						: await preferenceStore?.getRuntime(overrideStoryId),
			});
			/** Executable target: fixes this device's connections and the account's entitlements. */
			const connected = (await providerStore?.list())?.map(
				(connection) => connection.provider,
			);
			const execution = resolveGenerationExecution({
				target: effective.target,
				connectedProviders: connected ?? [],
				byoAllowed: canUseByoProvider(current),
			});
			/** If blocked, stop here. Do not fall through to another provider. */
			if (execution.status === "blocked")
				throw new GenerationBlockedError(execution);

			const allAges = !canViewAdultContent(current);
			const messages: ChatGenerationMessage[] = request.messages.map(
				(message) => ({ role: message.role, content: message.content }),
			);
			const generationRequest: ChatGenerationRequest = {
				/**
				 * Creator runtime has no tools. The contract now has a slot for them, but this path does not
				 * open it (docs/creator-runtime/input-generation.md). Opening it here would start preview and
				 * actual playback running with different capabilities.
				 */
				tools: [],
				/**
				 * The creator's instructions sit between the two guards. This function is idempotent and is the
				 * same one the conversation and BYO paths use, so no second safety policy grows here.
				 */
				system: applyPlatformSafetyPolicy(request.instructions, {
					allAges,
					houseRules: false,
				}),
				messages,
				maxOutputTokens: outputTokensFor(request.maxOutputCharacters),
				/**
				 * Reasoning effort is the user's setting, not the creator's. The creator contract has no such
				 * axis and it is not in the request. The value here is the reasoning level this person's AI
				 * settings (global and work override) asks for, fitted to this model's capability. It uses the
				 * same function as conversation turns, so the answer when support cannot be verified is also
				 * the same: managed requests include it, BYO requests omit it.
				 */
				reasoningEffort: reasoningEffortForRequest({
					target: execution.target,
					effort: effective.reasoningEffort,
					capability: reasoningCapabilityFor({
						models: models ?? [],
						catalogLoaded,
						target: execution.target,
					}),
				}),
				context: {
					requestedMode: allAges ? "all-ages" : "adult",
					minorCharacterPresent: false,
				},
				/**
				 * Runtime generation has no continuation, and this is stated explicitly. Continuation is a
				 * conversation feature that appends a truncated assistant record. Here the input is one request
				 * made by creator code (useGeneration() takes a single result string). What is omitted and what
				 * is missing must be distinguishable in the code.
				 */
				continuation: false,
			};

			const transport = createGenerationTransport(execution.target, {
				client: api,
				credentials: credentialStore ?? null,
			});

			let text = "";
			let streamError: Error | null = null;
			for await (const event of transport.stream(generationRequest, {
				signal: options.signal,
			})) {
				if (event.type === "delta") text += event.text;
				else if (event.type === "error") streamError = new Error(event.message);
			}
			/**
			 * If the stream fails midway but text has already arrived, return that text. Creator code can
			 * decide whether to put it into the conversation; returning nothing would remove that choice.
			 */
			if (streamError !== null && text.length === 0) throw streamError;
			return { ok: true, text };
		} catch (error) {
			/**
			 * The original sentence ends here. Whatever was caught, what leaves is one reason and one
			 * sentence owned by RowCat. That judgement lives in runtime-preview-generation-failure.ts, and
			 * the router's rejection path also passes through it.
			 */
			return toPreviewGenerationFailure(error);
		}
	}, []);
}
