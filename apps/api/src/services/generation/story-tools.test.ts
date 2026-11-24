import { ABSOLUTE_GUARD } from "@rowcat/chat/guards";
import {
	type ChatStreamEvent,
	type ManagedChatGenerationRequest,
	StoryChatGenerationRequest,
	StoryChatSeedDto,
} from "@rowcat/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagedGenerationCall } from "./budget.ts";
import {
	assembleProtectedStoryGeneration,
	type StoryGenerationBudget,
	startProtectedStoryGeneration,
} from "./story.ts";

/**
 * Creator tools in a prompt-protected room. The device never sees that room's seed
 * (`projectProtectedSeed` blanks `tools`), so the server's loop is the only place they run. This
 * file drives the service directly, with a fake budget and a stubbed upstream, so it needs no
 * database; `routes/chat-story.test.ts` covers the same round trips through the route.
 */

afterEach(() => {
	vi.restoreAllMocks();
});

const sse = (frames: string[]): Response =>
	new Response(
		[...frames.map((frame) => `data: ${frame}\n\n`), "data: [DONE]\n\n"].join(
			"",
		),
		{ status: 200, headers: { "content-type": "text/event-stream" } },
	);

const text = (content: string) =>
	sse([
		JSON.stringify({
			choices: [{ delta: { content }, finish_reason: "stop" }],
		}),
	]);

const callTool = (name: string, args: Record<string, unknown>) =>
	sse([
		JSON.stringify({
			choices: [
				{
					delta: {
						tool_calls: [
							{
								index: 0,
								id: "call_0",
								function: { name, arguments: JSON.stringify(args) },
							},
						],
					},
				},
			],
		}),
		'{"choices":[{"finish_reason":"tool_calls"}]}',
	]);

type UpstreamBody = {
	messages: { role: string; content: unknown }[];
	tools?: unknown[];
};

function upstream(responses: (() => Response)[]): () => UpstreamBody[] {
	const bodies: UpstreamBody[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
		bodies.push(JSON.parse(String(init?.body)));
		const next = responses[bodies.length - 1] ?? (() => text("Yes"));
		return next();
	});
	return () => bodies;
}

const systemOf = (body: UpstreamBody): string => {
	const content = body.messages.find(
		(message) => message.role === "system",
	)?.content;
	if (typeof content === "string") return content;
	return Array.isArray(content)
		? content.map((part: { text: string }) => part.text).join("")
		: "";
};

/** A budget that admits everything and remembers what it admitted. */
function fakeBudget(): {
	budget: StoryGenerationBudget;
	admitted: ManagedChatGenerationRequest[];
} {
	const call = (): ManagedGenerationCall => ({
		meter: (events) => events,
		abandon: async () => {},
	});
	const admitted: ManagedChatGenerationRequest[] = [];
	return {
		admitted,
		budget: {
			first: call(),
			admit: async (request) => {
				admitted.push(request);
				return call();
			},
		},
	};
}

async function run(tools: unknown[], responses: (() => Response)[]) {
	const bodies = upstream(responses);
	const seed = StoryChatSeedDto.parse({
		version: 1,
		storyId: "story",
		title: "Story",
		adult: false,
		promptProtected: true,
		scenario: "SCENARIO_MARKER A harbor city in the rain.",
		firstScene: "Opening",
		tools,
	});
	const request = StoryChatGenerationRequest.parse({
		model: "claude-sonnet-5",
		messages: [{ role: "user", speaker: "Ray", content: "Hello there" }],
	});
	const assembled = assembleProtectedStoryGeneration({
		seed,
		request,
		allAges: true,
		promptGuardsEnabled: true,
	});
	const { budget, admitted } = fakeBudget();
	const stream = await startProtectedStoryGeneration({
		assembled,
		signal: new AbortController().signal,
		budget,
	});
	const events: ChatStreamEvent[] = [];
	for await (const event of stream) events.push(event);
	return { bodies: bodies(), events, admitted, assembled };
}

describe("creator tools on the server's protected loop", () => {
	it("runs a template tool and returns its filled text as the result", async () => {
		const { bodies, events, assembled } = await run(
			[
				{
					declaration: {
						name: "harbor_weather",
						description: "The weather at a place in the harbor city.",
						parameters: [{ name: "place", type: "string", required: true }],
					},
					action: {
						kind: "template",
						template: "TEMPLATE_MARKER Rain over {{place}}.",
					},
				},
			],
			[
				() => callTool("harbor_weather", { place: "the pier" }),
				() => text("Yes"),
			],
		);

		// Declared on the first request, the one sent before the loop takes over.
		expect(JSON.stringify(assembled.firstRequest.tools)).toContain(
			"harbor_weather",
		);
		expect(bodies).toHaveLength(2);
		expect(JSON.stringify(bodies[0].tools)).toContain("harbor_weather");
		expect(JSON.stringify(bodies[1].messages)).toContain(
			"TEMPLATE_MARKER Rain over the pier.",
		);
		expect(events.some((event) => event.type === "tool_call")).toBe(false);
		expect(events.at(-1)).toMatchObject({ type: "done" });
	});

	it("runs a sub-agent as its own admitted, guarded, tool-less call", async () => {
		const { bodies, events, admitted } = await run(
			[
				{
					declaration: {
						name: "oracle",
						description: "Asks the harbor oracle a question.",
						parameters: [{ name: "question", type: "string", required: true }],
					},
					action: {
						kind: "agent",
						system: "AGENT_SYSTEM_MARKER You are the harbor oracle.",
						maxOutputTokens: 256,
					},
				},
			],
			[
				() => callTool("oracle", { question: "When is high tide?" }),
				() => text("AGENT_ANSWER_MARKER At dusk."),
				() => text("Yes"),
			],
		);

		expect(bodies).toHaveLength(3);
		const agent = bodies[1];
		// The agent's own prompt, wrapped in the conversation's platform guard.
		const system = systemOf(agent);
		expect(system).toContain("AGENT_SYSTEM_MARKER");
		expect(system.startsWith(ABSOLUTE_GUARD)).toBe(true);
		// It sees what the model passed, nothing of the manuscript or the conversation.
		expect(JSON.stringify(agent)).not.toContain("SCENARIO_MARKER");
		expect(JSON.stringify(agent)).not.toContain("Hello there");
		expect(JSON.stringify(agent.messages)).toContain("When is high tide?");
		// One level deep.
		expect(agent.tools ?? []).toHaveLength(0);
		// The agent's text is the next round's tool result.
		expect(JSON.stringify(bodies[2].messages)).toContain(
			"AGENT_ANSWER_MARKER At dusk.",
		);

		// The agent went through the budget's door like the later round did: two admits, the agent's
		// first (with its own output cap), then the conversation's second round.
		expect(admitted).toHaveLength(2);
		expect(admitted[0].system).toContain("AGENT_SYSTEM_MARKER");
		expect(admitted[0].maxOutputTokens).toBe(256);
		expect(admitted[0].model).toBe("claude-sonnet-5");

		expect(events.some((event) => event.type === "tool_call")).toBe(false);
		expect(events.at(-1)).toMatchObject({ type: "done" });
	});

	it("a failed sub-agent becomes the fixed tool-error result and the turn goes on", async () => {
		const { bodies, events } = await run(
			[
				{
					declaration: {
						name: "oracle",
						description: "Asks the harbor oracle a question.",
					},
					action: {
						kind: "agent",
						system: "AGENT_SYSTEM_MARKER",
						maxOutputTokens: 256,
					},
				},
			],
			[
				() => callTool("oracle", {}),
				() => new Response("UPSTREAM_SECRET boom", { status: 500 }),
				() => text("Yes"),
			],
		);

		expect(bodies).toHaveLength(3);
		// The upstream's words never become model input.
		expect(JSON.stringify(bodies[2].messages)).not.toContain("UPSTREAM_SECRET");
		expect(events.at(-1)).toMatchObject({ type: "done" });
	});
});
