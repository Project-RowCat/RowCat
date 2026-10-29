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
import { getRowCatClient } from "#/lib/api.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { useUtilityGeneration } from "../utility-generation.ts";

/**
 * Wiring for reply suggestions. The rules live in @rowcat/chat.
 *
 * This file does four things only: fills the ports (one store and one transport), fixes the
 * ownership axis, passes target resolution through the same function as conversation turns, and
 * moves results into screen state. Ordering, validation, window selection and failure
 * classification are not here. Mobile must pass the same rules, and per-app copies would diverge on
 * one side only (reply-suggestion-runner.ts).
 *
 * Transport is not this file's. Target resolution, connection checks and credentials belong to
 * useUtilityGeneration. A second copy of that wiring here would eventually miss a connection list;
 * then in BYO rooms, suggestions alone would silently go to managed and send the room's entire
 * recent conversation to the server. With no connection, the request is blocked, not moved to
 * managed, and unlike maintenance the screen says so.
 *
 * This differs from the maintenance wiring because it has screen state. The automatic maintenance
 * hook has no useState, which marked it as not user-initiated. Suggestions are user-triggered, so
 * they must say they are waiting and say why they failed.
 *
 * Not here: persistence (results live only in this hook's state), sending (the screen fills the
 * input; a person sends), and wording (the failure table is in generation-error.ts).
 */

export type ReplySuggestionState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; suggestions: string[] }
	/**
	 * `error` is the material the app's failure table names; without a name it collapses to a generic
	 * sentence. `malformed` is a fact that table cannot express: a response arrived but was not in a
	 * usable shape. Passed without `error`, it would collapse to 'no response received', which is
	 * false: the response was received and billed.
	 */
	| { status: "failed"; error: Error | null; malformed: boolean };

export interface ReplySuggestion {
	state: ReplySuggestionState;
	/** Starts one request. No-op if a request is already running. */
	request: () => void;
	/** Removes the suggestions from the screen: picked, closed, or the conditions disappeared. */
	dismiss: () => void;
}

/**
 * This room's reply-suggestion state. If there is no room or no store, no request starts; the
 * screen only needs to avoid rendering the button (canSuggestReply decides that).
 */
export function useReplySuggestion(
	room: ChatRoom | null,
	/**
	 * The characters introduced to this room; the source of {{char}}. v2 story seed characters are
	 * always empty.
	 *
	 * Accepted as a parameter because the screen already subscribes to this list; subscribing here
	 * again would add a second subscription to the same room's character list. Without it, only this
	 * request's opening line would carry the placeholder literally.
	 */
	characters: readonly ChatCharacter[],
	/**
	 * The identity of the current turn, as produced by replySuggestionTurnKey.
	 *
	 * Without this axis, a set of suggestions survives after the conversation moves on: send one, get
	 * the response, the input empties again, and the suggestion from the previous turn reappears. That
	 * sentence raises no error and looks plausible.
	 */
	turnKey: string | null,
): ReplySuggestion {
	const { store, viewerId } = useChatScope();
	const client = getRowCatClient();
	const viewer = useQuery(viewerQueryOptions(client)).data ?? null;
	const requestUtility = useUtilityGeneration();

	const [state, setState] = useState<ReplySuggestionState>({ status: "idle" });

	/**
	 * Freezes the ownership axis in a ref. A request takes seconds, during which the room or account
	 * may change. Holding the start-time values in a closure and reading the current ones from a ref
	 * lets the two be compared. Comparing render state would not work: it is fixed in the render where
	 * the callback was created, so it always equals itself.
	 */
	const currentRef = useRef<{
		store: ChatStore | null;
		viewerId: string | null;
		roomId: string | null;
	}>({ store, viewerId, roomId: room?.id ?? null });
	currentRef.current = { store, viewerId, roomId: room?.id ?? null };

	/**
	 * Freezes the viewer in a ref. The tier check must see entitlement at the moment of the press, not
	 * the value from the render that created the callback.
	 */
	const viewerRef = useRef(viewer);
	viewerRef.current = viewer;

	/**
	 * The request in flight. This is a synchronous latch: checking the state for loading cannot block
	 * a second press in the same tick, since setState is not applied until later. This path issues
	 * paid calls, so the latch matters.
	 */
	const inFlightRef = useRef<AbortController | null>(null);

	/**
	 * Discards held sentences when the room, account, or turn changes. They are not saved, so there is
	 * no reason to keep them; keeping them would show sentences from another room or a previous turn
	 * above this input. It also aborts any request in flight, since its answer now has nowhere to go.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: discards only when the identity axis changes.
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

	const request = useCallback(() => {
		const roomId = room?.id;
		if (!roomId || !store) return;
		if (inFlightRef.current) return;

		const controller = new AbortController();
		inFlightRef.current = controller;
		setState({ status: "loading" });

		/** Identity captured at start. Compared with the current identity when the result arrives. */
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
			/**
			 * Collects the whole stream into one string. The wiring is the shared path's job
			 * (utility-generation.ts). A blocked target is thrown from there as GenerationBlockedError,
			 * whose name carries the route to `Go to AI settings`.
			 */
			requestSuggestions: (generationRequest, signal) =>
				requestUtility(roomId, generationRequest, signal),
			isValid,
		};

		void runReplySuggestion(port, {
			persona: effectiveChatPersona(room),
			/**
			 * The opening is built with the same function the screen renders. It is used only when no
			 * message has been saved (a window-selection rule), but that one case is the first screen seen
			 * by someone who just pressed `Start conversation`.
			 */
			opening:
				openingMessage(room.seed, effectiveChatPersona(room), characters)
					?.content ?? null,
			/**
			 * The rating check uses the same function as real conversations. Story rating takes precedence
			 * and membership entitlement layers on top. A separate check here could loosen or tighten the
			 * adult gate for suggestions alone.
			 */
			allAges: resolveAllAges(room, {
				adultAllowed: canViewAdultContent(viewerRef.current),
			}),
			signal: controller.signal,
		})
			.then((outcome) => {
				if (inFlightRef.current === controller) inFlightRef.current = null;
				/** A late result does not touch the screen; it already belongs to another room. */
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
			/** The runner does not throw, but if it ever does, the conversation screen must not break. */
			.catch(() => {
				if (inFlightRef.current === controller) inFlightRef.current = null;
				if (isValid())
					setState({ status: "failed", error: null, malformed: false });
			});
	}, [room, characters, store, viewerId, requestUtility]);

	return { state, request, dismiss };
}
