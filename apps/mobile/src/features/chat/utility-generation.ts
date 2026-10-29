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
import { getRowCatClient } from "../../lib/api.ts";
import { nativeStreamingFetch } from "../../lib/generation/native-fetch.ts";
import { createGenerationTransport } from "../../lib/generation/transport.ts";
import {
	useGenerationScope,
	useProviderCredentialScope,
	useProviderScope,
} from "../../lib/local-data/scope.tsx";
import {
	ChatGenerationBlockedError,
	ChatStreamFailure,
} from "./generation/error.ts";

/**
 * Channel for one auxiliary (non-conversation) request, shared by auto-maintenance and reply
 * suggestions. Web's same-named file does the same job; the differences are the scope hooks, the
 * transport builder (this app has no BYO adapter and needs the native streaming `fetch`), and
 * import paths.
 *
 * Both features must reach the same provider as the room's conversation. With separate wiring one
 * of them would eventually skip target resolution and send a BYO room's conversation to RowCat
 * managed without anyone choosing it. With no connection the request is blocked, never silently
 * routed to managed.
 *
 * Plaintext never appears here: `credentials` is passed through and decrypted only when the
 * transport calls the adapter. There is no render-state subscription either, since a just-dropped
 * connection could still be expected by a request started in that window.
 */

/**
 * Sends one auxiliary request and receives the whole body. A blocked target throws
 * `ChatGenerationBlockedError` rather than a generic error, because suggestions use the error to
 * show the path to `Settings → AI`.
 */
export type RequestUtilityGeneration = (
	roomId: string,
	request: ChatGenerationRequest,
	signal: AbortSignal,
) => Promise<string>;

export function useUtilityGeneration(): RequestUtilityGeneration {
	const { store: preferences } = useGenerationScope();
	/* Same stores as conversation turns, so the two paths cannot answer differently. */
	const { store: providers } = useProviderScope();
	const { store: credentials } = useProviderCredentialScope();
	const client = getRowCatClient();
	const viewer = useQuery(viewerQueryOptions(client)).data ?? null;

	/* A ref keeps the returned function's identity stable across renders. */
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
		/* Target resolution uses the same function as conversation turns; separate rules would route BYO rooms to managed. */
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
			throw new ChatGenerationBlockedError(execution);

		const transport = createGenerationTransport(execution.target, {
			client: deps.client,
			credentials: deps.credentials,
			fetch: nativeStreamingFetch,
		});
		let text = "";
		for await (const event of transport.stream(request, { signal })) {
			if (event.type === "delta") text += event.text;
			/* Keep the failure code, as conversation turns do; folding it into a plain Error loses named failures like managed model unavailable or rate limit. */ else if (
				event.type === "error"
			)
				throw new ChatStreamFailure(event.code, event.message);
		}
		return text;
	}, []);
}
