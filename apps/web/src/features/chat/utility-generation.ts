import {
	resolveEffectiveGeneration,
	resolveGenerationExecution,
	resolveUtilityTarget,
} from "@rowcat/chat";
import type { ChatGenerationRequest } from "@rowcat/contracts/chat";
import { canUseByoProvider } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { ChatStreamFailure } from "#/features/conversation/generation-error.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { GenerationBlockedError } from "#/lib/generation/availability.ts";
import { createGenerationTransport } from "#/lib/generation/router.ts";
import { useGenerationScope } from "#/lib/local-generation/scope.ts";
import {
	useProviderCredentialScope,
	useProviderScope,
} from "#/lib/local-provider/scope.ts";

/**
 * One pipe for a single non-conversation auxiliary request. Automatic maintenance and reply
 * suggestions share it.
 *
 * Why one place: this is the privacy P0. Both features read the room's conversation to produce
 * something, and both must go to that room's provider when it is BYO. If each held its own wiring,
 * one side might someday pass an empty connection list or skip target resolution, and then:
 *
 *     response generation  Anthropic direct   (the user's choice)
 *     auxiliary request    RowCat managed    (nobody chose this)
 *
 * The server would then receive that room's conversation, and billing would change too, with
 * nothing visible to the user. With no connection, the request is blocked, not silently moved to
 * managed.
 *
 * That this is one file is enforced statically: the places that may touch the plaintext credential
 * port are an enumerated list (lib/local-provider/no-credential-access.test.ts). Adding auxiliary
 * requests keeps that list at this one line.
 *
 * Not here: prompts (built by pure assemblers in @rowcat/chat); screen state and wording (callers
 * decide whether to show progress or say a failure: maintenance says nothing, suggestions do
 * speak); streaming (both requests resolve in one go, so deltas are not exposed; exposing them
 * would make every caller re-collect them).
 *
 * Plaintext is not visible here either. The port passes through as-is, and decryption happens only
 * when the router calls the adapter. There is no withCredential or secret in this file.
 */

/**
 * Sends one auxiliary request and reads the full body. A blocked target throws
 * GenerationBlockedError rather than an anonymous error, because there are two consumers and one
 * shows the error on screen. Maintenance swallows errors anyway, so the more detailed error costs
 * it nothing; suggestions have a route to `Go to AI settings` under that name.
 */
export type RequestUtilityGeneration = (
	roomId: string,
	request: ChatGenerationRequest,
	signal: AbortSignal,
) => Promise<string>;

export function useUtilityGeneration(): RequestUtilityGeneration {
	const { store: preferences } = useGenerationScope();
	/**
	 * Reads the same store as conversation turns, so the two paths cannot return different answers.
	 */
	const { store: providers } = useProviderScope();
	/** Credentials are not opened here either; the port is passed straight into the transport. */
	const { store: credentials } = useProviderCredentialScope();
	const client = getRowCatClient();
	const viewer = useQuery(viewerQueryOptions(client)).data ?? null;

	/**
	 * Dependencies are frozen in a ref so the returned function keeps its identity across queries.
	 * This function flows into the conversation session adapter (createChatConversation). If its
	 * identity shifts, the session object is rebuilt each render and the shared hook's effects re-run
	 * on every render.
	 */
	const depsRef = useRef({
		preferences,
		providers,
		credentials,
		client,
		viewer,
	});
	depsRef.current = { preferences, providers, credentials, client, viewer };

	return useCallback(async (roomId, request, signal) => {
		const deps = depsRef.current;
		/**
		 * Target resolution goes through the same function as conversation turns. If only auxiliary
		 * requests used different rules, on a device without a BYO connection this one request would
		 * silently go to managed (the P0 in the header).
		 */
		const effective = resolveEffectiveGeneration({
			global: await deps.preferences?.getGlobal(),
			room: await deps.preferences?.getRoom(roomId),
		});
		const execution = resolveGenerationExecution({
			target: resolveUtilityTarget(effective.target),
			connectedProviders:
				(await deps.providers?.list())?.map(
					(connection) => connection.provider,
				) ?? [],
			byoAllowed: canUseByoProvider(deps.viewer),
		});
		if (execution.status === "blocked")
			throw new GenerationBlockedError(execution);

		const transport = createGenerationTransport(execution.target, {
			client: deps.client,
			credentials: deps.credentials ?? null,
		});
		let text = "";
		for await (const event of transport.stream(request, { signal })) {
			if (event.type === "delta") text += event.text;
			/**
			 * Carries the failure code through the frame, same as conversation turns. Folding it into new
			 * Error(message) would turn named failures (managed model unavailable, rate limited) into a
			 * generic `Try again` that matches none of them.
			 */ else if (event.type === "error")
				throw new ChatStreamFailure(event.code, event.message);
		}
		return text;
	}, []);
}
