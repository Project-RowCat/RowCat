import type { ChatGenerationRequest } from "@rowcat/contracts/chat";
import type { ChatPersonaSnapshot } from "./persona.ts";
import {
	type ReplySuggestionMessage,
	selectReplySuggestionWindow,
} from "./reply-suggestion.ts";
import {
	buildReplySuggestionRequest,
	parseReplySuggestions,
} from "./reply-suggestion-prompt.ts";

/**
 * One suggestion run's lifecycle, and everything the app must know about it. Lives in the pure
 * package because there are two consumers (web and mobile), and wrong ordering fails silently: a
 * result from a room already left can appear over another room's input, or a failure can vanish.
 *
 * Unlike the maintenance runner, failures are shown to the user. The action is user-initiated, so
 * the result carries the failure reason and the original error. The app's failure table (balance,
 * no connection, other) receives them unchanged. The table itself stays in the app, because its
 * wording belongs there.
 *
 * Not here: React or hooks (wiring is the app's), transport, provider or SDK (the port's
 * `requestSuggestions` is the only boundary), storage (suggestions commit nothing, so there is no
 * `commit`), and screen copy.
 */

export interface ReplySuggestionPort {
	/**
	 * Recent messages of this room, ascending. May be longer than the window; the runner trims. The
	 * port does not decide the trim, because it must match the availability check
	 * (`selectReplySuggestionWindow`). If each storage chose its own, two apps would read different
	 * conversations.
	 */
	loadMessages(): Promise<ReplySuggestionMessage[]>;
	/**
	 * Sends the request and receives the full body. Not streaming: the output is parsed once as JSON
	 * and never shown as it flows, so exposing deltas would make every caller reassemble them.
	 *
	 * Throws on failure. The thrown value is carried unchanged in the result, and the app's failure
	 * table names it.
	 */
	requestSuggestions(
		request: ChatGenerationRequest,
		signal: AbortSignal,
	): Promise<string>;
	/**
	 * Whether this suggestion is still in its own conversation. Storage cannot answer this axis. It is
	 * the same judgment as generation ownership (`ownsSession`).
	 *
	 * Wrong arrival costs less here than in maintenance: no foreign data is stored, but suggestions
	 * from another room's context may appear over this input. If the user picks one, it still lands in
	 * this conversation.
	 *
	 * Does not rely on the abort signal, for the same reason as in the runner tests: a fully delivered
	 * request resolves as success, so the check reads state.
	 */
	isValid(): boolean;
}

/**
 * Why a suggestion run ended. Carrying `error` is what separates this from the maintenance result:
 * the value is the material the app's failure table uses to name the failure, and an unnamed
 * failure is folded into a generic message. The runner builds no sentences, because the two apps
 * already have that table.
 */
export type ReplySuggestionOutcome =
	/** Sentences are available. There may be fewer than requested; whatever exists is shown. */
	| { status: "ready"; suggestions: string[] }
	| {
			status: "failed";
			reason:
				| /**
				 * The request failed (network, provider, balance, or a blocked target).
				 * `error` carries the original value.
				 */
				"request"
				/**
				 * The response was not in the expected shape. One paid call was discarded; pressing again
				 * usually succeeds.
				 */
				| "malformed"
				/**
				 * There was no conversation to read. The availability check should have blocked this state up
				 * front.
				 */
				| "unavailable"
				/**
				 * The conversation was no longer this run's own when the result arrived. The screen says
				 * nothing.
				 */
				| "stale";
			error: Error | null;
	  };

export interface RunReplySuggestionInput {
	persona: ChatPersonaSnapshot | null;
	/** The room's opening, used only when no messages are stored yet. */
	opening: string | null;
	/** Whether to proceed in all-ages mode. Pass the value from `resolveAllAges` unchanged. */
	allAges: boolean;
	signal?: AbortSignal;
}

/**
 * One suggestion run. Does not throw. This is part of the contract: it is called from the button
 * press, and an escaped exception would break the whole conversation screen.
 *
 * Order is the rule:
 * 1. Ownership check before starting, so no paid call goes out for a conversation already left.
 * 2. Select the window; if nothing can be read, send no request.
 * 3. Build the request (pure).
 * 4. The call, the only network step.
 * 5. Gate: if the shape is wrong, show nothing.
 * 6. Ownership recheck, because step 4 may have taken seconds and the room or account may have
 *    changed.
 *
 * Both 1 and 6 are needed because they answer at different times. With only 1, a late sentence can
 * appear in another room. With only 6, money is spent on a conversation already left.
 */
export async function runReplySuggestion(
	port: ReplySuggestionPort,
	input: RunReplySuggestionInput,
): Promise<ReplySuggestionOutcome> {
	try {
		if (!port.isValid())
			return { status: "failed", reason: "stale", error: null };

		const messages = await port.loadMessages();
		const window = selectReplySuggestionWindow({
			messages,
			opening: input.opening,
		});
		if (!window.length)
			return { status: "failed", reason: "unavailable", error: null };

		const request = buildReplySuggestionRequest({
			persona: input.persona,
			messages: window,
			allAges: input.allAges,
		});

		let text: string;
		try {
			text = await port.requestSuggestions(
				request,
				input.signal ?? neverAborted(),
			);
		} catch (error) {
			/**
			 * Passes the original error through unchanged. The app's failure table names failures from this
			 * material, and splitting reasons here would create a second table. An unnamed failure is folded
			 * by the app into a generic sentence.
			 */
			return {
				status: "failed",
				reason: "request",
				error: error instanceof Error ? error : null,
			};
		}

		const suggestions = parseReplySuggestions(text);
		if (!suggestions)
			return { status: "failed", reason: "malformed", error: null };

		if (!port.isValid())
			return { status: "failed", reason: "stale", error: null };

		return { status: "ready", suggestions };
	} catch (error) {
		/**
		 * Storage failures also stop here. Suggestions commit nothing, so there is nothing to roll back;
		 * the only remaining step is telling the user the run failed.
		 */
		return {
			status: "failed",
			reason: "request",
			error: error instanceof Error ? error : null,
		};
	}
}

const neverAborted = (): AbortSignal => new AbortController().signal;
