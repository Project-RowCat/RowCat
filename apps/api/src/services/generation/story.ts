import { buildChatGenerationRequest } from "@rowcat/chat/context";
import {
	applyPlatformSafetyPolicy,
	conversationSafetyPolicy,
} from "@rowcat/chat/guards";
import { storyAssemblyInput } from "@rowcat/chat/protected-generation";
import { chatToolDeclarations } from "@rowcat/chat/tool";
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
	readonly tools: ReturnType<typeof chatConversationTools>;
	readonly model: StoryChatGenerationRequest["model"];
}

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
	const base: ChatGenerationRequest = {
		...assembled,
		system: applyPlatformSafetyPolicy(assembled.system, {
			...conversationSafetyPolicy(assembled.context),
			allAges: input.allAges,
			enabled: input.promptGuardsEnabled,
		}),
	};

	// Same registration as the device (`chatConversationTools`); only the seed read is the server's. A
	// story with no lore yields an empty array and the loop passes one request through.
	const tools = chatConversationTools({ seed: input.seed });
	// Must equal what `runChatToolLoop` sends in its first round (it layers declarations the same
	// way); otherwise the pre-started stream answers a different request than the loop assumes.
	const firstRequest: ChatGenerationRequest = tools.length
		? { ...base, tools: chatToolDeclarations(tools) }
		: base;
	return {
		base,
		firstRequest: { ...firstRequest, model: input.request.model },
		tools,
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
	const { base, firstRequest, tools, model } = input.assembled;
	const managed = (
		request: ChatGenerationRequest,
	): ManagedChatGenerationRequest => ({
		...request,
		model,
	});

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
