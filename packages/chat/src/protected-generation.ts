import type {
	ChatGenerationRequest,
	StoryChatGenerationRequest,
	StoryChatGenerationRequestInput,
	StoryChatSeedDto,
} from "@rowcat/contracts/chat";
import {
	type BuildChatGenerationRequestInput,
	buildChatGenerationRequest,
	buildChatGenerationRequestTraced,
} from "./context.ts";
import type { ChatPromptTrace } from "./prompt-trace.ts";

/**
 * Where this turn's prompt is assembled. One value per conversation. assembled: the device
 * assembles. Used for normal rooms, work tests and legacy-migrated rooms. story: the server
 * assembles. Used for rooms with a protected prompt, where the device never has the seed. The
 * generation hook takes this one value and passes it to the router. If an 'if protected' branch
 * appeared inside the hook, web and mobile would each carry it, and one app forgetting it would
 * silently assemble a protected conversation from an empty seed, degrading quality without an
 * error. The split is set only when the room's promptProtected flag and its origin story are both
 * present (`ConversationSession.protectedStoryId`). Legacy-migrated rooms have no origin story, and
 * their manuscript is already on the device, so the device keeps assembling them.
 */
export type ChatGenerationPlan =
	| {
			kind: "assembled";
			request: ChatGenerationRequest;
			/** Set only for conversations with the inspector turned on. */
			trace: ChatPromptTrace | null;
	  }
	| {
			kind: "story";
			storyId: string;
			/**
			 * The model and billing identity are attached by the transport layer, the same place managed
			 * transport uses.
			 */
			request: StoryChatAssemblyRequest;
	  };

/**
 * The story to assemble on the server for this room's turns, if any. Both conditions must hold.
 * promptProtected alone would send legacy-migrated rooms, which have no origin story, a request
 * with nowhere to go. An origin story alone would move rooms of unprotected works onto the server
 * path and follow their republishing. Both the web and mobile room adapters call this same
 * function.
 */
export function protectedStoryIdOf(room: {
	promptProtected: boolean;
	originStoryId: string | null;
}): string | undefined {
	return room.promptProtected && room.originStoryId
		? room.originStoryId
		: undefined;
}

/**
 * The device's share of the request: the contract's type minus the model field, which transport
 * adds.
 */
export type StoryChatAssemblyRequest = Omit<
	StoryChatGenerationRequestInput,
	"model"
>;

export function planChatGeneration(input: {
	assembly: BuildChatGenerationRequestInput;
	/**
	 * The story whose prompt the server must assemble for this conversation; `null` when the device
	 * assembles it.
	 */
	protectedStoryId: string | null;
	/** Whether the inspector is on. Only meaningful for device assembly. */
	trace: boolean;
}): ChatGenerationPlan {
	if (input.protectedStoryId)
		return {
			kind: "story",
			storyId: input.protectedStoryId,
			request: storyChatAssemblyRequest(input.assembly),
		};
	if (input.trace) {
		const traced = buildChatGenerationRequestTraced(input.assembly);
		return { kind: "assembled", request: traced.request, trace: traced.trace };
	}
	return {
		kind: "assembled",
		request: buildChatGenerationRequest(input.assembly),
		trace: null,
	};
}

/**
 * Assembly input to server assembly request. It does not carry the seed or the final rating. The
 * seed is absent on this device for a newly created protected room, or present but not trusted for
 * a copy from before this change. The server assembles from the currently published version either
 * way. The rating is sent only as a request value; the server decides the final rating from the
 * work's rating and the user's membership. An absent axis gets no key. Writing `undefined` would
 * make the optional contract field unable to tell 'none' from 'not specified', and an empty value
 * would go out to the server's assembly input.
 */
export function storyChatAssemblyRequest(
	input: BuildChatGenerationRequestInput,
): StoryChatAssemblyRequest {
	const { room } = input;
	return {
		messages: input.messages.map(({ role, speaker, content }) => ({
			role,
			speaker,
			content,
		})),
		...(input.userInput !== undefined ? { userInput: input.userInput } : {}),
		memories: (input.memories ?? []).map(
			({ id, content, pinned, source, updatedAt }) => ({
				id,
				content,
				pinned,
				source,
				updatedAt,
			}),
		),
		...(input.summary !== undefined ? { summary: input.summary } : {}),
		room: {
			...(room.persona !== undefined ? { persona: room.persona } : {}),
			...(room.userNote !== undefined ? { userNote: room.userNote } : {}),
			...(room.intensity !== undefined ? { intensity: room.intensity } : {}),
		},
		characters: (input.characters ?? []).map(({ name, prompt }) => ({
			name,
			prompt,
		})),
		...(input.narration !== undefined ? { narration: input.narration } : {}),
		...(input.maxOutputTokens !== undefined
			? { maxOutputTokens: input.maxOutputTokens }
			: {}),
		...(input.reasoningEffort !== undefined
			? { reasoningEffort: input.reasoningEffort }
			: {}),
		continuation: input.continuation === true,
		...(input.routingSessionId
			? { routingSessionId: input.routingSessionId }
			: {}),
		requestedMode: input.allAges ? "all-ages" : "adult",
	};
}

/**
 * The mirror of the function above: server assembly request plus the currently published seed,
 * producing assembly input. The server calls this. The two functions share one file because the
 * round trip must reach the same prompt; the test compares them by value. An axis added to only one
 * side would silently vanish from the server path only, and the symptom would be 'I changed the
 * setting and the response did not change'. The rating (`allAges`) is the value the server decided.
 * The request's rating is only an upper bound.
 */
export function storyAssemblyInput(input: {
	seed: StoryChatSeedDto;
	request: StoryChatGenerationRequest;
	allAges: boolean;
}): BuildChatGenerationRequestInput {
	const { request } = input;
	return {
		room: {
			seed: input.seed,
			...(request.room.persona !== undefined
				? { persona: request.room.persona }
				: {}),
			...(request.room.userNote !== undefined
				? { userNote: request.room.userNote }
				: {}),
			...(request.room.intensity !== undefined
				? { intensity: request.room.intensity }
				: {}),
		},
		messages: request.messages,
		...(request.userInput !== undefined
			? { userInput: request.userInput }
			: {}),
		memories: request.memories,
		...(request.summary !== undefined ? { summary: request.summary } : {}),
		allAges: input.allAges,
		...(request.maxOutputTokens !== undefined
			? { maxOutputTokens: request.maxOutputTokens }
			: {}),
		reasoningEffort: request.reasoningEffort,
		...(request.continuation ? { continuation: true } : {}),
		...(request.routingSessionId
			? { routingSessionId: request.routingSessionId }
			: {}),
		...(request.narration !== undefined
			? { narration: request.narration }
			: {}),
		characters: request.characters,
	};
}
