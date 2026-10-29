import type {
	ChatGenerationPlan,
	ChatRoom,
	ChatStore,
	ConversationSession,
	GenerationPreferenceStore,
	GenerationProvider,
	GenerationTarget,
	PromptPackCapabilityLookup,
	ReasoningCapabilityLookup,
} from "@rowcat/chat";
import {
	outputTokensFor,
	PRODUCT_GENERATION_TARGET,
	PRODUCT_REASONING_EFFORT,
	PRODUCT_RESPONSE_LENGTH,
} from "@rowcat/chat";
import type { ChatStreamEvent } from "@rowcat/contracts";
import type { Viewer } from "@rowcat/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationTransport } from "../../../lib/generation/transport.ts";
import type { LocalScopeController } from "../../../lib/local-data/activation.ts";
import { seed } from "../../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../../test/sqlite-node.ts";
import { createChatConversation } from "../chat-conversation.ts";
import {
	ChatGenerationBlockedError,
	ChatPersistenceError,
	ChatStreamFailure,
} from "./error.ts";

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
 * One generation turn, checked on real SQLite for ordering and failure handling.
 *
 * The store is deliberately not mocked: half of what is verified is what got stored (did the user
 * utterance remain, is there exactly one assistant message, did a late result not attach), and a
 * mock store cannot answer that. Code it lets through breaks first on a device (same judgement as
 * the header of `src/test/sqlite-node.ts`).
 *
 * Only the transport is faked. A real one would bring the network and managed billing into this
 * test and verify the server's state rather than our ordering.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let chat: ChatStore;
let preferences: GenerationPreferenceStore;
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
	preferences = scope.stores.generation;
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

const VIEWER = null satisfies Viewer | null;

/**
 * A managed target that differs from the product default. Testing with the default itself would
 * make "the override was carried" and "nothing happened" give the same result, a test that passes
 * while guarding nothing. Managed is deliberate too: a BYO target is normally blocked on this
 * device (no connection) and never reaches the transport.
 */
const OTHER_MANAGED_TARGET = {
	provider: "rowcat",
	model: "claude-haiku-4-5",
} as const satisfies GenerationTarget;

/**
 * A target that cannot run in this journey: blocked because this file's default connection list is
 * empty (`RunOptions.connectedProviders`). The path with a real connection runs on a real store in
 * `byo-generation.test.ts`; what is checked here is that the pure turn does not substitute a
 * blocked target.
 */
const BYO_TARGET = {
	provider: "anthropic-byo",
	model: "claude-sonnet-5",
} as const satisfies GenerationTarget;

/** A transport that streams one script. `await` between deltas lets a stop really interleave. */
function scripted(
	events: ChatStreamEvent[],
	hooks: { beforeEvent?: (index: number) => void } = {},
): GenerationTransport {
	return {
		async *stream(_request, options) {
			for (const [index, event] of events.entries()) {
				await Promise.resolve();
				hooks.beforeEvent?.(index);
				if (options.signal.aborted) throw abortError();
				yield event;
			}
		},
	};
}

const abortError = (): Error => {
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
};

const delta = (text: string): ChatStreamEvent => ({ type: "delta", text });
const done: ChatStreamEvent = { type: "done" };

interface RunOptions {
	text?: string;
	allowEmpty?: boolean;
	transport?: GenerationTransport;
	/** Where to observe which target this turn built its transport with. */
	transportFor?: (target: GenerationTarget) => GenerationTransport | undefined;
	canPersist?: () => boolean;
	signal?: AbortSignal;
	onAccepted?: () => void;
	onText?: (text: string) => void;
	session?: ConversationSession;
	/** This device's global preference. Most journeys leave the layer empty, so the product default stands. */
	preferences?: GenerationPreferenceStore | null;
	/** Target of a continue-generation; when present this turn is a continuation. */
	continueMessageId?: string;
	/**
	 * Providers this device holds credentials for. Empty by default: most journeys are managed, and
	 * BYO being blocked is the fact to check in that default state.
	 */
	connectedProviders?: readonly GenerationProvider[];
	/** Reasoning capability the catalog reported. Unknown by default (catalog not received). */
	reasoningCapability?: ReasoningCapabilityLookup;
	/** Narration-pack capability the catalog reported. Unknown by default, for the same reason. */
	promptPackCapability?: PromptPackCapabilityLookup;
}

const run = (options: RunOptions = {}) =>
	runGenerationTurn({
		session: options.session ?? session,
		text: options.text ?? "Hi",
		allowEmpty: options.allowEmpty ?? false,
		continueMessageId: options.continueMessageId,
		viewer: VIEWER,
		preferences: options.preferences ?? null,
		loadConnectedProviders: async () => options.connectedProviders ?? [],
		reasoningCapability: () => options.reasoningCapability,
		promptPackCapability: () => options.promptPackCapability,
		signal: options.signal ?? new AbortController().signal,
		streamPlan: viaTransport(
			(target) =>
				options.transportFor?.(target) ??
				options.transport ??
				scripted([delta("H"), delta("i"), done]),
		),
		canPersist: options.canPersist ?? (() => true),
		onText: options.onText ?? (() => {}),
		...(options.onAccepted ? { onAccepted: options.onAccepted } : {}),
	});

const messages = () => chat.listAllMessages(room.id);

describe("normal end", () => {
	it("one user line and one assistant reply remain", async () => {
		const result = await run();

		expect(result.end).toBe("completed");
		expect(result.saved).toBe(true);
		expect(result.unanswered).toBe(false);
		expect((await messages()).map((m) => [m.role, m.content])).toEqual([
			["user", "Hi"],
			["assistant", "Hi"],
		]);
	});

	it("deltas accumulate in arrival order", async () => {
		const seen: string[] = [];
		await run({
			transport: scripted([delta("one"), delta(" "), delta("two"), done]),
			onText: (text) => seen.push(text),
		});

		// Streams the accumulated full text; the caller draws that value as-is.
		expect(seen).toEqual(["one", "one ", "one two"]);
	});

	it("the reply is saved **only once**", async () => {
		await run({ transport: scripted([delta("on"), delta("ce"), done]) });

		const assistant = (await messages()).filter((m) => m.role === "assistant");
		expect(assistant).toHaveLength(1);
		expect(assistant[0]?.content).toBe("once");
		/**
		 * A normal end creates no truncation marker: the key is absent, not `false`. The store keeps that
		 * axis optional so "confirmed a normal end" and "an old record that predates the axis" are not
		 * the same value.
		 */
		expect(assistant[0]?.incomplete).toBeUndefined();
	});

	it("usage stores only the axes reported — unknown and 0 differ", async () => {
		await run({
			transport: scripted([
				delta("response"),
				{ type: "usage", inputTokens: 12, model: "claude-sonnet-5" },
				done,
			]),
		});

		const assistant = (await messages()).at(-1);
		expect(assistant?.inputTokens).toBe(12);
		expect(assistant?.model).toBe("claude-sonnet-5");
		// A cache axis the provider did not report is not filled with 0; it stays absent.
		expect(assistant?.cachedInputTokens).toBeUndefined();
	});
});

describe("the user turn comes first", () => {
	it("sending starts only after the line is saved", async () => {
		const order: string[] = [];
		const store: ChatStore = {
			...chat,
			appendMessage: async (input) => {
				order.push(`append:${input.role}`);
				return chat.appendMessage(input);
			},
		};

		await runGenerationTurn({
			session: createChatConversation({
				room,
				store,
				token: store,
				preferences: null,
			}),
			text: "Hi",
			allowEmpty: false,
			viewer: VIEWER,
			preferences: null,
			loadConnectedProviders: async () => [],
			reasoningCapability: () => undefined,
			promptPackCapability: () => undefined,
			signal: new AbortController().signal,
			streamPlan: viaTransport(() => ({
				async *stream() {
					order.push("stream");
					yield done;
				},
			})),
			canPersist: () => true,
			onText: () => {},
		});

		expect(order).toEqual(["append:user", "stream"]);
	});

	it("if the line can't be saved, **sending doesn't start**", async () => {
		const createTransport = vi.fn();
		const store: ChatStore = {
			...chat,
			appendMessage: async () => {
				throw new Error("SQLITE_FULL");
			},
		};

		const result = await runGenerationTurn({
			session: createChatConversation({
				room,
				store,
				token: store,
				preferences: null,
			}),
			text: "A sentence that must not be lost",
			allowEmpty: false,
			viewer: VIEWER,
			preferences: null,
			loadConnectedProviders: async () => [],
			reasoningCapability: () => undefined,
			promptPackCapability: () => undefined,
			signal: new AbortController().signal,
			streamPlan: viaTransport(createTransport),
			canPersist: () => true,
			onText: () => {},
		});

		expect(createTransport).not.toHaveBeenCalled();
		expect(result.end).toBe("failed");
		expect(await messages()).toHaveLength(0);
	});

	/**
	 * An attempt that could not be saved is a turn that did not happen, not a turn without an answer.
	 * Marked as unanswered, the screen offers `Regenerate`, which generates from the previous history: the
	 * sentence the user just typed exists nowhere and one more answer is appended.
	 */
	it("an attempt that couldn't be saved isn't a 'turn awaiting an answer'", async () => {
		const store: ChatStore = {
			...chat,
			appendMessage: async () => {
				throw new Error("SQLITE_FULL");
			},
		};

		const result = await runGenerationTurn({
			session: createChatConversation({
				room,
				store,
				token: store,
				preferences: null,
			}),
			text: "Hi",
			allowEmpty: false,
			viewer: VIEWER,
			preferences: null,
			loadConnectedProviders: async () => [],
			reasoningCapability: () => undefined,
			promptPackCapability: () => undefined,
			signal: new AbortController().signal,
			streamPlan: viaTransport(() => scripted([done])),
			canPersist: () => true,
			onText: () => {},
		});

		expect(result.unanswered).toBe(false);
	});

	it("the acceptance signal comes once, **after** saving finishes", async () => {
		/**
		 * Records the order as one line. Checking only "was called" would let an implementation that
		 * calls before saving pass, which is exactly the defect this signal exists to remove (the
		 * composer is cleared, then the write fails).
		 */
		const order: string[] = [];
		const store: ChatStore = {
			...chat,
			appendMessage: async (input) => {
				const saved = await chat.appendMessage(input);
				order.push(`saved:${input.role}`);
				return saved;
			},
		};

		await runGenerationTurn({
			session: createChatConversation({
				room,
				store,
				token: store,
				preferences: null,
			}),
			text: "Hi",
			allowEmpty: false,
			viewer: VIEWER,
			preferences: null,
			loadConnectedProviders: async () => [],
			reasoningCapability: () => undefined,
			promptPackCapability: () => undefined,
			signal: new AbortController().signal,
			streamPlan: viaTransport(() => scripted([done])),
			canPersist: () => true,
			onText: () => {},
			onAccepted: () => order.push("accepted"),
		});

		expect(order).toEqual(["saved:user", "accepted"]);
	});

	it("when saving fails no acceptance signal comes — the composer keeps the sentence", async () => {
		const onAccepted = vi.fn();
		const store: ChatStore = {
			...chat,
			appendMessage: async () => {
				throw new Error("SQLITE_FULL");
			},
		};

		await runGenerationTurn({
			session: createChatConversation({
				room,
				store,
				token: store,
				preferences: null,
			}),
			text: "Hi",
			allowEmpty: false,
			viewer: VIEWER,
			preferences: null,
			loadConnectedProviders: async () => [],
			reasoningCapability: () => undefined,
			promptPackCapability: () => undefined,
			signal: new AbortController().signal,
			streamPlan: viaTransport(() => scripted([done])),
			canPersist: () => true,
			onText: () => {},
			onAccepted,
		});

		expect(onAccepted).not.toHaveBeenCalled();
	});

	it("'Regenerate' doesn't append another line", async () => {
		await run();
		const before = (await messages()).length;

		await run({ text: "", allowEmpty: true });

		const after = await messages();
		expect(after.filter((m) => m.role === "user")).toHaveLength(1);
		expect(after).toHaveLength(before + 1);
	});
});

describe("Stop", () => {
	it("keeps what arrived and adds an interruption marker", async () => {
		const abort = new AbortController();
		const result = await run({
			signal: abort.signal,
			transport: scripted([delta("half"), delta("way"), done], {
				beforeEvent: (index) => {
					if (index === 2) abort.abort();
				},
			}),
		});

		expect(result.end).toBe("stopped");
		// Stopping is not an error: a failure sentence is not attached to something the user ended.
		expect(result.failure).toBeNull();
		const assistant = (await messages()).at(-1);
		expect(assistant?.content).toBe("halfway");
		expect(assistant?.incomplete).toBe(true);
	});

	it("cut off before receiving a single character, nothing is saved", async () => {
		const abort = new AbortController();
		abort.abort();

		const result = await run({
			signal: abort.signal,
			transport: scripted([delta("late"), done]),
		});

		expect(result.end).toBe("stopped");
		expect(result.saved).toBe(false);
		// The user utterance remains; the user really did send it.
		expect(await messages()).toHaveLength(1);
		expect(result.unanswered).toBe(true);
	});

	/**
	 * The path abort alone cannot stop. A request that already received its whole body slips past the
	 * abort signal and ends with `done`, and its confirming save arrives as a success rather than a
	 * failure; the ownership check is the only thing that blocks it.
	 */
	it("a generation that finishes late isn't saved if ownership moved", async () => {
		const result = await run({
			transport: scripted([delta("Late"), delta(" arrival"), done]),
			canPersist: () => false,
		});

		expect(result.end).toBe("completed");
		expect(result.saved).toBe(false);
		expect(result.unanswered).toBe(true);
		expect((await messages()).map((m) => m.role)).toEqual(["user"]);
	});
});

describe("failure", () => {
	it("the user line remains even when the network drops", async () => {
		const result = await run({
			/**
			 * Throws before the stream starts (connection failure). No frame is ever produced, so it is a
			 * plain function rather than a generator; the real transport also sends its request on the first
			 * iteration and fails there.
			 */
			transport: {
				stream() {
					throw new TypeError("Network request failed");
				},
			},
		});

		expect(result.end).toBe("failed");
		expect(result.unanswered).toBe(true);
		expect((await messages()).map((m) => m.role)).toEqual(["user"]);
	});

	/** A failure after the stream started propagates without losing its code. */
	it("a failure the server streamed carries its code", async () => {
		const result = await run({
			transport: scripted([
				delta("The reply came, but"),
				{
					type: "error",
					code: "chat_billing_settlement_failed",
					message: "settlement failed",
				},
			]),
		});

		expect(result.failure).toBeInstanceOf(ChatStreamFailure);
		expect((result.failure as ChatStreamFailure).code).toBe(
			"chat_billing_settlement_failed",
		);
		// The received text is still saved; what the user read is not discarded over accounting.
		expect((await messages()).at(-1)?.content).toBe("The reply came, but");
	});

	it("when the confirmed save fails it says so separately", async () => {
		let calls = 0;
		const store: ChatStore = {
			...chat,
			appendMessage: async (input) => {
				calls += 1;
				// Lets the user utterance through and fails only the assistant confirmation.
				if (calls > 1) throw new Error("SQLITE_FULL");
				return chat.appendMessage(input);
			},
		};

		const result = await runGenerationTurn({
			session: createChatConversation({
				room,
				store,
				token: store,
				preferences: null,
			}),
			text: "Hi",
			allowEmpty: false,
			viewer: VIEWER,
			preferences: null,
			loadConnectedProviders: async () => [],
			reasoningCapability: () => undefined,
			promptPackCapability: () => undefined,
			signal: new AbortController().signal,
			streamPlan: viaTransport(() => scripted([delta("response"), done])),
			canPersist: () => true,
			onText: () => {},
		});

		expect(result.end).toBe("failed");
		expect(result.failure).toBeInstanceOf(ChatPersistenceError);
		expect(result.saved).toBe(false);
		expect(result.unanswered).toBe(true);
		expect((await messages()).map((m) => m.role)).toEqual(["user"]);
	});

	it("an empty reply isn't saved and remains as an unanswered turn", async () => {
		const result = await run({ transport: scripted([delta("   "), done]) });

		expect(result.saved).toBe(false);
		expect(result.unanswered).toBe(true);
		expect((await messages()).map((m) => m.role)).toEqual(["user"]);
	});
});

describe("account isolation", () => {
	/**
	 * The account changed while Alice's generation was streaming. The ownership check turns false, so
	 * the response is written to neither database: the identity boundary outranks one partial
	 * response.
	 */
	it("when the account switches, the late reply is saved to neither side", async () => {
		let owns = true;
		const result = await run({
			transport: scripted([delta("Alice's reply"), done], {
				beforeEvent: (index) => {
					if (index === 1) owns = false;
				},
			}),
			canPersist: () => owns,
		});

		expect(result.saved).toBe(false);
		expect((await messages()).map((m) => m.role)).toEqual(["user"]);

		const bob = await controller.activate("bob");
		expect(await bob.stores.chat.listRooms()).toEqual([]);
	});
});

/* ══════════════════════════════════════════════════════════════════════════
 * Generation settings: stored values actually ride on this request
 * ══════════════════════════════════════════════════════════════════════════ */

describe("Generation settings", () => {
	/**
	 * Without this group the settings screen is decoration. A test that only checks the chosen value
	 * is stored says only that it was written somewhere; if it does not ride on the next turn's
	 * request, the user changes the model and still gets the old model's answers, and that mismatch
	 * shows nowhere on screen.
	 *
	 * So what is checked is not the store but the value that reached the transport: the target arrives
	 * as the argument of `createTransport`, response length as the request's `maxOutputTokens`.
	 */

	/** What this turn actually carried out. */
	const capture = () => {
		const seen: {
			target?: GenerationTarget;
			maxOutputTokens?: number;
			reasoningEffort?: string | null;
		} = {};
		const inner = scripted([delta("response"), done]);
		return {
			seen,
			transportFor: (target: GenerationTarget): GenerationTransport => {
				seen.target = target;
				return {
					stream(request, options) {
						seen.maxOutputTokens = request.maxOutputTokens;
						seen.reasoningEffort = request.reasoningEffort;
						return inner.stream(request, options);
					},
				};
			},
		};
	};

	/** Makes this conversation actually see the preference store; both the adapter and the pure turn are needed. */
	const wired = () =>
		createChatConversation({ room, store: chat, token: chat, preferences });

	it("the room override rides on this request", async () => {
		await preferences.setRoom(room.id, {
			responseLength: "long",
			target: OTHER_MANAGED_TARGET,
			reasoningEffort: null,
		});

		const probe = capture();
		await run({
			preferences,
			session: wired(),
			transportFor: probe.transportFor,
		});

		expect(probe.seen.target).toEqual(OTHER_MANAGED_TARGET);
		expect(probe.seen.maxOutputTokens).toBe(outputTokensFor("long"));
	});

	/**
	 * A stored BYO target does not silently fall to managed. On a device with no connection that
	 * target is blocked; a substitution there would change who is billed and which server the prompt
	 * passes through with nothing visibly happening, so no transport is built and the block reason is
	 * raised as-is.
	 *
	 * Preferences are not synced, so this value was chosen on this device, and the list draws that
	 * item as disabled (connecting under `Settings → AI` unblocks it).
	 */
	it("a target this device can't use is blocked and not substituted", async () => {
		await preferences.setRoom(room.id, {
			responseLength: null,
			target: BYO_TARGET,
			reasoningEffort: null,
		});

		const probe = capture();
		const result = await run({
			preferences,
			session: wired(),
			transportFor: probe.transportFor,
		});

		expect(probe.seen.target).toBeUndefined();
		expect(result.failure).toBeInstanceOf(ChatGenerationBlockedError);
	});

	/**
	 * The reasoning axis rides on the request too. A test that only checks storage cannot say whether
	 * the settings screen is decoration: without this, the control stores a value while the request
	 * goes out without that axis, visible only in the character of responses.
	 *
	 * This app's targets are always managed, so normalization is the server's job. What rides here is
	 * the user's chosen value as-is, and whether that model has that tier is re-decided by the server.
	 */
	it("the reasoning override rides on this request", async () => {
		await preferences.setRoom(room.id, {
			responseLength: null,
			target: null,
			reasoningEffort: "high",
		});

		const probe = capture();
		await run({
			preferences,
			session: wired(),
			transportFor: probe.transportFor,
		});

		expect(probe.seen.reasoningEffort).toBe("high");
	});

	/** If nobody chose, the product default rides, not `null` (which would mean "not carried"). */
	it("when nobody sets it, the product default level rides", async () => {
		const probe = capture();
		await run({
			preferences,
			session: wired(),
			transportFor: probe.transportFor,
		});

		expect(probe.seen.reasoningEffort).toBe(PRODUCT_REASONING_EFFORT);
	});

	/** Axes do not drag each other along: overriding only reasoning leaves length at the global value. */
	it("overriding only reasoning leaves response length following the parent", async () => {
		await preferences.setGlobal({
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
		await preferences.setRoom(room.id, {
			responseLength: null,
			target: null,
			reasoningEffort: "low",
		});

		const probe = capture();
		await run({
			preferences,
			session: wired(),
			transportFor: probe.transportFor,
		});

		expect(probe.seen.reasoningEffort).toBe("low");
		expect(probe.seen.maxOutputTokens).toBe(outputTokensFor("short"));
	});

	it("clearing the override follows the global", async () => {
		await preferences.setGlobal({
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
		await preferences.setRoom(room.id, {
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		await preferences.clearRoom(room.id);

		const probe = capture();
		await run({
			preferences,
			session: wired(),
			transportFor: probe.transportFor,
		});

		expect(probe.seen.maxOutputTokens).toBe(outputTokensFor("short"));
	});

	/**
	 * If no layer chose, the product default applies. This guards the direction of regression: once a
	 * preference store exists, a change that silently alters the default becomes possible, and the
	 * difference would show up on accounts where nobody touched settings.
	 */
	it("setting nothing gives the product default", async () => {
		const probe = capture();
		await run({
			preferences,
			session: wired(),
			transportFor: probe.transportFor,
		});

		expect(probe.seen.target).toEqual(PRODUCT_GENERATION_TARGET);
		expect(probe.seen.maxOutputTokens).toBe(
			outputTokensFor(PRODUCT_RESPONSE_LENGTH),
		);
	});

	/**
	 * Freezes the moment it resolves, which is just before the stream starts. Do not describe the lock
	 * as "the moment send is pressed": the pure turn commits the user utterance first (1), reads
	 * history and memory (2), then reads preferences, so a change arriving in between rightly reaches
	 * this request (nothing has gone out yet, and a value the user just chose has no reason to wait
	 * for the next turn).
	 *
	 * The real promise is what follows: once the request is out it does not change. Editing settings
	 * while the response streams leaves this turn on the values it started with, and the in-flight
	 * generation is not cut. Web's `use-conversation-generation.ts` has the same order at the same
	 * place.
	 */
	it("changes after the stream starts don't change this turn", async () => {
		await preferences.setRoom(room.id, {
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});

		const probe = capture();
		let changed: Promise<void> = Promise.resolve();
		await run({
			preferences,
			session: wired(),
			transportFor: (target) => {
				const transport = probe.transportFor(target);
				return {
					async *stream(request, options) {
						for await (const event of transport.stream(request, options)) {
							/** Changes the settings after the first delta; the request has already gone out. */
							changed = preferences.setRoom(room.id, {
								responseLength: "short",
								target: null,
								reasoningEffort: null,
							});
							await changed;
							yield event;
						}
					},
				};
			},
		});
		await changed;

		/** This turn's request is unchanged. */
		expect(probe.seen.maxOutputTokens).toBe(outputTokensFor("long"));
		/** And the next turn reads the new value. */
		expect((await preferences.getRoom(room.id)).responseLength).toBe("short");
	});
});

/* ══════════════════════════════════════════════════════════════════════════
 * Trigger of auto-maintenance: after the save, without waiting
 * ══════════════════════════════════════════════════════════════════════════ */

describe("waking automatic maintenance", () => {
	/** One session observing maintenance; records the call point as the stored message count. */
	const withMaintain = () => {
		const calls: number[] = [];
		const observed = createChatConversation({
			room,
			store: chat,
			token: chat,
			preferences: null,
			maintain: () => {
				calls.push(Date.now());
			},
		});
		return { calls, session: observed };
	};

	/**
	 * Waking before the save lets maintenance pick its batch from a history that lacks the response
	 * just produced, and that response stays out of the summary until the next maintenance.
	 */
	it("wakes after the confirmed reply is saved", async () => {
		/**
		 * Observes the order as a value. A single flag only says "was called", while what this test must
		 * guard is the order of the two calls.
		 */
		const order: string[] = [];
		const base = createChatConversation({
			room,
			store: chat,
			token: chat,
			preferences: null,
		});
		const observed: ConversationSession = {
			...base,
			appendAssistantMessage: async (message) => {
				await base.appendAssistantMessage(message);
				order.push("saved");
			},
			maintain: () => order.push("maintain"),
		};

		const result = await run({ session: observed });
		expect(result.saved).toBe(true);
		expect(order).toEqual(["saved", "maintain"]);
		// The save has really finished: both the user utterance and the assistant response remain.
		expect(await messages()).toHaveLength(2);
	});

	/**
	 * If the response was not saved the conversation grew by nothing, so there is no reason to wake
	 * maintenance, and waking it would end that paid call without summarizing anything new.
	 */
	it("doesn't wake when there is no reply to save", async () => {
		const { calls, session: observed } = withMaintain();
		await run({ session: observed, transport: scripted([done]) });
		expect(calls).toEqual([]);
	});

	it("doesn't wake when the save failed from lost ownership", async () => {
		const { calls, session: observed } = withMaintain();
		const result = await run({
			session: observed,
			canPersist: () => false,
		});
		expect(result.saved).toBe(false);
		expect(calls).toEqual([]);
	});

	/**
	 * A throwing maintenance does not turn an already successful turn into a failure; otherwise the
	 * user sees the answer on screen together with an error that has nothing to do with anything they
	 * did.
	 */
	it("the turn succeeds even when maintenance throws", async () => {
		const observed = createChatConversation({
			room,
			store: chat,
			token: chat,
			preferences: null,
			maintain: () => {
				throw new Error("the maintenance wiring broke");
			},
		});

		const result = await run({ session: observed });
		expect(result.end).toBe("completed");
		expect(result.saved).toBe(true);
		expect(result.failure).toBeNull();
		expect(await messages()).toHaveLength(2);
	});

	/** A conversation with no maintenance, like a playback session, runs as before; `maintain` is optional. */
	it("a conversation without maintenance is normal too", async () => {
		const result = await run();
		expect(result.saved).toBe(true);
	});
});

describe("Continue generating", () => {
	const doneWith = (finishReason: string): ChatStreamEvent => ({
		type: "done",
		finishReason,
	});

	/** Builds one truncated response as a real turn and returns its id. */
	const seedTruncated = async (): Promise<string> => {
		await run({
			transport: scripted([
				delta("He opened the door and"),
				doneWith("length"),
			]),
		});
		const last = (await messages()).at(-1);
		if (!last) throw new Error("the cut reply wasn't saved");
		return last.id;
	};

	it("a completion cut at the output cap is saved as truncated", async () => {
		await seedTruncated();
		const last = (await messages()).at(-1);
		expect(last?.role).toBe("assistant");
		expect(last?.truncated).toBe(true);
		// done was received, so this is not incomplete; the two axes are different facts.
		expect(last?.incomplete).toBeUndefined();
	});

	it("continuation grows the same record instead of a new bubble", async () => {
		const target = await seedTruncated();
		const before = (await messages()).length;

		const result = await run({
			text: "",
			allowEmpty: true,
			continueMessageId: target,
			transport: scripted([delta(" went outside."), doneWith("stop")]),
		});

		expect(result.saved).toBe(true);
		expect(result.unanswered).toBe(false);
		const all = await messages();
		// The row count is unchanged: this extends, it does not append.
		expect(all).toHaveLength(before);
		const last = all.at(-1);
		expect(last?.id).toBe(target);
		expect(last?.content).toBe("He opened the door and went outside.");
		// It ended without truncation, so the marker is gone and the next continuation does not hold.
		expect(last?.truncated).toBeUndefined();
	});

	it("cut again, truncated remains so the next continuation works", async () => {
		const target = await seedTruncated();
		await run({
			text: "",
			allowEmpty: true,
			continueMessageId: target,
			transport: scripted([delta(" went"), doneWith("length")]),
		});
		expect((await messages()).at(-1)?.truncated).toBe(true);
	});

	it("if the conversation moved on meanwhile it quietly stops — no sending starts", async () => {
		const target = await seedTruncated();
		// The user sent the next utterance in the meantime, so the truncated response is no longer the
		// last.
		await chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "The next question",
		});
		const before = await messages();

		const transport = vi.fn();
		const result = await run({
			text: "",
			allowEmpty: true,
			continueMessageId: target,
			transportFor: () => {
				transport();
				return scripted([delta("Text that must not be attached"), done]);
			},
		});

		expect(transport).not.toHaveBeenCalled();
		expect(result.saved).toBe(false);
		// Nothing changed: the truncation marker and the body are both as they were.
		expect(await messages()).toEqual(before);
	});

	it("a continuation whose ownership moved writes nothing", async () => {
		const target = await seedTruncated();
		const before = await messages();

		const result = await run({
			text: "",
			allowEmpty: true,
			continueMessageId: target,
			canPersist: () => false,
			transport: scripted([
				delta(" Text that must not be attached"),
				doneWith("stop"),
			]),
		});

		expect(result.saved).toBe(false);
		expect(await messages()).toEqual(before);
	});
});
