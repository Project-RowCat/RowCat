import type { ChatTool } from "@rowcat/chat";
import { ABSOLUTE_GUARD, ADULT_TAIL, ALL_AGES_TAIL } from "@rowcat/chat/guards";
import type { ChatGenerationRequest, ChatStreamEvent } from "@rowcat/contracts";
import type { RowCatClient } from "@rowcat/sdk";
import { describe, expect, it, vi } from "vitest";
import type { ByoAdapter, ByoFetch, ByoTransportInput } from "./byo.ts";
import { ProviderError } from "./errors.ts";
import {
	createGenerationTransport,
	streamChatGenerationPlan,
} from "./transport.ts";

/**
 * Generation router — **which target takes which path, and the paths it must never take.**
 *
 * This file catches most of this slice's P0 issues:
 *
 * ```text
 * BYO falls through to managed     a conversation the user chose not to send to the server reaches the server
 * one provider stands in for another   the billing destination and the model's character change together
 * managed opens the secret         an API key is opened where it is not needed
 * billing identity on BYO          RowCat attaches a name to attempts it cannot count
 * safety guard dropped             BYO has no server re-check — this is the last check
 * secret outlives the callback     the reason the credential accessor is callback-shaped becomes moot
 * ```
 *
 * The last line is the axis that arrived later; it alone looks at **timing** (the "secret lifetime"
 * group).
 */

const request = (
	overrides: Partial<ChatGenerationRequest> = {},
): ChatGenerationRequest => ({
	system: "A prompt the creator wrote",
	messages: [{ role: "user" as const, content: "Hi" }],
	maxOutputTokens: 768,
	reasoningEffort: null,
	context: { requestedMode: "all-ages", minorCharacterPresent: false },
	tools: [],
	continuation: false,
	...overrides,
});

const drain = async (events: AsyncIterable<ChatStreamEvent>) => {
	const seen: ChatStreamEvent[] = [];
	for await (const event of events) seen.push(event);
	return seen;
};

/** Managed transport stand-in: checks only whether the SDK was actually called. */
function fakeClient() {
	/**
	 * Captures the incoming request as-is. The inferred argument tuple of `vi.fn` cannot be read here
	 * (the function is a generator, so the tuple is empty), so this array is needed to check what a
	 * managed request carried: billing identity, model and safety guard. Half of this file depends on
	 * that check.
	 */
	const sent: Record<string, unknown>[] = [];
	const stream = vi.fn((request: Record<string, unknown>) => {
		/**
		 * Records outside the generator. Pushing inside the body would do nothing until the caller
		 * consumes the stream, so "the SDK was called" and "what it carried" would become facts at
		 * different times.
		 */
		sent.push(request);
		return (async function* (): AsyncGenerator<ChatStreamEvent> {
			yield { type: "done" };
		})();
	});
	return {
		client: { chat: { stream } } as unknown as RowCatClient,
		stream,
		sent,
	};
}

/**
 * A stream that emits no events.
 *
 * This file checks what **reached the adapter**, not what came out. The iterator is hand-built
 * rather than a generator so that no `yield` is suppressed; such suppression would hide a place
 * that really needs one later.
 */
const noEvents: AsyncIterable<ChatStreamEvent> = {
	[Symbol.asyncIterator]: () => ({
		next: async () => ({ done: true as const, value: undefined }),
	}),
};

/** Captures exactly the input the adapter received; the request body is what is checked. */
function fakeAdapter() {
	const seen: ByoTransportInput[] = [];
	const adapter: ByoAdapter = {
		start: async (input) => {
			seen.push(input);
			return noEvents;
		},
		probe: async () => ({ ok: true }),
	};
	return { adapter, seen };
}

/**
 * Secret-opening port. **The managed path throws if it touches this.**
 *
 * Confirming that by value is the cheapest structural proof in this slice.
 */
function credentials(secrets: Record<string, string>) {
	const opened: string[] = [];
	/**
	 * Whether the callback is open right now. This one flag is all of the "secret lifetime" group
	 * below: it must be true when the provider transport is called.
	 */
	let open = false;
	return {
		opened,
		/** Whether we are inside the callback now; the transport reads this. */
		isOpen: () => open,
		port: {
			withCredential: async <T>(
				provider: string,
				use: (secret: string) => Promise<T>,
			): Promise<T | null> => {
				opened.push(provider);
				const secret = secrets[provider];
				if (secret === undefined) return null;
				open = true;
				try {
					return await use(secret);
				} finally {
					open = false;
				}
			},
		},
	};
}

/** This transport must never be called — the adapter picks it up instead. */
const forbiddenFetch: ByoFetch = () => {
	throw new Error("the transport was called without going through the adapter");
};

describe("the target decides the path", () => {
	it("managed goes to the SDK", async () => {
		const { client, stream } = fakeClient();
		const { adapter, seen } = fakeAdapter();

		await drain(
			createGenerationTransport(
				{ provider: "rowcat", model: "claude-sonnet-5" },
				{
					client,
					credentials: credentials({}).port,
					fetch: forbiddenFetch,
					loadAdapter: () => adapter,
				},
			).stream(request(), { signal: new AbortController().signal }),
		);

		expect(stream).toHaveBeenCalledTimes(1);
		expect(seen).toHaveLength(0);
	});

	it.each([
		["anthropic-byo" as const, "sk-anthropic"],
		["gemini-byo" as const, "gm-key"],
	])("%s goes to the adapter", async (provider, secret) => {
		const { client, stream } = fakeClient();
		const { adapter, seen } = fakeAdapter();

		await drain(
			createGenerationTransport(
				{ provider, model: "some-model" },
				{
					client,
					credentials: credentials({ [provider]: secret }).port,
					fetch: forbiddenFetch,
					loadAdapter: () => adapter,
				},
			).stream(request(), { signal: new AbortController().signal }),
		);

		/** **The SDK is never called.** */
		expect(stream).not.toHaveBeenCalled();
		expect(seen).toHaveLength(1);
		expect(seen[0]?.secret).toBe(secret);
		expect(seen[0]?.model).toBe("some-model");
	});

	/** Each provider receives its own adapter; this checks the table actually routes. */
	it("the adapter table passes the provider as is", async () => {
		const { client } = fakeClient();
		const asked: string[] = [];
		const { adapter } = fakeAdapter();

		for (const provider of ["anthropic-byo", "gemini-byo"] as const)
			await drain(
				createGenerationTransport(
					{ provider, model: "m" },
					{
						client,
						credentials: credentials({ [provider]: "s" }).port,
						fetch: forbiddenFetch,
						loadAdapter: (asked_) => {
							asked.push(asked_);
							return adapter;
						},
					},
				).stream(request(), { signal: new AbortController().signal }),
			);

		expect(asked).toEqual(["anthropic-byo", "gemini-byo"]);
	});
});

describe("there's no substitution", () => {
	/** **P0.** A BYO target whose credential is gone fails — it goes neither to the SDK nor to another adapter. */
	it("without credentials no path opens", async () => {
		const { client, stream } = fakeClient();
		const { adapter, seen } = fakeAdapter();
		const access = credentials({});

		const thrown = await drain(
			createGenerationTransport(
				{ provider: "anthropic-byo", model: "m" },
				{
					client,
					credentials: access.port,
					fetch: forbiddenFetch,
					loadAdapter: () => adapter,
				},
			).stream(request(), { signal: new AbortController().signal }),
		).catch((error: unknown) => error);

		expect(thrown).toBeInstanceOf(ProviderError);
		expect(stream).not.toHaveBeenCalled();
		expect(seen).toHaveLength(0);
	});

	/** **A Gemini connection does not satisfy an Anthropic request.** */
	it("another provider's connection doesn't stand in", async () => {
		const { client, stream } = fakeClient();
		const { adapter, seen } = fakeAdapter();

		const thrown = await drain(
			createGenerationTransport(
				{ provider: "anthropic-byo", model: "m" },
				{
					client,
					credentials: credentials({ "gemini-byo": "gm" }).port,
					fetch: forbiddenFetch,
					loadAdapter: () => adapter,
				},
			).stream(request(), { signal: new AbortController().signal }),
		).catch((error: unknown) => error);

		expect(thrown).toBeInstanceOf(ProviderError);
		expect(stream).not.toHaveBeenCalled();
		expect(seen).toHaveLength(0);
	});

	/** The scope is not open yet (guest or mid-switch); it still must not fall back to managed. */
	it("doesn't go to managed even without a port", async () => {
		const { client, stream } = fakeClient();
		const thrown = await drain(
			createGenerationTransport(
				{ provider: "anthropic-byo", model: "m" },
				{ client, credentials: null, fetch: forbiddenFetch },
			).stream(request(), { signal: new AbortController().signal }),
		).catch((error: unknown) => error);

		expect(thrown).toBeInstanceOf(ProviderError);
		expect(stream).not.toHaveBeenCalled();
	});

	/** Same when the transport is not wired (an assembly mistake, not a test case). */
	it("doesn't go to managed even without a transport", async () => {
		const { client, stream } = fakeClient();
		const thrown = await drain(
			createGenerationTransport(
				{ provider: "gemini-byo", model: "m" },
				{ client, credentials: credentials({ "gemini-byo": "s" }).port },
			).stream(request(), { signal: new AbortController().signal }),
		).catch((error: unknown) => error);

		expect(thrown).toBeInstanceOf(ProviderError);
		expect(stream).not.toHaveBeenCalled();
	});
});

describe("managed doesn't open secrets", () => {
	/**
	 * **Structural proof.** Passes a port that throws when touched and checks that managed generation
	 * still succeeds — "a managed request does not need the user's API key" is recorded by value.
	 */
	it("succeeds even with a port that throws when touched", async () => {
		const { client, stream } = fakeClient();
		const exploding = {
			withCredential: async () => {
				throw new Error("managed opened credentials");
			},
		};

		await expect(
			drain(
				createGenerationTransport(
					{ provider: "rowcat", model: "claude-sonnet-5" },
					{ client, credentials: exploding, fetch: forbiddenFetch },
				).stream(request(), { signal: new AbortController().signal }),
			),
		).resolves.toEqual([{ type: "done" }]);
		expect(stream).toHaveBeenCalledTimes(1);
	});
});

/**
 * What a managed request carries: **only the chosen model.** It once also carried a billing
 * identity (`generationId`) created per attempt; after the billing layer was removed, that field
 * left the contract.
 */
describe("the shape of managed requests", () => {
	it("managed requests have no billing identity", async () => {
		const { client, sent } = fakeClient();
		await drain(
			createGenerationTransport(
				{ provider: "rowcat", model: "claude-sonnet-5" },
				{ client, credentials: null, fetch: forbiddenFetch },
			).stream(request(), { signal: new AbortController().signal }),
		);
		expect(sent[0]).not.toHaveProperty("generationId");
	});

	it("the managed model is set here too", async () => {
		const { client, sent } = fakeClient();
		await drain(
			createGenerationTransport(
				{ provider: "rowcat", model: "claude-sonnet-5" },
				{ client, credentials: null, fetch: forbiddenFetch },
			).stream(request(), { signal: new AbortController().signal }),
		);
		expect(sent[0]?.model).toBe("claude-sonnet-5");
	});

	/**
	 * **P0.** A BYO request has no managed model field: it never passes our server, and that field
	 * only means something to the RowCat API.
	 */
	it("BYO requests have no managed cell", async () => {
		const { client } = fakeClient();
		const { adapter, seen } = fakeAdapter();
		await drain(
			createGenerationTransport(
				{ provider: "anthropic-byo", model: "m" },
				{
					client,
					credentials: credentials({ "anthropic-byo": "sk" }).port,
					fetch: forbiddenFetch,
					loadAdapter: () => adapter,
				},
			).stream(request(), { signal: new AbortController().signal }),
		);

		const delivered = seen[0]?.request as Record<string, unknown>;
		expect("generationId" in delivered).toBe(false);
		expect("model" in delivered).toBe(false);
	});
});

describe("platform safety policy", () => {
	/**
	 * **P0.** BYO has no server re-check, so this is the last check. Rather than comparing strings, it
	 * inspects **the request the adapter actually received** — that value is what goes to the
	 * provider.
	 */
	it("BYO requests start with the absolute guard and end with the rating tail", async () => {
		const { client } = fakeClient();
		const { adapter, seen } = fakeAdapter();
		await drain(
			createGenerationTransport(
				{ provider: "anthropic-byo", model: "m" },
				{
					client,
					credentials: credentials({ "anthropic-byo": "sk" }).port,
					fetch: forbiddenFetch,
					loadAdapter: () => adapter,
				},
			).stream(request({ system: "A prompt the creator wrote" }), {
				signal: new AbortController().signal,
			}),
		);

		const system = seen[0]?.request.system ?? "";
		expect(system.startsWith(ABSOLUTE_GUARD)).toBe(true);
		expect(system.endsWith(ALL_AGES_TAIL)).toBe(true);
		expect(system).toContain("A prompt the creator wrote");
	});

	/** The rating comes from the value the request carries; neither the adapter nor the router re-decides it. */
	it("adult requests get the adult tail", async () => {
		const { client } = fakeClient();
		const { adapter, seen } = fakeAdapter();
		await drain(
			createGenerationTransport(
				{ provider: "gemini-byo", model: "m" },
				{
					client,
					credentials: credentials({ "gemini-byo": "gm" }).port,
					fetch: forbiddenFetch,
					loadAdapter: () => adapter,
				},
			).stream(
				request({
					context: { requestedMode: "adult", minorCharacterPresent: false },
				}),
				{
					signal: new AbortController().signal,
				},
			),
		);

		const system = seen[0]?.request.system ?? "";
		expect(system.endsWith(ADULT_TAIL)).toBe(true);
		expect(system.endsWith(ALL_AGES_TAIL)).toBe(false);
	});

	/**
	 * Managed requests are **not wrapped** — the server adds the guard. If the device added it, the
	 * full guard text would be carried in the request body again, and that body is read as-is outside
	 * the device.
	 */
	it("managed requests carry no guards", async () => {
		const { client, sent } = fakeClient();
		await drain(
			createGenerationTransport(
				{ provider: "rowcat", model: "claude-sonnet-5" },
				{ client, credentials: null, fetch: forbiddenFetch },
			).stream(request({ system: "Body" }), {
				signal: new AbortController().signal,
			}),
		);
		expect(String(sent[0]?.system ?? "")).toBe("Body");
	});

	/**
	 * **Idempotent.** A request that already carries the guard does not grow by a single byte;
	 * otherwise every normal request built by our assembler would gain another guard each time it
	 * passes here.
	 */
	it("requests that already have guards stay as they are", async () => {
		const { client } = fakeClient();
		const { adapter, seen } = fakeAdapter();
		const deps = {
			client,
			credentials: credentials({ "anthropic-byo": "sk" }).port,
			fetch: forbiddenFetch,
			loadAdapter: () => adapter,
		};
		const signal = new AbortController().signal;

		await drain(
			createGenerationTransport(
				{ provider: "anthropic-byo", model: "m" },
				deps,
			).stream(request(), { signal }),
		);
		const once = seen[0]?.request.system ?? "";

		await drain(
			createGenerationTransport(
				{ provider: "anthropic-byo", model: "m" },
				deps,
			).stream(request({ system: once }), { signal }),
		);
		expect(seen[1]?.request.system).toBe(once);
	});

	/** Does not re-assemble the prompt; history and limits pass through unchanged. */
	it("messages and caps are untouched", async () => {
		const { client } = fakeClient();
		const { adapter, seen } = fakeAdapter();
		const original = request({
			messages: [
				{ role: "user", content: "one" },
				{ role: "assistant", content: "two" },
			],
			maxOutputTokens: 1234,
			reasoningEffort: "high",
		});
		await drain(
			createGenerationTransport(
				{ provider: "anthropic-byo", model: "m" },
				{
					client,
					credentials: credentials({ "anthropic-byo": "sk" }).port,
					fetch: forbiddenFetch,
					loadAdapter: () => adapter,
				},
			).stream(original, { signal: new AbortController().signal }),
		);
		expect(seen[0]?.request.messages).toEqual(original.messages);
		expect(seen[0]?.request.maxOutputTokens).toBe(1234);
		expect(seen[0]?.request.reasoningEffort).toBe("high");
	});
});

describe("abort signal", () => {
	it("the adapter receives the same signal", async () => {
		const { client } = fakeClient();
		const { adapter, seen } = fakeAdapter();
		const controller = new AbortController();
		await drain(
			createGenerationTransport(
				{ provider: "gemini-byo", model: "m" },
				{
					client,
					credentials: credentials({ "gemini-byo": "gm" }).port,
					fetch: forbiddenFetch,
					loadAdapter: () => adapter,
				},
			).stream(request(), { signal: controller.signal }),
		);
		expect(seen[0]?.signal).toBe(controller.signal);
	});
});

describe("the lifetime of secrets", () => {
	/**
	 * **P0.** The lifetime of the plaintext credential must not outlive the `withCredential` callback.
	 *
	 * The defect this group catches existed in a form with no condition in the code. The adapter was
	 * an `async function*`, so `adapter.stream({ secret, … })` ran none of its body; the callback
	 * created one generator object and closed at once — and that object carried the input holding the
	 * plaintext key outward:
	 *
	 * ```text
	 * callback opens → generator created → callback closes → yield* → **first fetch here**
	 * ```
	 *
	 * So we check **timing**, not value: is the callback still open when the provider transport is
	 * called? The check sits in the transport function itself, so no adapter can bypass it.
	 */
	function timedAdapter(access: { isOpen: () => boolean }) {
		/** Whether the callback was open when the transport was called. `null` means it was never called. */
		let openAtFetch: boolean | null = null;
		/** Whether it was open when the body began to be read — the second fact. */
		let openAtRead: boolean | null = null;

		const adapter: ByoAdapter = {
			/**
			 * **Same two phases as a real adapter**: call the transport (request), then return an iterator
			 * that reads the response (parsing). Using `async function*` here would make this check
			 * meaningless.
			 */
			start: async (input) => {
				openAtFetch = access.isOpen();
				await input.fetch("https://provider.example/generate", {
					method: "POST",
					headers: { "x-api-key": input.secret },
					body: "{}",
					signal: input.signal,
				});
				return (async function* (): AsyncGenerator<ChatStreamEvent> {
					openAtRead = access.isOpen();
					yield { type: "delta", text: "slices" };
					yield { type: "done" };
				})();
			},
			probe: async () => ({ ok: true }),
		};

		return {
			adapter,
			fetchedWhileOpen: () => openAtFetch,
			readWhileOpen: () => openAtRead,
		};
	}

	const transport = (access: { isOpen: () => boolean; port: unknown }) => {
		const timed = timedAdapter(access);
		const calls: string[] = [];
		return {
			timed,
			calls,
			stream: () =>
				createGenerationTransport(
					{ provider: "anthropic-byo", model: "m" },
					{
						client: fakeClient().client,
						credentials: access.port as never,
						fetch: async (url) => {
							calls.push(url);
							return {
								ok: true,
								status: 200,
								headers: new Headers(),
								body: null,
							};
						},
						loadAdapter: () => timed.adapter,
					},
				).stream(request(), { signal: new AbortController().signal }),
		};
	};

	/**
	 * **This assertion fails under the old structure.** When a generator was returned,
	 * `fetchedWhileOpen()` was `null`: the transport was not called until the callback had closed.
	 */
	it("the provider request goes out **inside** the credential callback", async () => {
		const access = credentials({ "anthropic-byo": "sk" });
		const scenario = transport(access);

		await drain(scenario.stream());

		expect(scenario.calls).toHaveLength(1);
		expect(scenario.timed.fetchedWhileOpen()).toBe(true);
	});

	/**
	 * **And the response is read after the callback closes.**
	 *
	 * Without this pair, a fix that buffers the whole response inside the callback would pass the
	 * assertion above — it removes streaming while keeping the secret alive even longer.
	 */
	it("reading the response continues after the callback closes", async () => {
		const access = credentials({ "anthropic-byo": "sk" });
		const scenario = transport(access);

		const events = await drain(scenario.stream());

		expect(events.map((event) => event.type)).toEqual(["delta", "done"]);
		expect(scenario.timed.readWhileOpen()).toBe(false);
		/** By then the callback is already closed. */
		expect(access.isOpen()).toBe(false);
	});

	/** With no credential, neither the transport nor the adapter is reached; the callback does not even open. */
	it("without a connection there's no provider request at all", async () => {
		const access = credentials({});
		const scenario = transport(access);

		await drain(scenario.stream()).catch(() => undefined);

		expect(scenario.calls).toHaveLength(0);
		expect(scenario.timed.fetchedWhileOpen()).toBeNull();
	});
});

/* ══════════════════════════════════════════════════════════════════════════
 * Tool loop
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Two things actually change when the loop is attached: **absence** and **accounting**.
 *
 * A conversation without tools must not run a line of this code, and since each round trip calls
 * the transport anew, the managed identity must be created fresh each time. Reusing the latter
 * would block the second round trip with `chat_generation_already_billed`. The loop's rules
 * themselves are enforced by `@rowcat/chat`; this file only checks **assembly**.
 */

const DICE: ChatTool = {
	declaration: {
		name: "dice",
		description: "die",
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

/** A managed client that calls a tool on the first request and whose next request finishes normally. */
function callingClient() {
	const sent: Record<string, unknown>[] = [];
	const stream = vi.fn((body: Record<string, unknown>) => {
		sent.push(body);
		const first = sent.length === 1;
		return (async function* (): AsyncGenerator<ChatStreamEvent> {
			yield { type: "delta", text: first ? "Picked it up." : " It's 17." };
			if (first)
				yield {
					type: "tool_call",
					call: { id: "call_1", name: "dice", arguments: { sides: 20 } },
				};
			yield { type: "done" };
		})();
	});
	return { client: { chat: { stream } } as unknown as RowCatClient, sent };
}

describe("tool loop", () => {
	it("without tools the transport is as before", async () => {
		const { client, sent } = callingClient();
		const transport = createGenerationTransport(
			{ provider: "rowcat", model: "claude-sonnet-5" },
			{ client },
		);
		await drain(
			transport.stream(request(), { signal: new AbortController().signal }),
		);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.tools).toEqual([]);
	});

	it("each round trip sends its own request and the caller sees one stream", async () => {
		const { client, sent } = callingClient();
		const transport = createGenerationTransport(
			{ provider: "rowcat", model: "claude-sonnet-5" },
			{ client, toolAccess: { tools: [DICE], isValid: () => true } },
		);
		const seen = await drain(
			transport.stream(request(), { signal: new AbortController().signal }),
		);

		expect(sent).toHaveLength(2);
		/** Both round trips' bodies appear to the caller as one stream. */
		expect(
			seen
				.filter((event) => event.type === "delta")
				.map((event) => event.text)
				.join(""),
		).toBe("Picked it up. It's 17.");
		expect(seen.filter((event) => event.type === "done")).toHaveLength(1);
	});

	/** A round trip after leaving the room would be spent on a sentence no one reads, and on managed it is billed. */
	it("losing ownership stops the next round trip", async () => {
		const { client, sent } = callingClient();
		const transport = createGenerationTransport(
			{ provider: "rowcat", model: "claude-sonnet-5" },
			{ client, toolAccess: { tools: [DICE], isValid: () => false } },
		);
		await drain(
			transport.stream(request(), { signal: new AbortController().signal }),
		);
		expect(sent).toHaveLength(1);
	});
});

/** Branching of the assembly plan — same assertions as the web's group. */
describe("assembly plan", () => {
	const storyPlan = {
		kind: "story" as const,
		storyId: "story-1",
		request: {
			messages: [{ role: "user" as const, speaker: "", content: "Hi" }],
		},
	};

	it("protected stories go out on the story path and skip the device's tool loop", async () => {
		const sent: { storyId: string; body: Record<string, unknown> }[] = [];
		const client = {
			chat: {
				stream: () => {
					throw new Error("must not go to the general path");
				},
				streamStory: async function* (
					storyId: string,
					body: Record<string, unknown>,
				): AsyncGenerator<ChatStreamEvent> {
					sent.push({ storyId, body });
					yield { type: "done" };
				},
			},
		} as unknown as RowCatClient;
		const tool: ChatTool = {
			declaration: { name: "lore_search", description: "x", parameters: [] },
			run: async () => "",
		};

		for await (const _ of streamChatGenerationPlan(
			storyPlan,
			{ provider: "rowcat", model: "claude-sonnet-5" },
			{
				client,
				credentials: null,
				fetch: forbiddenFetch,
				toolAccess: { tools: [tool], isValid: () => true },
			},
			{ signal: new AbortController().signal },
		));

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			storyId: "story-1",
			body: { model: "claude-sonnet-5" },
		});
		expect(sent[0]?.body).not.toHaveProperty("tools");
	});

	it("throws when trying to send a protected story through BYO", () => {
		const { client, stream } = fakeClient();
		expect(() =>
			streamChatGenerationPlan(
				storyPlan,
				{ provider: "anthropic-byo", model: "m" },
				{ client, credentials: null, fetch: forbiddenFetch },
				{ signal: new AbortController().signal },
			),
		).toThrow();
		expect(stream).not.toHaveBeenCalled();
	});
});
