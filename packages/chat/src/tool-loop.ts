import type {
	ChatGenerationRequest,
	ChatStreamEvent,
	ChatToolArgumentValue,
	ChatToolCall,
} from "@rowcat/contracts/chat";
import {
	CHAT_ERROR_CODE,
	CHAT_MAX_TOOL_ROUND_TRIPS,
} from "@rowcat/contracts/chat";
import {
	type ChatTool,
	chatToolDeclarations,
	chatToolErrorText,
	chatToolFailureText,
	chatToolResultMessage,
	resolveChatToolCall,
} from "./tool.ts";

/**
 * Lifecycle of a tool round trip, and everything the app needs to know about it.
 *
 * This file is in the pure package for the same reason as the maintenance and recommendation
 * runners: there are two consumers (web and mobile), and every failure here is silent. An unbounded
 * loop burns credit, an unanswered call makes the next request a 400, and a result that arrives
 * after the user left the room lands in someone else's conversation.
 *
 * The router (app) takes a tool_call from the stream, calls planChatToolRoundTrip, runs the handler
 * or skips it, calls nextChatToolRequest, then calls stream() again. The new billing identity is
 * attached in that stream() call.
 *
 * Termination is structure, not counting. The last round trip's request empties tools (offersTools:
 * false), so the model has nothing to call and the loop ends whether the counter is right or wrong.
 *
 * An answer is returned even at the limit. All three providers reject unpaired calls with 400, so
 * one result message always goes out (see the 'failures are results too' note in tool.ts).
 *
 * Not here: transport, streaming, and billing, which the router handles per round trip; ownership,
 * which the session answers through ConversationSession.token; and clocks, randomness, and retries.
 */

export const CHAT_TOOL_EXHAUSTED_TEXT =
	"도구를 부를 수 있는 횟수를 다 썼습니다. 지금까지 얻은 것만으로 이야기를 마무리하세요.";

export interface ChatToolRoundTripInput {
	/** Round trips completed so far. It is 0 when the first call is encountered. */
	completed: number;
	call: ChatToolCall;
	tools: readonly ChatTool[];
}

/**
 * The action to take for this call. `offersTools` is in the plan because it is the termination
 * condition. If the caller computed it separately, termination would be decided in two places, and
 * changing only one would let the loop run one more time.
 */
export type ChatToolRoundTripPlan =
	| {
			status: "run";
			tool: ChatTool;
			arguments: Record<string, ChatToolArgumentValue>;
			offersTools: boolean;
	  }
	| { status: "answer"; text: string; offersTools: boolean };

/**
 * Turns one call the model made into an action. A failed resolution (unknown tool, wrong arguments)
 * becomes `answer` rather than an error: those are facts to tell the model, and breaking the loop
 * would leave the conversation stuck with an unanswered call. The limit check comes before
 * resolution on purpose. When the answer will only say the limit was reached, looking up the
 * registry and checking arguments is wasted work. Reversing the order would also make the sentence
 * depend on registry state.
 */
export function planChatToolRoundTrip(
	input: ChatToolRoundTripInput,
): ChatToolRoundTripPlan {
	const remaining = CHAT_MAX_TOOL_ROUND_TRIPS - input.completed;

	if (remaining <= 0)
		return {
			status: "answer",
			text: CHAT_TOOL_EXHAUSTED_TEXT,
			offersTools: false,
		};

	/** If this is the last allowed round trip, the next request offers no tools. */
	const offersTools = remaining > 1;

	const resolution = resolveChatToolCall(input.tools, input.call);
	if (resolution.status !== "ok")
		return {
			status: "answer",
			text: chatToolFailureText(resolution),
			offersTools,
		};

	return {
		status: "run",
		tool: resolution.tool,
		arguments: resolution.arguments,
		offersTools,
	};
}

export interface NextChatToolRequestInput {
	/** The request just sent. The next request continues its system prompt and history as they are. */
	request: ChatGenerationRequest;
	/**
	 * The body the response wrote before calling the tool. It has already been streamed to the screen.
	 */
	assistantContent: string;
	call: ChatToolCall;
	/** Handler output, or the sentence the plan produced for a failed resolution. */
	result: string;
	/** The value the plan set. It is not recomputed here. */
	offersTools: boolean;
	tools: readonly ChatTool[];
}

/**
 * Appends one round trip to history to form the next request. The body is always carried along,
 * since the user has already read text written before the tool call, and dropping it would make the
 * model repeat it. `continuation` is always off, because the last message is a tool result and not
 * a prefill.
 *
 * Reasoning is dropped for this request only, and the stored preference is unchanged. The assembled
 * assistant turn has no thinking block, which Anthropic's extended form requires at the start of
 * the last assistant turn. Keeping reasoning would make the provider return 400 after the body had
 * already streamed, and disabling it would hide the cause. If one must give way, tools are kept and
 * only this turn's text quality suffers, matching the continuation choice in
 * apps/web/src/lib/generation/anthropic.ts.
 *
 * Gemini 3 is not solved this way: it requires the signature attached to the call, and disabling
 * thinking does not exempt it. So the whole call, including `ChatToolCall.providerState`, is sent
 * back.
 */
export function nextChatToolRequest(
	input: NextChatToolRequestInput,
): ChatGenerationRequest {
	return {
		...input.request,
		messages: [
			...input.request.messages,
			{
				role: "assistant",
				content: input.assistantContent,
				toolCall: input.call,
			},
			chatToolResultMessage(input.call.id, input.result),
		],
		tools: input.offersTools ? chatToolDeclarations(input.tools) : [],
		continuation: false,
		reasoningEffort: null,
	};
}

export interface ChatToolLoopPort {
	/**
	 * Sends one request and emits its frames. It is called anew on every round trip. Transport is a
	 * port because if this file knew the transport, BYO and managed could not share one loop (the same
	 * role as `requestMaintenance` in the maintenance runner). A new call per round trip is the whole
	 * of the accounting: managed transport creates the billing identity inside each call, so one round
	 * trip is one attempt, and reservation and settlement happen per round trip.
	 */
	stream(request: ChatGenerationRequest): AsyncIterable<ChatStreamEvent>;
	/**
	 * Tools callable in this conversation. If the list is empty, the loop does not start and the
	 * request passes through unchanged.
	 */
	tools: readonly ChatTool[];
	/**
	 * Whether this generation is still inside its conversation. It is asked again between round trips.
	 * The abort signal does not answer this, because it answers a different question: the signal cuts
	 * a request already sent, while this decides whether the next request is sent at all. If the loop
	 * went on after the user left the room, tokens would be spent on a sentence nobody reads, and
	 * under managed billing they would be charged. This does not guard saving. Keeping a late result
	 * out of someone else's conversation is the job of the ownership token
	 * (ConversationSession.token).
	 */
	isValid(): boolean;
	/**
	 * Passed to the handler unchanged. Cutting a request that was already sent is done by the
	 * transport's signal.
	 */
	signal: AbortSignal;
}

/**
 * The turn ended with a call that could not be answered. This text is not shown to the user: both
 * apps choose failure wording by code (`generationFailureMessage`), so it is diagnostic only. It is
 * kept accurate in case a client that renders it is added later.
 */
const TOOL_CALL_UNANSWERABLE_MESSAGE =
	"도구 호출에 답할 수 없어 응답이 중단되었습니다.";

/** Usage gathered across all round trips. Only the axes that were reported are added. */
interface UsageTotals {
	model?: string;
	inputTokens?: number;
	cachedInputTokens?: number;
	cacheWriteInputTokens?: number;
	outputTokens?: number;
}

const addUsage = (
	total: number | undefined,
	next: number | undefined,
): number | undefined => (next === undefined ? total : (total ?? 0) + next);

/**
 * Turns gathered usage into one frame. No frame is made if no axis was reported, because 0 would
 * claim that nothing was used, which is a different claim.
 */
function usageFrame(usage: UsageTotals): ChatStreamEvent | null {
	if (
		usage.model === undefined &&
		usage.inputTokens === undefined &&
		usage.outputTokens === undefined
	)
		return null;
	return {
		type: "usage",
		...(usage.model !== undefined ? { model: usage.model } : {}),
		...(usage.inputTokens !== undefined
			? { inputTokens: usage.inputTokens }
			: {}),
		...(usage.cachedInputTokens !== undefined
			? { cachedInputTokens: usage.cachedInputTokens }
			: {}),
		...(usage.cacheWriteInputTokens !== undefined
			? { cacheWriteInputTokens: usage.cacheWriteInputTokens }
			: {}),
		...(usage.outputTokens !== undefined
			? { outputTokens: usage.outputTokens }
			: {}),
	};
}

/**
 * One turn. However many round trips it takes, the caller sees a single stream. That is this
 * function's contract, so the middle round trips' `done` and `usage` frames are not emitted. A
 * leaked `done` would make the caller finalize the message early and lose the body after it. Usage
 * is summed here. Each round trip emits a frame and the caller overwrites with the last value, so
 * without summing the stored count would be only the last request's. Doing it in one place matters
 * too: if each app summed, the same conversation would have different bases on different devices.
 * Billing frames pass through unchanged, since each one is a real settlement for one round trip.
 * Merging them would make the user look charged once.
 */
export async function* runChatToolLoop(
	request: ChatGenerationRequest,
	port: ChatToolLoopPort,
): AsyncGenerator<ChatStreamEvent> {
	/**
	 * With no tools, this function is a pass-through. It adds no declaration, so the upstream body is
	 * byte for byte what it was before this axis existed, and the stream carries no `tool_call`.
	 */
	if (port.tools.length === 0) {
		yield* port.stream(request);
		return;
	}

	let next: ChatGenerationRequest = {
		...request,
		tools: chatToolDeclarations(port.tools),
	};
	let completed = 0;
	let usage: UsageTotals = {};
	let finishReason: string | undefined;
	/**
	 * Whether the loop ended on an unanswerable call. This decides the kind of terminal frame. The
	 * loop has three exits and only one is normal, so a single `break` cannot tell them apart (see the
	 * comments on each branch).
	 */
	let unanswerable = false;

	for (;;) {
		/**
		 * Body text emitted during this round trip. It rides on the assistant turn of the next request as
		 * is.
		 */
		let content = "";
		let call: ChatToolCall | null = null;

		for await (const event of port.stream(next)) {
			if (event.type === "delta") {
				content += event.text;
				yield event;
				continue;
			}
			if (event.type === "tool_call") {
				call = event.call;
				continue;
			}
			if (event.type === "usage") {
				usage = {
					model: event.model ?? usage.model,
					inputTokens: addUsage(usage.inputTokens, event.inputTokens),
					cachedInputTokens: addUsage(
						usage.cachedInputTokens,
						event.cachedInputTokens,
					),
					cacheWriteInputTokens: addUsage(
						usage.cacheWriteInputTokens,
						event.cacheWriteInputTokens,
					),
					outputTokens: addUsage(usage.outputTokens, event.outputTokens),
				};
				continue;
			}
			if (event.type === "done") {
				finishReason = event.finishReason ?? finishReason;
				continue;
			}
			/**
			 * Only an error remains. It is passed through and the loop ends. Text already emitted must be
			 * saved by the caller, so nothing is thrown (the adapters follow the same rule). Usage gathered
			 * so far is emitted first. The caller decides saving on the terminal frame, so dropping usage
			 * here would save only failed turns without usage. Under managed billing those round trips were
			 * already charged, so the usage table would miss exactly those turns. This is the same axis as
			 * 'unknown is not zero' in `chatUsageView`. The normal exit follows the same order: usage first,
			 * terminal frame last.
			 */
			const failed = usageFrame(usage);
			if (failed) yield failed;
			yield event;
			return;
		}

		if (!call) break;

		/**
		 * The tool-less request returned a call, so upstream ignored our declaration. Answering here
		 * would never end the round trip, because every answer can prompt another call, so counting round
		 * trips would not stop it. There are three guards by design. Normally the last round trip removes
		 * tools (`offersTools`). When upstream ignores that, this line applies. The plan's limit check is
		 * a last guard for callers outside this loop that imitate it.
		 */
		if (next.tools.length === 0) {
			unanswerable = true;
			break;
		}

		/**
		 * Once the room has been left, no further request is sent. Even if the loop stops here, the body
		 * up to this round trip has already been emitted, and the caller's ownership check decides
		 * whether to save it.
		 */
		if (!port.isValid()) break;

		const plan = planChatToolRoundTrip({ completed, call, tools: port.tools });
		let result: string;
		if (plan.status === "answer") result = plan.text;
		else
			try {
				result = await plan.tool.run(plan.arguments, port.signal);
			} catch {
				/**
				 * The thrown value is not read. We cannot control what it contains, and it would become the
				 * model's input.
				 */
				result = chatToolErrorText(call.name);
			}

		completed += 1;
		next = nextChatToolRequest({
			request: next,
			assistantContent: content,
			call,
			result,
			offersTools: plan.offersTools,
			tools: port.tools,
		});
	}

	/** Usage is emitted before the terminal frame, including when the turn was aborted. */
	const summary = usageFrame(usage);
	if (summary) yield summary;

	/**
	 * Ending on an unanswerable call is not a normal completion. Emitting `done` here would save the
	 * response as complete (end: 'completed'), and the screen would show a body that stops
	 * mid-sentence with no mark. Even `Continue` would not appear, since nothing marks the tail as open.
	 * This branch means upstream ignored our declaration, which is a provider failure. Ending with an
	 * error saves what was received as incomplete, leaving a way to continue. When the room was left,
	 * this flag is not set. The caller's ownership check discards that result anyway, and an error
	 * notice would show a finished turn's failure to someone already looking at another conversation.
	 */
	if (unanswerable) {
		yield {
			type: "error",
			code: CHAT_ERROR_CODE.providerFailed,
			message: TOOL_CALL_UNANSWERABLE_MESSAGE,
		};
		return;
	}

	yield {
		type: "done",
		...(finishReason !== undefined ? { finishReason } : {}),
	};
}
