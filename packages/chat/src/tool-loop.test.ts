import {
	CHAT_MAX_TOOL_ROUND_TRIPS,
	ChatGenerationRequest,
	type ChatStreamEvent,
	type ChatToolArgumentValue,
	type ChatToolCall,
} from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import type { ChatTool } from "./tool.ts";
import { CHAT_TOOL_RESULT_BOUNDARY } from "./tool.ts";
import {
	CHAT_TOOL_EXHAUSTED_TEXT,
	type ChatToolLoopPort,
	nextChatToolRequest,
	planChatToolRoundTrip,
	runChatToolLoop,
} from "./tool-loop.ts";

/**
 * Termination and ordering of the round trip loop. When any of the three is wrong, nothing reports
 * it: an unbounded loop is billed on every round trip, an unanswered call makes the next request a
 * 400, and a history missing the body repeats the same paragraph twice. None of these throws.
 */

const dice: ChatTool = {
	declaration: {
		name: "dice",
		description: "주사위",
		parameters: [
			{
				name: "sides",
				type: "number",
				description: "",
				required: true,
				choices: [],
			},
		],
	},
	run: async () => "17",
};

const call: ChatToolCall = {
	id: "toolu_1",
	name: "dice",
	arguments: { sides: 20 },
};

const request = ChatGenerationRequest.parse({
	system: "세계관",
	messages: [{ role: "user", content: "굴려 봐" }],
	tools: [dice.declaration],
});

describe("planChatToolRoundTrip", () => {
	it("runs the first round trip and keeps offering tools", () => {
		const plan = planChatToolRoundTrip({ completed: 0, call, tools: [dice] });
		expect(plan.status).toBe("run");
		expect(plan.offersTools).toBe(true);
	});

	/**
	 * Termination is structure, not counting. The next request after the last allowed round trip has
	 * no tool to call, so the loop cannot run one more time even if the counter is wrong.
	 */
	it("the last allowed round trip withdraws the tools", () => {
		const plan = planChatToolRoundTrip({
			completed: CHAT_MAX_TOOL_ROUND_TRIPS - 1,
			call,
			tools: [dice],
		});
		expect(plan.status).toBe("run");
		expect(plan.offersTools).toBe(false);
	});

	/**
	 * Even at the limit, an answer is returned: all three providers reject a call that has no paired
	 * result with a 400.
	 */
	it("past the cap it does not run and returns the fact", () => {
		const plan = planChatToolRoundTrip({
			completed: CHAT_MAX_TOOL_ROUND_TRIPS,
			call,
			tools: [dice],
		});
		expect(plan).toEqual({
			status: "answer",
			text: CHAT_TOOL_EXHAUSTED_TEXT,
			offersTools: false,
		});
	});

	/** A failed resolution is a fact to tell the model, not an error. It does not stop the loop. */
	it("folds a missing tool into an answer too", () => {
		const plan = planChatToolRoundTrip({
			completed: 0,
			call: { ...call, name: "summon" },
			tools: [dice],
		});
		expect(plan.status).toBe("answer");
		expect(plan.offersTools).toBe(true);
	});

	it("folds wrong arguments into an answer too", () => {
		const plan = planChatToolRoundTrip({
			completed: 0,
			call: { ...call, arguments: { sides: "20" } },
			tools: [dice],
		});
		expect(plan.status).toBe("answer");
		expect(plan.status === "answer" && plan.text).toContain("number");
	});

	/**
	 * If the order were reversed, which sentence goes out ('the arguments are wrong' or 'the round
	 * trips are used up') would depend on the registry state.
	 */
	it("the cap check stands before the call check", () => {
		const plan = planChatToolRoundTrip({
			completed: CHAT_MAX_TOOL_ROUND_TRIPS,
			call: { ...call, name: "summon" },
			tools: [],
		});
		expect(plan.status === "answer" && plan.text).toBe(
			CHAT_TOOL_EXHAUSTED_TEXT,
		);
	});
});

describe("nextChatToolRequest", () => {
	const next = (
		overrides: Partial<Parameters<typeof nextChatToolRequest>[0]>,
	) =>
		nextChatToolRequest({
			request,
			assistantContent: "그는 주사위를 집었다.",
			call,
			result: "17",
			offersTools: true,
			tools: [dice],
			...overrides,
		});

	it("builds a request the contract accepts", () => {
		expect(() => ChatGenerationRequest.parse(next({}))).not.toThrow();
	});

	/**
	 * Without the body, the model writes the same sentence again and the screen shows the same
	 * paragraph twice. All three providers also require the assistant turn that contains the call to
	 * precede its result.
	 */
	it("adds body, calls and results in that order", () => {
		const messages = next({}).messages;
		expect(messages).toHaveLength(3);
		const assistant = messages[1];
		expect(assistant?.role).toBe("assistant");
		expect(assistant?.content).toBe("그는 주사위를 집었다.");
		expect(assistant?.role === "assistant" && assistant.toolCall?.id).toBe(
			"toolu_1",
		);
		const result = messages[2];
		expect(result?.role).toBe("tool");
		expect(result?.role === "tool" && result.callId).toBe("toolu_1");
		expect(result?.content).toContain("17");
		expect(result?.content).toContain(CHAT_TOOL_RESULT_BOUNDARY);
	});

	/**
	 * Uses the value the plan set. Recomputing it here would make termination decided in two places.
	 */
	it("after withdrawing tools the next request has nothing to call", () => {
		expect(next({ offersTools: false }).tools).toEqual([]);
		expect(next({ offersTools: true }).tools).toHaveLength(1);
	});

	/**
	 * The last message is a tool result, so this request is not a prefill. Leaving continuation on
	 * would make the adapter apply continuation rules (no trailing whitespace, thinking disabled) to
	 * the wrong shape.
	 */
	it("the next request is not a continuation even when starting from one", () => {
		expect(
			next({ request: { ...request, continuation: true } }).continuation,
		).toBe(false);
	});

	it("leaves the system prompt and other axes untouched", () => {
		const built = next({});
		expect(built.system).toBe(request.system);
		expect(built.maxOutputTokens).toBe(request.maxOutputTokens);
		expect(built.context).toEqual(request.context);
	});

	/**
	 * The assistant turn in this request is reassembled by us, so it has no thinking block from the
	 * provider. Anthropic's extended-thinking form requires the last assistant turn of a
	 * thinking-enabled request to start with that block. If reasoning were sent anyway, the request
	 * would fail with 400 after the body had already streamed. Turning reasoning off would hide the
	 * error, so the cause on this axis would never show.
	 */
	it("round-trip requests carry no reasoning", () => {
		expect(
			next({ request: { ...request, reasoningEffort: "high" } })
				.reasoningEffort,
		).toBeNull();
	});

	/**
	 * Stored preferences are not touched. The downgrade applies to this one request only, so the
	 * original request and turns that call no tool keep the chosen value.
	 */
	it("the original request's reasoning value stays", () => {
		const source = { ...request, reasoningEffort: "high" } as const;
		next({ request: source });
		expect(source.reasoningEffort).toBe("high");
	});

	/**
	 * Gemini 3 requires the signature it attached to a turn's first call to come back, and disabling
	 * thinking does not exempt it. That value travels with the call, so the whole call is carried into
	 * the next request. Picking fields would break tool use on those models from then on.
	 */
	it("a call's echo state survives into the next request", () => {
		const built = next({
			call: { ...call, providerState: "Cg8KDQoLc2lnbmF0dXJl" },
		});
		const assistant = built.messages[1];
		expect(
			assistant?.role === "assistant" && assistant.toolCall?.providerState,
		).toBe("Cg8KDQoLc2lnbmF0dXJl");
	});

	/**
	 * Two round trips layered one on the other still grow history linearly. The loop calls this
	 * function repeatedly.
	 */
	it("the second round trip builds on the first", () => {
		const once = next({});
		const twice = nextChatToolRequest({
			request: once,
			assistantContent: "그리고 다시 굴렸다.",
			call: { ...call, id: "toolu_2" },
			result: "3",
			offersTools: false,
			tools: [dice],
		});
		expect(twice.messages).toHaveLength(5);
		expect(twice.messages.at(-1)?.role).toBe("tool");
		expect(twice.tools).toEqual([]);
	});
});

/**
 * Within a turn, the caller sees one stream, and keeping that is this bundle's whole job. A middle
 * round trip's `done` leaking out would make the caller finalize the message there and lose the
 * body after it. If usage is not summed, the stored token count keeps only the last request's. If
 * termination goes wrong, the conversation bills every round trip and never ends.
 */

const events = (
	...list: ChatStreamEvent[]
): AsyncIterable<ChatStreamEvent> => ({
	async *[Symbol.asyncIterator]() {
		for (const event of list) yield event;
	},
});

const callFrame = (
	id: string,
	args: Record<string, number>,
): ChatStreamEvent => ({
	type: "tool_call",
	call: { id, name: "dice", arguments: args },
});

/**
 * Test double that scripts in advance what each round trip emits. It also records the requests
 * sent.
 */
function scriptedPort(
	scripts: ChatStreamEvent[][],
	overrides: Partial<Pick<ChatToolLoopPort, "tools" | "isValid">> = {},
) {
	const sent: ChatGenerationRequest[] = [];
	const ran: Record<string, ChatToolArgumentValue>[] = [];
	const tool: ChatTool = {
		declaration: {
			name: "dice",
			description: "주사위",
			parameters: [
				{
					name: "sides",
					type: "number",
					description: "",
					required: true,
					choices: [],
				},
			],
		},
		run: async (args) => {
			ran.push({ ...args });
			return "17";
		},
	};
	const port: ChatToolLoopPort = {
		stream(request) {
			sent.push(request);
			return events(...(scripts[sent.length - 1] ?? [{ type: "done" }]));
		},
		tools: [tool],
		isValid: () => true,
		signal: new AbortController().signal,
		...overrides,
	};
	return { port, sent, ran, tool };
}

const drain = async (
	stream: AsyncGenerator<ChatStreamEvent>,
): Promise<ChatStreamEvent[]> => {
	const seen: ChatStreamEvent[] = [];
	for await (const event of stream) seen.push(event);
	return seen;
};

describe("runChatToolLoop", () => {
	/**
	 * A turn must not end on an unreadable argument. Truncated streams are common, and the right
	 * response is to tell the model the fact so it calls again, not to end the turn after body text
	 * has already streamed. Tools do not run; one sentence stands in their place.
	 */
	it("unreadable arguments round-trip and return one sentence", async () => {
		const { port, sent, ran } = scriptedPort([
			[
				{ type: "delta", text: "주사위를 집었다." },
				{
					type: "tool_call",
					call: { id: "toolu_1", name: "dice", arguments: null },
				},
				{ type: "done", finishReason: "tool_use" },
			],
			[{ type: "delta", text: " 다시 굴린다." }, { type: "done" }],
		]);
		const seen = await drain(runChatToolLoop(request, port));

		expect(ran).toEqual([]);
		expect(sent).toHaveLength(2);
		const result = sent[1]?.messages.at(-1);
		expect(result?.role).toBe("tool");
		expect(result?.content).toContain("읽지 못했습니다");
		/**
		 * The neutral request carries the facts as they are, including the fact that the arguments were
		 * unreadable. Turning that into an empty object is the job of an adapter that knows the upstream
		 * shape (`blocksOf`, `partsOf`).
		 */
		const assistant = sent[1]?.messages.at(-2);
		expect(
			assistant?.role === "assistant" && assistant.toolCall?.arguments,
		).toBeNull();
		expect(seen.filter((event) => event.type === "error")).toEqual([]);
		expect(seen.at(-1)?.type).toBe("done");
	});

	/** With no tools, this function is a pass-through. It attaches no declarations. */
	it("without tools one request passes through as is", async () => {
		const sent: ChatGenerationRequest[] = [];
		const seen = await drain(
			runChatToolLoop(request, {
				stream(sentRequest) {
					sent.push(sentRequest);
					return events({ type: "delta", text: "안녕" }, { type: "done" });
				},
				tools: [],
				isValid: () => true,
				signal: new AbortController().signal,
			}),
		);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.tools).toEqual(request.tools);
		expect(seen).toEqual([{ type: "delta", text: "안녕" }, { type: "done" }]);
	});

	it("declarations ride from registration: they arrive even if the assembler sends none", async () => {
		const { port, sent } = scriptedPort([[{ type: "done" }]]);
		await drain(runChatToolLoop({ ...request, tools: [] }, port));
		expect(sent[0]?.tools.map((tool) => tool.name)).toEqual(["dice"]);
	});

	/**
	 * The terminal event is emitted once, however many round trips there are. A middle `done` leaking
	 * out would let the caller finalize the message early and lose what follows.
	 */
	it("one completion however many round trips", async () => {
		const { port, sent, ran } = scriptedPort([
			[
				{ type: "delta", text: "그는 주사위를 집었다." },
				callFrame("toolu_1", { sides: 20 }),
				{ type: "done", finishReason: "tool_use" },
			],
			[
				{ type: "delta", text: " 17이 나왔다." },
				{ type: "done", finishReason: "end_turn" },
			],
		]);
		const seen = await drain(runChatToolLoop(request, port));

		expect(sent).toHaveLength(2);
		expect(ran).toEqual([{ sides: 20 }]);
		expect(seen.filter((event) => event.type === "done")).toEqual([
			{ type: "done", finishReason: "end_turn" },
		]);
		expect(
			seen
				.filter((event) => event.type === "delta")
				.map((event) => event.text)
				.join(""),
		).toBe("그는 주사위를 집었다. 17이 나왔다.");
		/** Call frames do not leave this loop. The loop is their only consumer. */
		expect(seen.some((event) => event.type === "tool_call")).toBe(false);
	});

	it("body and results join the next request's history", async () => {
		const { port, sent } = scriptedPort([
			[
				{ type: "delta", text: "집었다." },
				callFrame("toolu_1", { sides: 20 }),
				{ type: "done" },
			],
			[{ type: "done" }],
		]);
		await drain(runChatToolLoop(request, port));
		const messages = sent[1]?.messages ?? [];
		expect(messages).toHaveLength(3);
		expect(messages[1]).toMatchObject({
			role: "assistant",
			content: "집었다.",
			toolCall: { id: "toolu_1" },
		});
		expect(messages[2]).toMatchObject({ role: "tool", callId: "toolu_1" });
		expect(messages[2]?.content).toContain("17");
	});

	/**
	 * The caller overwrites with the last value, so without summing, the stored token count would keep
	 * only the last request's.
	 */
	it("sums usage across all round trips and emits it once", async () => {
		const { port } = scriptedPort([
			[
				callFrame("toolu_1", { sides: 20 }),
				{
					type: "usage",
					model: "claude-sonnet-5",
					inputTokens: 100,
					outputTokens: 10,
				},
				{ type: "done" },
			],
			[{ type: "usage", inputTokens: 150, outputTokens: 30 }, { type: "done" }],
		]);
		const seen = await drain(runChatToolLoop(request, port));
		expect(seen.filter((event) => event.type === "usage")).toEqual([
			{
				type: "usage",
				model: "claude-sonnet-5",
				inputTokens: 250,
				outputTokens: 40,
			},
		]);
	});

	/**
	 * Termination is structure, not counting. The next request after the last allowed round trip has
	 * no tool to call, so the loop ends even if the model calls a tool every time.
	 */
	it("ends at the cap even when the model calls a tool every time", async () => {
		const scripts = Array.from({ length: 10 }, (_, index) => [
			{ type: "delta" as const, text: "찾아볼게." },
			callFrame(`toolu_${index}`, { sides: 20 }),
			{ type: "done" as const },
		]);
		const { port, sent } = scriptedPort(scripts);
		const seen = await drain(runChatToolLoop(request, port));
		expect(sent).toHaveLength(CHAT_MAX_TOOL_ROUND_TRIPS + 1);
		expect(sent.at(-1)?.tools).toEqual([]);

		/**
		 * That turn is not complete. For a while this spot was a silent `done`, so a response that
		 * stopped mid-sentence was saved as complete with no mark at all, and even `Continue` did not
		 * appear, since nothing marked the tail as open. A tool call returned to a request that withheld
		 * tools means upstream ignored our declaration, which is a provider failure.
		 */
		expect(seen.at(-1)).toMatchObject({ type: "error" });
		expect(seen.some((event) => event.type === "done")).toBe(false);
		// What was already streamed stays streamed. The caller saves it as unfinished.
		expect(seen.some((event) => event.type === "delta")).toBe(true);
	});

	/**
	 * Tokens reported by the round trips are not lost, even in a turn that ended in an error or abort.
	 */
	it("usage goes out before the error even when ending on an unanswerable call", async () => {
		const scripts = Array.from({ length: 10 }, (_, index) => [
			callFrame(`toolu_${index}`, { sides: 20 }),
			{ type: "usage" as const, inputTokens: 10, outputTokens: 2 },
			{ type: "done" as const },
		]);
		const { port } = scriptedPort(scripts);
		const seen = await drain(runChatToolLoop(request, port));
		const usage = seen.filter((event) => event.type === "usage");
		expect(usage).toHaveLength(1);
		expect(usage[0]).toMatchObject({
			inputTokens: 10 * (CHAT_MAX_TOOL_ROUND_TRIPS + 1),
			outputTokens: 2 * (CHAT_MAX_TOOL_ROUND_TRIPS + 1),
		});
		expect(seen.at(-1)).toMatchObject({ type: "error" });
	});

	/**
	 * Even if the loop stops here, the body up to this round trip has already been emitted. Whether to
	 * save it is the caller's decision.
	 */
	it("sends no next request after leaving the room", async () => {
		const { port, sent, ran } = scriptedPort(
			[
				[
					{ type: "delta", text: "집었다." },
					callFrame("toolu_1", { sides: 20 }),
					{ type: "done" },
				],
				[{ type: "done" }],
			],
			{ isValid: () => false },
		);
		const seen = await drain(runChatToolLoop(request, port));
		expect(sent).toHaveLength(1);
		expect(ran).toEqual([]);
		expect(seen.at(-1)?.type).toBe("done");
		expect(seen.some((event) => event.type === "delta")).toBe(true);
	});

	/** The thrown value is not read, because the resulting sentence becomes the model's input. */
	it("turns a throwing handler into a result sentence and keeps going", async () => {
		const { port, sent, tool } = scriptedPort([
			[callFrame("toolu_1", { sides: 20 }), { type: "done" }],
			[{ type: "done" }],
		]);
		const throwing: ChatTool = {
			...tool,
			run: async () => {
				throw new Error("sk-live-secret 이 섞인 저장소 오류");
			},
		};
		await drain(
			runChatToolLoop(request, {
				...port,
				tools: [throwing],
				stream: port.stream,
			}),
		);
		const result = sent[1]?.messages.at(-1);
		expect(result?.content).toContain("dice");
		expect(result?.content).not.toContain("sk-live-secret");
	});

	/** A missing tool is a fact to tell the model, not an error. It does not stop the loop. */
	it("returns an answer and continues when a missing tool is called", async () => {
		const { port, sent } = scriptedPort([
			[
				{
					type: "tool_call",
					call: { id: "toolu_1", name: "summon", arguments: {} },
				},
				{ type: "done" },
			],
			[{ type: "done" }],
		]);
		await drain(runChatToolLoop(request, port));
		expect(sent).toHaveLength(2);
		expect(sent[1]?.messages.at(-1)?.content).toContain("summon");
	});

	/**
	 * An error frame is passed through and the loop stops. Nothing is thrown, because text already
	 * emitted must still be saved by the caller.
	 */
	it("streams an error frame as is and stops", async () => {
		const { port, sent } = scriptedPort([
			[
				{ type: "delta", text: "집었다." },
				{ type: "error", code: "chat_provider_failed", message: "실패" },
			],
			[{ type: "done" }],
		]);
		const seen = await drain(runChatToolLoop(request, port));
		expect(sent).toHaveLength(1);
		expect(seen.at(-1)).toEqual({
			type: "error",
			code: "chat_provider_failed",
			message: "실패",
		});
	});

	/**
	 * A failed turn still carries usage. The caller decides saving on the terminal frame, so dropping
	 * usage here would save only failed turns without usage. Under managed billing those round trips
	 * were already charged, so the usage table would miss exactly those turns. The error is silent and
	 * always makes the total smaller than the real amount.
	 */
	it("collected usage goes out before the error even when failing mid round trip", async () => {
		const { port } = scriptedPort([
			[
				{ type: "delta", text: "찾는다." },
				{ type: "usage", inputTokens: 100, outputTokens: 20 },
				callFrame("toolu_9", { sides: 20 }),
				{ type: "done", finishReason: "tool_calls" },
			],
			[
				{ type: "delta", text: "이어 쓴다." },
				{ type: "usage", inputTokens: 140, outputTokens: 30 },
				{ type: "error", code: "chat_provider_failed", message: "실패" },
			],
		]);
		const seen = await drain(runChatToolLoop(request, port));
		expect(seen.at(-2)).toEqual({
			type: "usage",
			inputTokens: 240,
			outputTokens: 50,
		});
		expect(seen.at(-1)).toMatchObject({ type: "error" });
	});
});
