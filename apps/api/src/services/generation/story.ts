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
export async function startProtectedStoryGeneration(input: {
	seed: StoryChatSeedDto;
	request: StoryChatGenerationRequest;
	allAges: boolean;
	signal: AbortSignal;
}): Promise<AsyncGenerator<ChatStreamEvent>> {
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
	const managed = (
		request: ChatGenerationRequest,
	): ManagedChatGenerationRequest => ({
		...request,
		model: input.request.model,
	});

	const first = await startChatGeneration(managed(firstRequest), input.signal);

	let rounds = 0;
	return runChatToolLoop(base, {
		tools,
		signal: input.signal,
		isValid: () => !input.signal.aborted,
		stream: (request) => {
			rounds += 1;
			return rounds === 1 ? first : laterRound(managed(request), input.signal);
		},
	});
}

/**
 * Second round onward: the 200 is already out, so failures are frames. The error envelope's code is
 * carried through; folding missing provider config into an upstream failure would make the screen
 * offer `Regenerate`, which stalls at the same place.
 */
async function* laterRound(
	request: ManagedChatGenerationRequest,
	signal: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
	let events: AsyncGenerator<ChatStreamEvent>;
	try {
		events = await startChatGeneration(request, signal);
	} catch (error) {
		if (!(error instanceof ApiError)) throw error;
		yield { type: "error", code: error.code, message: error.message };
		return;
	}
	yield* events;
}
