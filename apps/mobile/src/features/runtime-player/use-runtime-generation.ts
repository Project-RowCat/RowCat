import {
	reasoningCapabilityFor,
	reasoningEffortForRequest,
	resolveAllAges,
	resolveEffectiveGeneration,
	resolveGenerationExecution,
} from "@rowcat/chat";
import { runtimeGenerationSafety } from "@rowcat/chat/guards";
import {
	CHAT_MAX_OUTPUT_TOKENS,
	type ChatGenerationRequest,
} from "@rowcat/contracts";
import { canUseByoProvider, canViewAdultContent } from "@rowcat/domain";
import {
	generationModelsQueryOptions,
	viewerQueryOptions,
} from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { getRowCatClient } from "../../lib/api.ts";
import { nativeStreamingFetch } from "../../lib/generation/native-fetch.ts";
import { createGenerationTransport } from "../../lib/generation/transport.ts";
import {
	useGenerationScope,
	useProviderCredentialScope,
	useProviderScope,
} from "../../lib/local-data/scope.tsx";
import type {
	NativeRuntimeGenerationRequest,
	NativeRuntimeGenerationResult,
} from "../../lib/runtime-native/protocol.ts";
import { ChatGenerationBlockedError } from "../chat/generation/error.ts";
import { toNativeGenerationFailure } from "./runtime-generation-failure.ts";

/**
 * The **trusted generation adapter** for playback: the one place that joins the runtime's narrow
 * request to this app's generation stack.
 *
 * ```text
 * WebView's runtime-host-call
 *       ↓
 * resolveEffectiveGeneration   device preference → desired target (model, reasoning, length)
 * resolveGenerationExecution   this device's connections and account eligibility → runnable target
 * createGenerationTransport    managed (SDK) ↔ BYO (device → provider)
 *       ↓  collects the ChatStreamEvent stream to the end
 * { ok: true, text }
 * ```
 *
 * ## Do not build a second AI stack
 *
 * Target resolution, managed settlement, BYO routing and transport are all **the very functions
 * conversation uses**. The web's preview and playback adapters have the same shape. What differs is
 * the hook that reads the scope, and the `fetch` passed when building the transport (this app uses
 * the native streaming fetch).
 *
 * ## The creator's instructions are **subordinate application content**
 *
 * ```text
 * [RowCat] absolute prohibitions · rating guard   the head of applyPlatformSafetyPolicy
 *          · minor guard (adult, when the instructions describe a minor)
 * [creator] instructions                           this value; it can be neither removed nor
 * overridden
 * [RowCat] rating tail guard                       the last instruction just before generation
 * ```
 *
 * ## The provider's raw text ends here
 *
 * Whatever was caught, what goes out is one reason and one sentence that RowCat owns
 * (`runtime-generation-failure.ts`). The judgment is not written inline here, because two places
 * call it: this `catch`, and the place where the session folds the adapter's rejection.
 */

/** Character cap → token cap. Treated 1:1 as a conservative bound (Korean is denser than that). */
const outputTokensFor = (characters: number): number =>
	Math.min(CHAT_MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(characters)));

export type RuntimeGenerationAdapter = (
	request: NativeRuntimeGenerationRequest,
	options: { signal: AbortSignal },
) => Promise<NativeRuntimeGenerationResult>;

/**
 * Which work's override is laid over the global settings. Same shape as the web's
 * `RuntimeGenerationScope`.
 *
 * This app has no per-work settings screen yet, but the adapter reads that value. The store port is
 * one for both apps (`GenerationPreferenceStore.getRuntime`). If it were not read here, a value
 * saved for the same member on the same device would mean something only on the web, and the day
 * the screen arrives that gap would force changes in this file too.
 */
export interface RuntimeGenerationScope {
	storyId: string | null;
	/**
	 * The work's rating, from the playback response. Required so no caller can forget it: all-ages is
	 * decided by this **and** the viewer's entitlement (`resolveAllAges`, as conversations do). Deciding
	 * from the viewer alone let an all-ages work's generations run under the adult guards for adult
	 * viewers, walking around the adult publishing gate.
	 */
	adult: boolean;
}

export function useRuntimeGeneration(
	scope: RuntimeGenerationScope,
): RuntimeGenerationAdapter {
	const { store: preferences } = useGenerationScope();
	const { store: providers } = useProviderScope();
	const { store: credentials } = useProviderCredentialScope();
	const client = getRowCatClient();
	const viewer = useQuery(viewerQueryOptions(client)).data ?? null;
	/** Reasoning capability comes from the catalog: the same query key as the conversation hook. */
	const catalog = useQuery(generationModelsQueryOptions(client));
	const storyId = scope.storyId;
	const adult = scope.adult;

	/**
	 * Keeps the latest values in a ref so that a new function is not created on each render. If this
	 * callback's identity changed, the playback hook's wiring would be reattached every render, and
	 * the running session would be rebuilt each time.
	 */
	const deps = useRef({
		preferences,
		providers,
		credentials,
		client,
		viewer,
		storyId,
		adult,
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
		adult,
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
			adult: workIsAdult,
			models,
			catalogLoaded,
		} = deps.current;

		try {
			/**
			 * ① The desired target: **this work's override** sits above the global preference. There is no
			 * room (a playthrough is not a room). It reads directly from the store at the moment a request
			 * starts.
			 */
			const effective = resolveEffectiveGeneration({
				global: await preferenceStore?.getGlobal(),
				room:
					overrideStoryId === null
						? null
						: await preferenceStore?.getRuntime(overrideStoryId),
			});
			/** ② The runnable target: freezes this device's connections and the account's eligibility. */
			const connected = (await providerStore?.list())?.map(
				(connection) => connection.provider,
			);
			const execution = resolveGenerationExecution({
				target: effective.target,
				connectedProviders: connected ?? [],
				byoAllowed: canUseByoProvider(current),
			});
			/** If blocked, it ends here: **it does not go to another provider.** */
			if (execution.status === "blocked")
				throw new ChatGenerationBlockedError(execution);

			const allAges = resolveAllAges(
				{ adult: workIsAdult },
				{ adultAllowed: canViewAdultContent(current) },
			);
			const safety = runtimeGenerationSafety(request.instructions, allAges);
			const generationRequest: ChatGenerationRequest = {
				/**
				 * **The creator runtime has no tools.** Even though the contract has a slot for them, this path
				 * does not open it. What `useGeneration()` exchanges is one string
				 * (`docs/creator-runtime/input-generation.md`). Opening tools would let creator code call,
				 * under names we have not reviewed, into the device's data.
				 */
				tools: [],
				/**
				 * The creator's instructions between the guards, plus the minor guard when they describe a
				 * minor — one judgment that also fills `context` (`runtimeGenerationSafety` in `@rowcat/chat/guards`).
				 */
				system: safety.system,
				messages: request.messages.map((message) => ({
					role: message.role,
					content: message.content,
				})),
				maxOutputTokens: outputTokensFor(request.maxOutputCharacters),
				/**
				 * Runtime generation has no continuation. **It is explicitly false.**
				 *
				 * Continuation is a conversation axis that appends a cut assistant record. What goes through
				 * here is one request made by creator code (`useGeneration()` receives one result string). What
				 * was omitted and what was deliberately left out must be distinguishable in the code.
				 */
				continuation: false,
				/**
				 * Reasoning effort is **the user's axis**, not the creator's. The creator contract still lacks
				 * it, and the value sent here is this person's AI setting fitted to what this model can do. It
				 * uses the same function as the conversation turn, so the answer when the capability cannot be
				 * confirmed is the same too.
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
				context: safety.context,
			};

			const transport = createGenerationTransport(execution.target, {
				client: api,
				credentials: credentialStore ?? null,
				fetch: nativeStreamingFetch,
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
			 * If the stream failed partway but some text remains, **that text is returned.** The creator
			 * code can decide whether to put it in state; if nothing is returned, that choice disappears.
			 */
			if (streamError !== null && text.length === 0) throw streamError;
			return { ok: true, text };
		} catch (error) {
			return toNativeGenerationFailure(error);
		}
	}, []);
}
