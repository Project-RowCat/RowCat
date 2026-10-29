import {
	beginAdultVerificationMutationOptions,
	completeAdultVerificationMutationOptions,
} from "@rowcat/query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRowCatClient } from "../../lib/api.ts";
import {
	ADULT_VERIFICATION_IDLE,
	type AdultVerificationPhase,
} from "./adult-verification-state.ts";
import {
	type AdultVerificationPorts,
	type AdultVerificationTurn,
	createAdultVerificationTurn,
} from "./adult-verification-turn.ts";

/**
 * Wiring for the verification procedure; no rules live here. Ordering, locking and ownership are in
 * `adult-verification-turn.ts`, so they are testable without rendering.
 *
 * - Cache policy is not restated: the two `@rowcat/query` policies are used as-is (the completion
 *   policy seats the settled viewer and resets gallery/detail), so there is no `setQueryData` or
 *   `invalidateQueries` here. The viewer is not refetched after start either: a created attempt
 *   changes nothing about eligibility.
 * - No `showAdultMutationOptions`: completion changes eligibility, and display is a separate user
 *   choice; bundling them would show adult content to someone who only meant to verify.
 */

export interface AdultVerification {
	phase: AdultVerificationPhase;
	/** Starts verification, or starts over after a failure. */
	start(): void;
	/** Re-asks the server only, without reopening the authority. */
	recheck(): void;
	/** The four callbacks of the authority's surface; it has no other channel. */
	provider: {
		completed(): void;
		rejected(): void;
		dismissed(): void;
		crashed(): void;
	};
}

export function useAdultVerification(viewerId: string): AdultVerification {
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const begin = useMutation(beginAdultVerificationMutationOptions(client));
	const complete = useMutation(
		completeAdultVerificationMutationOptions(client, queryClient),
	);
	const [phase, setPhase] = useState<AdultVerificationPhase>(
		ADULT_VERIFICATION_IDLE,
	);

	/**
	 * Everything the ports read goes through refs: a port object rebuilt every render would create a
	 * new turn each time and drop the synchronous lock and owner record, making the lock depend on
	 * render timing.
	 */
	const viewerIdRef = useRef(viewerId);
	const beginRef = useRef(begin.mutateAsync);
	const completeRef = useRef(complete.mutateAsync);
	useEffect(() => {
		viewerIdRef.current = viewerId;
		beginRef.current = begin.mutateAsync;
		completeRef.current = complete.mutateAsync;
	});

	const ports = useMemo<AdultVerificationPorts>(
		() => ({
			begin: () => beginRef.current(),
			complete: () => completeRef.current(),
			/**
			 * The browser result is not read: the value this returns (cancelled vs dismissed) is not the
			 * authority's verdict, which the server always decides with its own secret.
			 */
			openBrowser: async (url) => {
				await WebBrowser.openBrowserAsync(url);
			},
			viewerId: () => viewerIdRef.current,
			emit: setPhase,
		}),
		[],
	);

	/**
	 * The turn is created in render and discarded in an effect cleanup. Created in an effect it may
	 * not exist for the first press; not discarded, late callbacks reach the server after the screen
	 * is gone. StrictMode runs one cleanup early, so the slot is reset to `null` and the next call
	 * builds a fresh turn: reusing a disposed instance would make the screen's controls do nothing
	 * forever (the web's sync coordinator hit this).
	 */
	const turnRef = useRef<AdultVerificationTurn | null>(null);
	const turnOf = useCallback((): AdultVerificationTurn => {
		if (!turnRef.current) turnRef.current = createAdultVerificationTurn(ports);
		return turnRef.current;
	}, [ports]);

	useEffect(
		() => () => {
			turnRef.current?.dispose();
			turnRef.current = null;
		},
		[],
	);

	const start = useCallback(() => void turnOf().start(), [turnOf]);
	const recheck = useCallback(() => void turnOf().retryCompletion(), [turnOf]);
	const provider = useMemo(
		() => ({
			completed: () => void turnOf().providerCompleted(),
			rejected: () => turnOf().providerRejected(),
			dismissed: () => turnOf().providerDismissed(),
			crashed: () => turnOf().providerCrashed(),
		}),
		[turnOf],
	);

	return { phase, start, recheck, provider };
}
