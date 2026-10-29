import type {
	ChatGenerationPlan,
	ChatRoom,
	ChatStore,
	ConversationSession,
	GenerationPreferenceStore,
	GenerationTarget,
} from "@rowcat/chat";
import type { ChatStreamEvent } from "@rowcat/contracts";
import type { Viewer } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ByoAdapter,
	ByoTransportInput,
} from "../../../lib/generation/byo.ts";
import {
	createGenerationTransport,
	type GenerationTransport,
} from "../../../lib/generation/transport.ts";
import type { LocalScopeController } from "../../../lib/local-data/activation.ts";
import type { MobileLocalStores } from "../../../lib/local-data/stores.ts";
import { seed } from "../../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../../test/sqlite-node.ts";
import { createChatConversation } from "../chat-conversation.ts";
import { ChatGenerationBlockedError } from "./error.ts";

import { runGenerationTurn } from "./turn.ts";

/** Transport that receives only the device-assembled plan; these tests do not exercise the server-assembly path for protected works. */
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

/** End-to-end BYO generation with real SQLite, a real secret store and the real router.

`generation-turn.test.ts` guards a turn's ordering and `router.test.ts` guards the route; this file guards the wiring between them. Failures only caught here:

- connections not read: storage has a key but the conversation is blocked as "not connected"
- eligibility not read: a key lets under-14 members generate directly
- falling back to managed: a conversation the user chose not to send to the server reaches it

Only the provider adapter and the SDK client are faked (both are network boundaries); everything else runs as the product does. */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let stores: MobileLocalStores;
let chat: ChatStore;
let preferences: GenerationPreferenceStore;
let room: ChatRoom;
let session: ConversationSession;

const ANTHROPIC = {
	provider: "anthropic-byo",
	model: "claude-sonnet-5",
} as const satisfies GenerationTarget;

const GEMINI = {
	provider: "gemini-byo",
	model: "gemini-3-pro",
} as const satisfies GenerationTarget;

const SECRET = "sk-anthropic-INTEGRATION-SECRET";

/** A member who is not under 14, so BYO is open. */
const ADULT_VIEWER = {
	id: "alice",
	nickname: "Alice",
	status: "approved",
	ageStatus: "adult",
	verified: true,
	adult: true,
	showAdult: false,
	role: "user",
	membershipGate: null,
} as unknown as Viewer;

/** Under 14: direct generation must stay blocked even with a stored key. */
const CHILD_VIEWER = {
	...ADULT_VIEWER,
	ageStatus: "child",
} as unknown as Viewer;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	const scope = await controller.activate("alice");
	stores = scope.stores;
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
		preferences,
	});
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

/** Captures the input the adapter actually received and streams one normal reply. */
function fakeAdapter() {
	const seen: ByoTransportInput[] = [];
	const adapter: ByoAdapter = {
		/** Two stages like the real adapter: the request is sent by `start()` (stood in for here by capturing it), and the returned iterator only reads that response. Folding into one `async function*` would give the wiring under test different timing rules from the real code. */
		start: async (input) => {
			seen.push(input);
			return (async function* (): AsyncGenerator<ChatStreamEvent> {
				yield { type: "delta", text: "Direct" };
				yield { type: "done" };
			})();
		},
		probe: async () => ({ ok: true }),
	};
	return { adapter, seen };
}

/** The path to the RowCat server; it must never be called in a BYO journey. */
function fakeClient() {
	const stream = vi.fn(async function* (): AsyncGenerator<ChatStreamEvent> {
		yield { type: "delta", text: "Managed" };
		yield { type: "done" };
	});
	return { client: { chat: { stream } } as unknown as RowCatClient, stream };
}

interface RunOptions {
	viewer?: Viewer | null;
	adapter?: ByoAdapter;
	client?: RowCatClient;
}

/** Runs a turn with the same assembly as the product wiring.

Both the connection list and the credentials come from the scope-built store; passing the list by hand would let "storage has a key but the conversation cannot read it" pass this test. */
const run = (options: RunOptions = {}) => {
	const { client, stream } = options.client
		? { client: options.client, stream: vi.fn() }
		: fakeClient();
	const { adapter, seen } = options.adapter
		? { adapter: options.adapter, seen: [] as ByoTransportInput[] }
		: fakeAdapter();

	return runGenerationTurn({
		session,
		text: "Hi",
		allowEmpty: false,
		viewer: options.viewer ?? ADULT_VIEWER,
		preferences,
		loadConnectedProviders: async () =>
			(await stores.providers.list()).map((connection) => connection.provider),
		reasoningCapability: () => undefined,
		promptPackCapability: () => undefined,
		signal: new AbortController().signal,
		streamPlan: viaTransport((target) =>
			createGenerationTransport(target, {
				client,
				credentials: stores.providerCredentials,
				fetch: () => {
					throw new Error(
						"the transport was called without going through the adapter",
					);
				},
				loadAdapter: () => adapter,
			}),
		),
		canPersist: () => true,
		onText: () => {},
	}).then((result) => ({ result, seen, stream }));
};

const messages = () => chat.listAllMessages(room.id);

describe("generates directly with the connected provider", () => {
	beforeEach(async () => {
		await stores.providers.connect("anthropic-byo", SECRET);
		await preferences.setRoom(room.id, {
			responseLength: null,
			target: ANTHROPIC,
			reasoningEffort: null,
		});
	});

	it("the adapter receives that target and that secret", async () => {
		const { seen, stream } = await run();

		expect(seen).toHaveLength(1);
		expect(seen[0]?.model).toBe("claude-sonnet-5");
		expect(seen[0]?.secret).toBe(SECRET);
		/** No request went to the RowCat server. */
		expect(stream).not.toHaveBeenCalled();
	});

	it("the user line and the reply remain", async () => {
		const { result } = await run();

		expect(result.end).toBe("completed");
		expect(result.saved).toBe(true);
		expect(result.unanswered).toBe(false);
		expect((await messages()).map((m) => [m.role, m.content])).toEqual([
			["user", "Hi"],
			["assistant", "Direct"],
		]);
	});

	it("Gemini goes through the same wiring", async () => {
		await stores.providers.connect("gemini-byo", "gm-secret");
		await preferences.setRoom(room.id, {
			responseLength: null,
			target: GEMINI,
			reasoningEffort: null,
		});

		const { seen, stream } = await run();
		expect(seen[0]?.secret).toBe("gm-secret");
		expect(stream).not.toHaveBeenCalled();
	});
});

describe("blocked without a connection — not substituted", () => {
	beforeEach(async () => {
		await preferences.setRoom(room.id, {
			responseLength: null,
			target: ANTHROPIC,
			reasoningEffort: null,
		});
	});

	it("no transport is created and managed isn't called either", async () => {
		const { result, seen, stream } = await run();

		expect(result.failure).toBeInstanceOf(ChatGenerationBlockedError);
		expect(seen).toHaveLength(0);
		expect(stream).not.toHaveBeenCalled();
	});

	/** The user utterance is kept: the user did send it and must be able to continue with `Regenerate` after connecting a provider. */
	it("the user line stays and becomes a turn awaiting an answer", async () => {
		const { result } = await run();

		expect(result.unanswered).toBe(true);
		expect((await messages()).map((m) => [m.role, m.content])).toEqual([
			["user", "Hi"],
		]);
	});

	/** The error carries what the screen needs to offer the way to `Settings → AI`. */
	it("the blocking reason remains as the missing connection", async () => {
		const failure = (await run()).result.failure as ChatGenerationBlockedError;
		expect(failure.reason).toBe("provider_not_connected");
		expect(failure.needsProviderSetup).toBe(true);
	});

	/** Another provider's connection does not substitute. */
	it("Anthropic is blocked on a device connected only to Gemini", async () => {
		await stores.providers.connect("gemini-byo", "gm-secret");

		const { result, seen } = await run();
		expect(result.failure).toBeInstanceOf(ChatGenerationBlockedError);
		expect(seen).toHaveLength(0);
	});
});

describe("account eligibility outranks the stored key", () => {
	/** P0. Under-14 members cannot generate directly even with a stored key. The request bypasses our server, so there is nothing to re-decide it; this is effectively the last gate. */
	it("under 14 is blocked even with a key", async () => {
		await stores.providers.connect("anthropic-byo", SECRET);
		await preferences.setRoom(room.id, {
			responseLength: null,
			target: ANTHROPIC,
			reasoningEffort: null,
		});

		const { result, seen, stream } = await run({ viewer: CHILD_VIEWER });

		const failure = result.failure as ChatGenerationBlockedError;
		expect(failure).toBeInstanceOf(ChatGenerationBlockedError);
		expect(failure.reason).toBe("byo_not_permitted");
		/** No connection guidance: the person can do nothing there. */
		expect(failure.needsProviderSetup).toBe(false);
		expect(seen).toHaveLength(0);
		expect(stream).not.toHaveBeenCalled();
	});

	/** That member's managed conversations still run; only BYO is locked. */
	it("under 14 still uses managed as is", async () => {
		const { result, stream } = await run({ viewer: CHILD_VIEWER });

		expect(result.end).toBe("completed");
		expect(stream).toHaveBeenCalledTimes(1);
	});

	/** The stored key is not erased; it works again at 14. */
	it("being blocked doesn't remove the stored key", async () => {
		await stores.providers.connect("anthropic-byo", SECRET);
		await preferences.setRoom(room.id, {
			responseLength: null,
			target: ANTHROPIC,
			reasoningEffort: null,
		});

		await run({ viewer: CHILD_VIEWER });

		expect(await stores.providers.has("anthropic-byo")).toBe(true);
	});
});

describe("connections and preferences don't touch each other", () => {
	/** Disconnecting does not erase the stored target: otherwise the user must re-pick every room's model after reconnecting, and nobody knows what was erased. */
	it("unlinking keeps the room override as is", async () => {
		await stores.providers.connect("anthropic-byo", SECRET);
		await preferences.setRoom(room.id, {
			responseLength: null,
			target: ANTHROPIC,
			reasoningEffort: null,
		});

		await stores.providers.disconnect("anthropic-byo");

		expect((await preferences.getRoom(room.id)).target).toEqual(ANTHROPIC);
	});

	/** The global preference is the same. */
	it("unlinking keeps the global override as is", async () => {
		await stores.providers.connect("anthropic-byo", SECRET);
		await preferences.setGlobal({
			responseLength: null,
			target: ANTHROPIC,
			reasoningEffort: null,
		});

		await stores.providers.disconnect("anthropic-byo");

		expect((await preferences.getGlobal()).target).toEqual(ANTHROPIC);
	});

	/** Reconnecting works with no further action; that is the whole result the two rules above protect. */
	it("unlink → relink runs the same room again", async () => {
		await stores.providers.connect("anthropic-byo", SECRET);
		await preferences.setRoom(room.id, {
			responseLength: null,
			target: ANTHROPIC,
			reasoningEffort: null,
		});

		await stores.providers.disconnect("anthropic-byo");
		expect((await run()).result.failure).toBeInstanceOf(
			ChatGenerationBlockedError,
		);

		await stores.providers.connect("anthropic-byo", "sk-second");
		const { seen, result } = await run();
		expect(result.end).toBe("completed");
		expect(seen[0]?.secret).toBe("sk-second");
	});

	/** Connecting does not choose a preference: adding a key does not change the model. */
	it("a connection doesn't change the global target", async () => {
		const before = await preferences.getGlobal();
		await stores.providers.connect("anthropic-byo", SECRET);
		expect(await preferences.getGlobal()).toEqual(before);
	});
});

describe("the connection snapshot freezes when the turn starts", () => {
	/** Disconnecting after the request has gone out does not cut the running generation (an already-sent request is not retroactively cancelled); the next turn reads the new state. */
	it("unlinking mid-reply doesn't cut this turn", async () => {
		await stores.providers.connect("anthropic-byo", SECRET);
		await preferences.setRoom(room.id, {
			responseLength: null,
			target: ANTHROPIC,
			reasoningEffort: null,
		});

		const adapter: ByoAdapter = {
			start: async () =>
				(async function* (): AsyncGenerator<ChatStreamEvent> {
					/** The user disconnects mid-stream: the credential callback has already closed (`start()` sent the request), and this turn finishes as is. */
					await stores.providers.disconnect("anthropic-byo");
					yield { type: "delta", text: "Continue" };
					yield { type: "done" };
				})(),
			probe: async () => ({ ok: true }),
		};

		const { result } = await run({ adapter });
		expect(result.end).toBe("completed");
		expect((await messages()).map((m) => m.content)).toEqual([
			"Hi",
			"Continue",
		]);

		/** The next turn reads the new state. */
		const next = await run();
		expect(next.result.failure).toBeInstanceOf(ChatGenerationBlockedError);
	});
});
