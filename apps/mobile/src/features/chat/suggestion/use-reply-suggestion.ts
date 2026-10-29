import type { ChatCharacter, ChatRoom, ChatStore } from "@rowcat/chat";
import {
	CHAT_REPLY_SUGGESTION_HISTORY_LIMIT,
	effectiveChatPersona,
	openingMessage,
	type ReplySuggestionPort,
	resolveAllAges,
	runReplySuggestion,
} from "@rowcat/chat";
import { canViewAdultContent } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getRowCatClient } from "../../../lib/api.ts";
import { useUtilityGeneration } from "../utility-generation.ts";

/**
 * Wiring for reply suggestions; the rules live in `@rowcat/chat`. Ordering, validation, window
 * selection and failure classification are all there, so the per-app copies only read the scope.
 *
 * Transport comes from `useUtilityGeneration`, the same channel as auto-maintenance. A second copy
 * of that wiring could drop the connection list on one side, sending BYO rooms' conversations to
 * managed.
 *
 * Unlike maintenance, this hook has screen state: a suggestion is a press, so it must show that it
 * is waiting and why it failed.
 *
 * The result lives only in this hook's state (not in the store, codec or server). Sending is up to
 * the person: the screen fills the composer. Failure copy comes from `generation/error.ts`.
 */

export type ReplySuggestionState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; suggestions: string[] }
	/**
	 * `malformed`: the response arrived but was not usable. The failure table cannot express that, and
	 * folding it to the generic `error` sentence would be false, since the response was received and
	 * billed.
	 */
	| { status: "failed"; error: Error | null; malformed: boolean };

export interface ReplySuggestion {
	state: ReplySuggestionState;
	/** Requests once; does nothing while one is already running. */
	request: () => void;
	/** Clears the suggestions: picked, closed, or the condition went away. */
	dismiss: () => void;
}

export interface ReplySuggestionInput {
	room: ChatRoom | null;
	/**
	 * Characters added to this room, the source of `{{char}}`. Passed in from the screen, which
	 * already subscribes to that list.
	 */
	characters: readonly ChatCharacter[];
	/** This member's store: one axis of the ownership check and the source of history. */
	store: ChatStore | null;
	/** The scope's owner; `null` for guest or mid-switch. */
	viewerId: string | null;
	/**
	 * Identity of the current turn (`replySuggestionTurnKey`). Without it, suggestions from an earlier
	 * turn would reappear when the composer empties again.
	 */
	turnKey: string | null;
}

/**
 * Reply suggestion state for this room. With no room or store no request starts; the screen hides
 * the button via `canSuggestReply`.
 */
export function useReplySuggestion(
	input: ReplySuggestionInput,
): ReplySuggestion {
	const { room, characters, store, viewerId, turnKey } = input;
	const client = getRowCatClient();
	const viewer = useQuery(viewerQueryOptions(client)).data ?? null;
	const requestUtility = useUtilityGeneration();

	const [state, setState] = useState<ReplySuggestionState>({ status: "idle" });

	/**
	 * Current ownership axes in a ref. A request takes seconds, so the start values captured in the
	 * closure are compared against these when the result arrives.
	 */
	const currentRef = useRef<{
		store: ChatStore | null;
		viewerId: string | null;
		roomId: string | null;
	}>({ store, viewerId, roomId: room?.id ?? null });
	currentRef.current = { store, viewerId, roomId: room?.id ?? null };

	/* The rating decision must use the entitlement at press time, so the viewer is read through a ref. */
	const viewerRef = useRef(viewer);
	viewerRef.current = viewer;

	/**
	 * The one request in flight. A synchronous latch: checking `state` for `loading` cannot stop a
	 * second press in the same tick (`setState` is not reflected yet), which would send two paid
	 * calls.
	 */
	const inFlightRef = useRef<AbortController | null>(null);

	/**
	 * Drops held sentences when room, account or turn changes, and cuts any request in flight since
	 * its answer has nowhere to go.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: discards only when an identity axis changes
	useEffect(() => {
		inFlightRef.current?.abort();
		inFlightRef.current = null;
		setState({ status: "idle" });
		return () => {
			inFlightRef.current?.abort();
			inFlightRef.current = null;
		};
	}, [room?.id, store, viewerId, turnKey]);

	const dismiss = useCallback(() => {
		inFlightRef.current?.abort();
		inFlightRef.current = null;
		setState({ status: "idle" });
	}, []);

	/*
	 * The one request in flight. A ref latch, not `state`: `setState` is not visible within the same
	 * tick, so a double press would otherwise start two paid calls.
	 */
	const request = useCallback(() => {
		const roomId = room?.id;
		if (!roomId || !store) return;
		if (inFlightRef.current) return;

		const controller = new AbortController();
		inFlightRef.current = controller;
		setState({ status: "loading" });

		/* Identity at start; compared against current values when the result arrives. */
		const owner = { store, viewerId, roomId };
		const isValid = (): boolean =>
			!controller.signal.aborted &&
			currentRef.current.store === owner.store &&
			currentRef.current.viewerId === owner.viewerId &&
			currentRef.current.roomId === owner.roomId;

		const port: ReplySuggestionPort = {
			loadMessages: () =>
				store.listRecentMessages(roomId, {
					limit: CHAT_REPLY_SUGGESTION_HISTORY_LIMIT,
				}),
			/* `ChatGenerationBlockedError` from the shared channel carries the path to `Settings → AI`. */
			requestSuggestions: (generationRequest, signal) =>
				requestUtility(roomId, generationRequest, signal),
			isValid,
		};

		void runReplySuggestion(port, {
			persona: effectiveChatPersona(room),
			/*
			 * Used only when no message is stored yet, which is the first screen after pressing `Start conversation`.
			 */
			opening:
				openingMessage(room.seed, effectiveChatPersona(room), characters)
					?.content ?? null,
			/* Same rating function as real conversations: story rating first, entitlement layered on top. */
			allAges: resolveAllAges(room, {
				adultAllowed: canViewAdultContent(viewerRef.current),
			}),
			signal: controller.signal,
		})
			.then((outcome) => {
				if (inFlightRef.current === controller) inFlightRef.current = null;
				/* A late result for a room that is no longer current is dropped. */
				if (!isValid()) return;
				if (outcome.status === "ready")
					setState({ status: "ready", suggestions: outcome.suggestions });
				else if (outcome.reason === "stale") setState({ status: "idle" });
				else
					setState({
						status: "failed",
						error: outcome.error,
						malformed: outcome.reason === "malformed",
					});
			})
			/* The runner does not throw; this guard keeps the chat screen from collapsing if it ever does. */
			.catch(() => {
				if (inFlightRef.current === controller) inFlightRef.current = null;
				if (isValid())
					setState({ status: "failed", error: null, malformed: false });
			});
	}, [room, characters, store, viewerId, requestUtility]);

	return { state, request, dismiss };
}
