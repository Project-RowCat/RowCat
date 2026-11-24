import { buildChatGenerationRequest } from "@rowcat/chat/context";
import {
	applyPlatformSafetyPolicy,
	conversationSafetyPolicy,
	type PlatformSafetyPolicy,
} from "@rowcat/chat/guards";
import { storyAssemblyInput } from "@rowcat/chat/protected-generation";
import { type ChatTool, chatToolDeclarations } from "@rowcat/chat/tool";
import { type ChatAgentRun, chatAgentRequest } from "@rowcat/chat/tool-custom";
import { runChatToolLoop } from "@rowcat/chat/tool-loop";
import { chatConversationTools } from "@rowcat/chat/tool-registry";
import type {
	ChatGenerationRequest,
	ChatStreamEvent,
	ManagedChatGenerationRequest,
	StoryChatGenerationRequest,
	StoryChatSeedDto,
} from "@rowcat/contracts";
import { ApiError } from "../../lib/errors.ts";
import type { ManagedGenerationCall } from "./budget.ts";
import { startChatGeneration } from "./chat.ts";

/**
 * Generation for prompt-protected stories: the server assembles the request and runs the tool round
 * trips. The protected creative prompt never reaches the device (`projectProtectedSeed`), so the
 * device can neither build the system prompt nor run the lore search tool; both move here. Nothing
 * new is built: assembly, guards, the tool loop and the upstream call are the same functions the
 * device and ordinary managed generation use. A second assembler on the server would let the two
 * paths diverge, and that would show up only as response quality.
 *
 * The server still stores no conversation: history, memories and summary arrive as arguments and
 * vanish with the response, and nothing is logged.
 *
 * The first round trip starts before the 200 so that missing provider config (503), unknown model
 * (400) and upstream failure (502) leave as the shared error envelope (same as `routes/chat.ts`),
 * which lets the screen pick guidance by reason. The loop receives that stream as its first round;
 * failures from the second round on arrive after the 200 and are reported as frames.
 */
/**
 * The assembled request, before anything is sent. Split from the start so the route can weigh what
 * it is about to send (the instance budget, `budget.ts`) between assembling it and sending it.
 */
export interface AssembledStoryGeneration {
	readonly base: ChatGenerationRequest;
	readonly firstRequest: ManagedChatGenerationRequest;
	/**
	 * The seed the tools are registered from. The tools themselves are built again when the turn
	 * starts (`storyTools`), because a sub-agent tool runs through the instance budget, and that does
	 * not exist yet at assembly time.
	 */
	readonly seed: StoryChatSeedDto;
	/**
	 * The platform policy `base.system` was wrapped with. A sub-agent's system prompt is wrapped with
	 * the same one (`agentRequest`).
	 */
	readonly policy: PlatformSafetyPolicy;
	readonly model: StoryChatGenerationRequest["model"];
}

/**
 * Runs one sub-agent and returns its whole text. Absent only while assembling, when nothing runs.
 */
type StoryAgentRunner = (
	run: ChatAgentRun,
	signal: AbortSignal,
) => Promise<string>;

/**
 * This room's tools: the device's registration (`chatConversationTools`), with the ports the server
 * can offer. Randomness for tables, and a sub-agent runner. No `fetch`: `http` is not in a
 * creator's vocabulary, and this loop never runs a user's tools (the device holds those).
 *
 * The agent port is always present, even at assembly time where it would never be called, because
 * port presence decides which tools are registered (`chatCustomTool`). Assembly and the loop must
 * register the same set, or the pre-started first stream would answer a request with different
 * declarations than the loop's later rounds.
 */
function storyTools(
	seed: StoryChatSeedDto,
	runAgent: StoryAgentRunner,
): ChatTool[] {
	return chatConversationTools(
		{ seed },
		{ ports: { random: Math.random, runAgent } },
	);
}

const notStarted: StoryAgentRunner = () =>
	Promise.reject(new Error("story generation has not started"));

export function assembleProtectedStoryGeneration(input: {
	seed: StoryChatSeedDto;
	request: StoryChatGenerationRequest;
	allAges: boolean;
	promptGuardsEnabled: boolean;
}): AssembledStoryGeneration {
	const assembled = buildChatGenerationRequest(
		storyAssemblyInput({
			seed: input.seed,
			request: input.request,
			allAges: input.allAges,
		}),
	);
	const policy: PlatformSafetyPolicy = {
		...conversationSafetyPolicy(assembled.context),
		allAges: input.allAges,
		enabled: input.promptGuardsEnabled,
	};
	const base: ChatGenerationRequest = {
		...assembled,
		system: applyPlatformSafetyPolicy(assembled.system, policy),
	};

	// Same registration as the device (`chatConversationTools`); only the seed read is the server's. A
	// story with no lore and no creator tools yields an empty array and the loop passes one request
	// through.
	const tools = storyTools(input.seed, notStarted);
	// Must equal what `runChatToolLoop` sends in its first round (it layers declarations the same
	// way); otherwise the pre-started stream answers a different request than the loop assumes.
	const firstRequest: ChatGenerationRequest = tools.length
		? { ...base, tools: chatToolDeclarations(tools) }
		: base;
	return {
		base,
		firstRequest: { ...firstRequest, model: input.request.model },
		seed: input.seed,
		policy,
		model: input.request.model,
	};
}

/**
 * The instance budget as this service sees it (`budget.ts`): the first call already admitted, and a
 * door every later call goes through right before it is sent.
 */
export interface StoryGenerationBudget {
	readonly first: ManagedGenerationCall;
	admit(request: ManagedChatGenerationRequest): Promise<ManagedGenerationCall>;
}

export async function startProtectedStoryGeneration(input: {
	assembled: AssembledStoryGeneration;
	signal: AbortSignal;
	budget: StoryGenerationBudget;
}): Promise<AsyncGenerator<ChatStreamEvent>> {
	const { base, firstRequest, seed, policy, model } = input.assembled;
	const managed = (
		request: ChatGenerationRequest,
	): ManagedChatGenerationRequest => ({
		...request,
		model,
	});
	const tools = storyTools(seed, (run, signal) =>
		runStoryAgent(
			managed(agentRequest(run, base, policy)),
			signal,
			input.budget,
		),
	);

	const first = await startChatGeneration(firstRequest, input.signal);

	let rounds = 0;
	return runChatToolLoop(base, {
		tools,
		signal: input.signal,
		isValid: () => !input.signal.aborted,
		stream: (request) => {
			rounds += 1;
			return rounds === 1
				? input.budget.first.meter(first)
				: laterRound(managed(request), input.signal, input.budget);
		},
	});
}

/**
 * Second round onward: the 200 is already out, so failures are frames. The error envelope's code is
 * carried through; folding missing provider config into an upstream failure would make the screen
 * offer `Regenerate`, which stalls at the same place.
 *
 * The budget answers first, on this round's own request: one that grew past the per-call ceiling or
 * finds the instance budget spent is not sent, and the turn ends on that refusal's code (the loop
 * emits the usage gathered so far, then the error). Nothing is left half-open: the tool result that
 * would wait for an answer rides on the very request that is not sent.
 */
async function* laterRound(
	request: ManagedChatGenerationRequest,
	signal: AbortSignal,
	budget: StoryGenerationBudget,
): AsyncGenerator<ChatStreamEvent> {
	let call: ManagedGenerationCall;
	try {
		call = await budget.admit(request);
	} catch (error) {
		if (!(error instanceof ApiError)) throw error;
		yield { type: "error", code: error.code, message: error.message };
		return;
	}
	let events: AsyncGenerator<ChatStreamEvent>;
	try {
		events = await startChatGeneration(request, signal);
	} catch (error) {
		await call.abandon();
		if (!(error instanceof ApiError)) throw error;
		yield { type: "error", code: error.code, message: error.message };
		return;
	}
	yield* call.meter(events);
}

/**
 * A sub-agent's request (`chatAgentRequest`), with its system prompt wrapped in the conversation's
 * platform policy. Every managed request is wrapped on this server (`routes/chat.ts`), and a device
 * running the same agent over the managed path gets exactly this; an agent sent bare would be the
 * one request on the operator's key with no guard, under a system prompt a creator wrote.
 */
function agentRequest(
	run: ChatAgentRun,
	base: ChatGenerationRequest,
	policy: PlatformSafetyPolicy,
): ChatGenerationRequest {
	const request = chatAgentRequest(run, base);
	return {
		...request,
		system: applyPlatformSafetyPolicy(request.system, policy),
	};
}

/**
 * One sub-agent run on the managed connection, to its last frame. It goes through the same door as
 * the loop's later rounds (`budget.admit`, then metered), because it is one more upstream call on
 * the operator's key inside the same response: skipping the door would let a creator's tool spend
 * past the instance ceiling the main turn is held to.
 *
 * Failures are thrown, not returned as text. The loop turns a throw into its fixed tool-error
 * sentence (`chatToolErrorText`) and never reads the thrown value, so an upstream message cannot
 * become model input, and the turn itself goes on.
 */
async function runStoryAgent(
	request: ManagedChatGenerationRequest,
	signal: AbortSignal,
	budget: StoryGenerationBudget,
): Promise<string> {
	const call = await budget.admit(request);
	let events: AsyncGenerator<ChatStreamEvent>;
	try {
		events = await startChatGeneration(request, signal);
	} catch (error) {
		await call.abandon();
		throw error;
	}
	let text = "";
	for await (const event of call.meter(events)) {
		if (event.type === "delta") text += event.text;
		else if (event.type === "error")
			throw new Error(`sub-agent failed: ${event.code}`);
	}
	return text;
}
