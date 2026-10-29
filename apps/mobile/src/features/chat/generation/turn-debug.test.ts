import type {
	ChatGenerationPlan,
	ChatRoom,
	ChatStore,
	ConversationSession,
	GenerationPreferenceStore,
	GenerationTarget,
} from "@rowcat/chat";
import {
	createConversationDebugStore,
	latestTurn,
	turnForMessage,
} from "@rowcat/chat";
import type { ChatGenerationRequest, ChatStreamEvent } from "@rowcat/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GenerationTransport } from "../../../lib/generation/transport.ts";
import type { LocalScopeController } from "../../../lib/local-data/activation.ts";
import { seed } from "../../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../../test/sqlite-node.ts";
import { createChatConversation } from "../chat-conversation.ts";
import { runGenerationTurn } from "./turn.ts";

/** A transport that only receives the device-assembled plan; these tests do not exercise the server assembly path of protected works. */
const viaTransport =
	(createTransport: (target: GenerationTarget) => GenerationTransport) =>
	(
		plan: ChatGenerationPlan,
		target: GenerationTarget,
		options: { signal: AbortSignal },
	) => {
		if (plan.kind !== "assembled")
			throw new Error("handles only the device assembly plan");
		return createTransport(target).stream(plan.request, options);
	};

/**
 * Turning instrumentation on does not change execution, checked on real SQLite and the real
 * assembler.
 *
 * One assertion: a turn given a sink and a turn without one send the same request and store the
 * same thing. The structure already guards half of that (both assembly functions go through one
 * implementation); this covers the other half, where the lifecycle inserting signals shakes the
 * order or throws extra on only one side of a failure path.
 *
 * Checked on the pure turn because mobile's turn runs without React. Web keeps the same rule in its
 * hook, and value-level checks of the rule live in `@rowcat/chat`'s assembler tests.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let chat: ChatStore;
let room: ChatRoom;
let session: ConversationSession;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	const scope = await controller.activate("alice");
	chat = scope.stores.chat;
	room = await chat.createRoom({
		originStoryId: "story-1",
		seed: seed("The Night Library"),
	});
	session = createChatConversation({
		room,
		store: chat,
		token: chat,
		preferences: null,
	});
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

const delta = (text: string): ChatStreamEvent => ({ type: "delta", text });
const done: ChatStreamEvent = { type: "done" };

/** A transport that holds on to the outgoing request, which is the value this file compares. */
function capturing(sent: ChatGenerationRequest[]): GenerationTransport {
	return {
		async *stream(request) {
			sent.push(request);
			for (const event of [delta("H"), delta("i"), done]) {
				await Promise.resolve();
				yield event;
			}
		},
	};
}

const store = () =>
	createConversationDebugStore({
		now: () => 1_700_000_000_000,
		newTurnId: () => "turn-1",
	});

const run = (options: {
	sent: ChatGenerationRequest[];
	debug?: ReturnType<typeof store>;
	text?: string;
	transport?: GenerationTransport;
	canPersist?: () => boolean;
}) =>
	runGenerationTurn({
		session,
		text: options.text ?? "Hi",
		allowEmpty: false,
		continueMessageId: undefined,
		viewer: null,
		preferences: null as GenerationPreferenceStore | null,
		loadConnectedProviders: async () => [],
		reasoningCapability: () => undefined,
		promptPackCapability: () => undefined,
		signal: new AbortController().signal,
		streamPlan: viaTransport(
			() => options.transport ?? capturing(options.sent),
		),
		canPersist: options.canPersist ?? (() => true),
		onText: () => {},
		...(options.debug ? { debug: options.debug } : {}),
	});

describe("instrumentation doesn't change execution", () => {
	it("**the same request** goes out with or without a sink", async () => {
		const plain: ChatGenerationRequest[] = [];
		await run({ sent: plain });

		/** The second turn has a longer history, so the room is rebuilt from scratch. */
		await controller.release();
		temp.dispose();
		temp = createTempDirectory();
		controller = createTestScopeController(
			temp.path,
			createMemorySecureStorage(),
		);
		const scope = await controller.activate("alice");
		chat = scope.stores.chat;
		room = await chat.createRoom({
			originStoryId: "story-1",
			seed: seed("The Night Library"),
		});
		session = createChatConversation({
			room,
			store: chat,
			token: chat,
			preferences: null,
		});

		const traced: ChatGenerationRequest[] = [];
		await run({ sent: traced, debug: store() });

		/**
		 * Only the routing affinity key is dropped: it is a random value issued per room and the second
		 * turn runs in a new room. This records that the axis is unrelated to instrumentation.
		 */
		const withoutRouting = (request: ChatGenerationRequest | undefined) => {
			if (!request) return request;
			const { routingSessionId: _routing, ...rest } = request;
			return rest;
		};
		expect(traced).toHaveLength(1);
		expect(withoutRouting(traced[0])).toEqual(withoutRouting(plain[0]));
		/** The system prompt in particular must match character for character. */
		expect(traced[0]?.system).toBe(plain[0]?.system);
	});

	it("the save result is the same with a sink", async () => {
		const sent: ChatGenerationRequest[] = [];
		const result = await run({ sent, debug: store() });

		expect(result).toMatchObject({
			end: "completed",
			saved: true,
			unanswered: false,
		});
		expect(
			(await chat.listAllMessages(room.id)).map((m) => [m.role, m.content]),
		).toEqual([
			["user", "Hi"],
			["assistant", "Hi"],
		]);
	});
});

describe("what is recorded", () => {
	it("a turn's events remain in execution order", async () => {
		const debug = store();
		await run({ sent: [], debug });

		expect(debug.getState().log.entries.map((event) => event.kind)).toEqual([
			"turn-started",
			"input-accepted",
			"lore-selected",
			"prompt-assembled",
			"provider-request",
			"provider-response",
			"turn-committed",
		]);
	});

	it("the turn can be traced back from the confirmed message", async () => {
		const debug = store();
		await run({ sent: [], debug });

		const assistant = (await chat.listAllMessages(room.id)).find(
			(message) => message.role === "assistant",
		);
		expect(assistant).toBeDefined();
		/**
		 * Not a guess: the mapping comes from the identity the confirmed save returned. This breaks most
		 * often when the store stops returning that identity, and the screen then falls back to assuming
		 * the last row belongs to the last turn.
		 */
		expect(turnForMessage(debug.getState(), assistant?.id ?? "")?.turnId).toBe(
			"turn-1",
		);
	});

	it("the prompt and lore decisions ride on that turn", async () => {
		const debug = store();
		await run({ sent: [], debug });

		const turn = latestTurn(debug.getState());
		expect(turn?.prompt?.blocks.length).toBeGreaterThan(0);
		expect(turn?.request?.system).toBeTruthy();
		/** Joining the assembled blocks gives the text that actually went out (the shared function guarantees that). */
		expect(turn?.execution?.target.provider).toBe("rowcat");
	});

	it("a turn that lost ownership doesn't remain as a commit", async () => {
		const debug = store();
		const result = await run({
			sent: [],
			debug,
			canPersist: () => false,
		});

		expect(result.saved).toBe(false);
		const turn = latestTurn(debug.getState());
		expect(turn?.status).toBe("discarded");
		expect(turn?.discardReason).toBe("ownership");
		expect(turn?.messageId).toBeNull();
		/** The response did arrive; that fact and whether it was saved are different values. */
		expect(turn?.end).toBe("completed");
		expect(turn?.outputCharacters).toBe(2);
	});
});

describe("an unsaved line", () => {
	/**
	 * A turn that did not happen stays not-happened. If the trace is silent on this path the screen
	 * cannot tell "a turn that reached the request and failed" from "an attempt whose utterance was
	 * never saved", and the user has different things to do in each.
	 */
	it("when saving the line fails, the record keeps that fact and no request goes out", async () => {
		const sent: ChatGenerationRequest[] = [];
		const debug = store();
		const failing: ConversationSession = {
			...session,
			appendUserMessage: async () => {
				throw new Error("The disk is full");
			},
		};

		const result = await runGenerationTurn({
			session: failing,
			text: "Hi",
			allowEmpty: false,
			continueMessageId: undefined,
			viewer: null,
			preferences: null,
			loadConnectedProviders: async () => [],
			reasoningCapability: () => undefined,
			promptPackCapability: () => undefined,
			signal: new AbortController().signal,
			streamPlan: viaTransport(() => capturing(sent)),
			canPersist: () => true,
			onText: () => {},
			debug,
		});

		expect(result.end).toBe("failed");
		/** No request goes out using an unsaved utterance as context. */
		expect(sent).toEqual([]);
		expect(debug.getState().log.entries.map((event) => event.kind)).toEqual([
			"turn-started",
			"input-rejected",
			/** No round-trip end is recorded, since no request ever went out. */
			"generation-failed",
			"turn-discarded",
		]);
		expect(latestTurn(debug.getState())?.prompt).toBeNull();
	});
});
