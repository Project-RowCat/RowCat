import type { ChatTool, GenerationTarget } from "@rowcat/chat";
import {
	ABSOLUTE_GUARD,
	ALL_AGES_GUARD,
	ALL_AGES_TAIL,
} from "@rowcat/chat/guards";
import type {
	ChatGenerationRequest,
	ChatStreamEvent,
	ManagedChatGenerationRequest,
} from "@rowcat/contracts";
import { ROWCAT_MANAGED_MODELS } from "@rowcat/contracts";
import type { RowCatClient } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import type { ProviderCredentialAccess } from "#/lib/local-provider/store.ts";
import { ProviderError } from "./errors.ts";
import {
	createGenerationTransport,
	streamChatGenerationPlan,
} from "./router.ts";
import type { ByoAdapter } from "./transport.ts";

/**
 * The router test checks which transport was actually called. Failures here are invisible on
 * screen. If an Anthropic target with no connection silently fell back to RowCat, the conversation
 * would still run, and the user would believe their chosen model was running, while the bill and
 * the prompt path differ. So most assertions here check that a transport was NOT called.
 */

const request: ChatGenerationRequest = {
	system: "world setting",
	messages: [{ role: "user", content: "hello" }],
	maxOutputTokens: 2048,
	reasoningEffort: null,
	context: { requestedMode: "all-ages", minorCharacterPresent: false },
	tools: [],
	continuation: false,
};

const ROWCAT: GenerationTarget = {
	provider: "rowcat",
	model: "claude-sonnet-5",
};
const ANTHROPIC: GenerationTarget = {
	provider: "anthropic-byo",
	model: "claude-sonnet-5",
};
const GEMINI: GenerationTarget = {
	provider: "gemini-byo",
	model: "gemini-3.7-flash",
};

function harness() {
	const calls: string[] = [];
	let rowcatRequest: ManagedChatGenerationRequest | null = null;
	let byoInput: { model: string; secret: string } | null = null;
	/**
	 * The request the adapter actually received. It checks by value that no managed-only field leaks
	 * into BYO.
	 */
	let byoRequest: ChatGenerationRequest | null = null;

	const client = {
		chat: {
			stream: async function* (body: ManagedChatGenerationRequest) {
				calls.push("rowcat");
				rowcatRequest = body;
				yield { type: "delta", text: "managed" } satisfies ChatStreamEvent;
				yield { type: "done" } satisfies ChatStreamEvent;
			},
		},
	} as unknown as RowCatClient;

	const adapterFor = (label: string): ByoAdapter => ({
		stream: async function* (input) {
			calls.push(label);
			byoInput = { model: input.model, secret: input.secret };
			byoRequest = input.request;
			yield { type: "delta", text: label } satisfies ChatStreamEvent;
			yield { type: "done" } satisfies ChatStreamEvent;
		},
		probe: async () => ({ ok: true }),
	});

	const credentials = (
		secrets: Record<string, string>,
	): ProviderCredentialAccess => ({
		withCredential: async (provider, use) => {
			const secret = secrets[provider];
			return secret === undefined ? null : await use(secret);
		},
	});

	const drain = async (
		events: AsyncIterable<ChatStreamEvent>,
	): Promise<ChatStreamEvent[]> => {
		const collected: ChatStreamEvent[] = [];
		for await (const event of events) collected.push(event);
		return collected;
	};

	return {
		calls,
		client,
		adapterFor,
		credentials,
		drain,
		rowcatRequest: () => rowcatRequest,
		byoInput: () => byoInput,
		byoRequest: () => byoRequest,
	};
}

const signal = () => new AbortController().signal;

const drain = async (
	events: AsyncIterable<ChatStreamEvent>,
): Promise<ChatStreamEvent[]> => {
	const collected: ChatStreamEvent[] = [];
	for await (const event of events) collected.push(event);
	return collected;
};

/**
 * The system prompt the adapter actually received. Checked by value to confirm the policy was
 * applied.
 */
let seenSystem = "";
const capture: ByoAdapter = {
	stream: async function* (input) {
		seenSystem = input.request.system;
		yield { type: "done" } satisfies ChatStreamEvent;
	},
	probe: async () => ({ ok: true }),
};

describe("target → transport", () => {
	it("managed calls only the SDK", async () => {
		const h = harness();
		const transport = createGenerationTransport(ROWCAT, {
			client: h.client,
			credentials: h.credentials({ "anthropic-byo": "k" }),
			loadAdapter: async () => h.adapterFor("anthropic"),
		});

		await h.drain(transport.stream(request, { signal: signal() }));
		expect(h.calls).toEqual(["rowcat"]);
	});

	it("an Anthropic target calls only the Anthropic adapter", async () => {
		const h = harness();
		const transport = createGenerationTransport(ANTHROPIC, {
			client: h.client,
			credentials: h.credentials({ "anthropic-byo": "sk-ant" }),
			loadAdapter: async (provider) => h.adapterFor(provider),
		});

		await h.drain(transport.stream(request, { signal: signal() }));
		expect(h.calls).toEqual(["anthropic-byo"]);
		expect(h.byoInput()).toEqual({
			model: "claude-sonnet-5",
			secret: "sk-ant",
		});
	});

	it("a Gemini target calls only the Gemini adapter", async () => {
		const h = harness();
		const transport = createGenerationTransport(GEMINI, {
			client: h.client,
			credentials: h.credentials({ "gemini-byo": "AIza" }),
			loadAdapter: async (provider) => h.adapterFor(provider),
		});

		await h.drain(transport.stream(request, { signal: signal() }));
		expect(h.calls).toEqual(["gemini-byo"]);
		expect(h.byoInput()?.model).toBe("gemini-3.7-flash");
	});
});

describe("no silent substitution", () => {
	/**
	 * This section is the reason for this file. With no credential, the router's job is to fail, not
	 * to go to another provider.
	 */
	it("without a credential no transport is called", async () => {
		const h = harness();
		const transport = createGenerationTransport(ANTHROPIC, {
			client: h.client,
			credentials: h.credentials({}),
			loadAdapter: async (provider) => h.adapterFor(provider),
		});

		await expect(
			h.drain(transport.stream(request, { signal: signal() })),
		).rejects.toBeInstanceOf(ProviderError);
		expect(h.calls).toEqual([]);
	});

	it("without a scope it does not fall back to RowCat", async () => {
		const h = harness();
		const transport = createGenerationTransport(GEMINI, {
			client: h.client,
			credentials: null,
			loadAdapter: async (provider) => h.adapterFor(provider),
		});

		await expect(
			h.drain(transport.stream(request, { signal: signal() })),
		).rejects.toBeInstanceOf(ProviderError);
		expect(h.calls).toEqual([]);
	});

	/**
	 * Also holds when another provider has a connection. This keeps an implementation that accepts
	 * 'any connection' from passing silently.
	 */
	it("does not substitute another provider's connection", async () => {
		const h = harness();
		const transport = createGenerationTransport(ANTHROPIC, {
			client: h.client,
			credentials: h.credentials({ "gemini-byo": "AIza" }),
			loadAdapter: async (provider) => h.adapterFor(provider),
		});

		await expect(
			h.drain(transport.stream(request, { signal: signal() })),
		).rejects.toBeInstanceOf(ProviderError);
		expect(h.calls).toEqual([]);
	});
});

describe("platform policy", () => {
	/**
	 * BYO has no server re-check, so the guard must be in place where the router passes the request.
	 * That fact must be visible in the value the adapter receives.
	 */
	it("BYO requests carry the absolute guard too", async () => {
		const h = harness();
		const transport = createGenerationTransport(ANTHROPIC, {
			client: h.client,
			credentials: h.credentials({ "anthropic-byo": "sk-ant" }),
			loadAdapter: async () => capture,
		});

		await h.drain(
			transport.stream(
				{ ...request, system: "a body without guards" },
				{ signal: signal() },
			),
		);
		expect(seenSystem).toContain(ABSOLUTE_GUARD);
		expect(seenSystem).toContain("a body without guards");
	});

	/**
	 * Idempotent, so a normal request does not grow by a single byte. This pins the rule that the
	 * prompt is not assembled twice: a value our assembler produced passes through unchanged.
	 */
	it("an already guarded request does not grow by a byte", async () => {
		const h = harness();
		const composed = [
			ABSOLUTE_GUARD,
			ALL_AGES_GUARD,
			"body",
			ALL_AGES_TAIL,
		].join("\n\n");
		const transport = createGenerationTransport(ANTHROPIC, {
			client: h.client,
			credentials: h.credentials({ "anthropic-byo": "sk-ant" }),
			loadAdapter: async () => capture,
		});

		await h.drain(
			transport.stream({ ...request, system: composed }, { signal: signal() }),
		);
		expect(seenSystem).toBe(composed);
	});

	/**
	 * On the managed path the SDK receives the assembler's value unchanged. The only addition is the
	 * chosen model, which the assembler cannot know. No guard is added here, because the server adds
	 * it. Adding it here would put its full text into the request body.
	 */
	it("the managed path does not touch the prompt", async () => {
		const h = harness();
		const composed = "body";
		const transport = createGenerationTransport(ROWCAT, {
			client: h.client,
			credentials: null,
		});

		await h.drain(
			transport.stream({ ...request, system: composed }, { signal: signal() }),
		);
		const sent = h.rowcatRequest();
		expect(sent).toMatchObject({
			...request,
			system: composed,
			model: "claude-sonnet-5",
		});
		expect(Object.keys(sent ?? {}).sort()).toEqual(
			[...Object.keys(request), "model"].sort(),
		);
	});
});

/**
 * Checks that the managed model is actually carried in the request. If this breaks, nothing shows
 * on screen. If the router dropped the model, the server would return 400 for the missing required
 * field or, worse, always run the same model while the user believes theirs is running.
 */
describe("managed model passing", () => {
	it("a provider-neutral request has no model", () => {
		expect(request).not.toHaveProperty("model");
	});

	it.each([
		...ROWCAT_MANAGED_MODELS,
	])("%s is carried to the SDK as is", async (model) => {
		const h = harness();
		const transport = createGenerationTransport(
			{ provider: "rowcat", model },
			{ client: h.client, credentials: null },
		);

		await h.drain(transport.stream(request, { signal: signal() }));
		expect(h.calls).toEqual(["rowcat"]);
		expect(h.rowcatRequest()?.model).toBe(model);
	});

	/**
	 * Does not translate to upstream slugs. The browser knows only the public identity. Mapping to
	 * `anthropic/...` here would put a copy of the routing table in the web bundle.
	 */
	it("does not convert to the upstream slug", async () => {
		const h = harness();
		const transport = createGenerationTransport(ROWCAT, {
			client: h.client,
			credentials: null,
		});

		await h.drain(transport.stream(request, { signal: signal() }));
		expect(h.rowcatRequest()?.model).toBe("claude-sonnet-5");
		expect(JSON.stringify(h.rowcatRequest())).not.toContain("anthropic/");
	});
});

/**
 * BYO never goes through the RowCat server, even when managed models exist. The same name in two
 * groups is where this boundary blurs. If Claude Sonnet 5, chosen as BYO, went through the managed
 * transport, the bill would hit our key instead of the user's, and the prompt would pass through
 * our server.
 */
describe("BYO does not take the managed path", () => {
	it("a BYO model with the same name does not call the SDK", async () => {
		const h = harness();
		const transport = createGenerationTransport(ANTHROPIC, {
			client: h.client,
			credentials: h.credentials({ "anthropic-byo": "sk-ant" }),
			loadAdapter: async (provider) => h.adapterFor(provider),
		});

		await h.drain(transport.stream(request, { signal: signal() }));
		expect(h.calls).toEqual(["anthropic-byo"]);
		expect(h.calls).not.toContain("rowcat");
		expect(h.rowcatRequest()).toBeNull();
		/** The adapter receives the provider's official model id, not the managed identity. */
		expect(h.byoInput()?.model).toBe("claude-sonnet-5");
	});
});

/**
 * The managed request carries only the chosen model. A billing identity (generationId) was once
 * sent per attempt. After billing was removed, the field left the contract. If any path sends that
 * name again, the server silently discards the unknown field, so the absence is locked in as a
 * tested value.
 */
describe("shape of a managed request", () => {
	it("a managed request carries the model and no billing identity", async () => {
		const h = harness();
		const transport = createGenerationTransport(ROWCAT, {
			client: h.client,
			credentials: null,
		});

		await h.drain(transport.stream(request, { signal: signal() }));
		expect(h.rowcatRequest()?.model).toBe(ROWCAT.model);
		expect(h.rowcatRequest()).not.toHaveProperty("generationId");
	});

	it.each([
		["anthropic-byo", ANTHROPIC],
		["gemini-byo", GEMINI],
	])("a %s request does not go through the RowCat SDK", async (provider, target) => {
		const h = harness();
		const transport = createGenerationTransport(target, {
			client: h.client,
			credentials: h.credentials({ [provider]: "secret" }),
			loadAdapter: async (name) => h.adapterFor(name),
		});

		await h.drain(transport.stream(request, { signal: signal() }));
		expect(h.calls).toEqual([provider]);
		expect(h.byoRequest()).not.toHaveProperty("generationId");
		expect(h.rowcatRequest()).toBeNull();
	});
});

/**
 * The loop changes two things. One is absence: a conversation without tools must not pass through
 * this code at all, and that is the whole compatibility of this axis. The other is independence of
 * round trips. Each round trip calls the transport anew, so managed requests go out separately, and
 * the server treats each as an unrelated request (rate limits are counted per round trip).
 */

const DICE: ChatTool = {
	declaration: {
		name: "dice",
		description: "dice",
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

/**
 * A managed client that calls a tool on the first request and then finishes the next request
 * normally.
 */
function callingClient() {
	const sent: ManagedChatGenerationRequest[] = [];
	const client = {
		chat: {
			stream: async function* (body: ManagedChatGenerationRequest) {
				sent.push(body);
				if (sent.length === 1) {
					yield { type: "delta", text: "picked up." } satisfies ChatStreamEvent;
					yield {
						type: "tool_call",
						call: { id: "call_1", name: "dice", arguments: { sides: 20 } },
					} satisfies ChatStreamEvent;
					yield { type: "done" } satisfies ChatStreamEvent;
					return;
				}
				yield { type: "delta", text: " it is 17." } satisfies ChatStreamEvent;
				yield { type: "done" } satisfies ChatStreamEvent;
			},
		},
	} as unknown as RowCatClient;
	return { client, sent };
}

describe("tool loop", () => {
	it("without tools the transport is unchanged", async () => {
		const { client, sent } = callingClient();
		const transport = createGenerationTransport(ROWCAT, {
			client,
			credentials: null,
		});
		await drain(transport.stream(request, { signal: signal() }));
		expect(sent).toHaveLength(1);
		expect(sent[0]?.tools).toEqual([]);
	});

	/**
	 * The declaration is attached from registration. It is sent even when the assembler sends an empty
	 * one.
	 */
	it("with registrations the declarations ride on the request", async () => {
		const { client, sent } = callingClient();
		const transport = createGenerationTransport(ROWCAT, {
			client,
			credentials: null,
			toolAccess: { tools: [DICE], isValid: () => true },
		});
		await drain(transport.stream(request, { signal: signal() }));
		expect(sent[0]?.tools.map((tool) => tool.name)).toEqual(["dice"]);
	});

	it("each round trip sends its own request and the caller sees one stream", async () => {
		const { client, sent } = callingClient();
		const transport = createGenerationTransport(ROWCAT, {
			client,
			credentials: null,
			toolAccess: { tools: [DICE], isValid: () => true },
		});
		const seen = await drain(transport.stream(request, { signal: signal() }));

		expect(sent).toHaveLength(2);
		/** Both round trips' bodies reach the caller as one stream. */
		expect(
			seen
				.filter((event) => event.type === "delta")
				.map((event) => event.text)
				.join(""),
		).toBe("picked up. it is 17.");
		expect(seen.filter((event) => event.type === "done")).toHaveLength(1);
	});

	/**
	 * A round trip after leaving the room is spent on a sentence no one will read, and on the managed
	 * path it is billed.
	 */
	it("losing ownership stops the next round trip", async () => {
		const { client, sent } = callingClient();
		const transport = createGenerationTransport(ROWCAT, {
			client,
			credentials: null,
			toolAccess: { tools: [DICE], isValid: () => false },
		});
		await drain(transport.stream(request, { signal: signal() }));
		expect(sent).toHaveLength(1);
	});
});

/**
 * The plan forks here: the protected copy goes through the server assembly path, without the
 * device's tool loop. Wrapping that path with the device loop would declare tools this device does
 * not hold (such as a lore lookup), and the server loop and device loop would stack into two round
 * trips.
 */
describe("assembly plan", () => {
	const storyPlan = {
		kind: "story" as const,
		storyId: "story-1",
		request: {
			messages: [{ role: "user" as const, speaker: "", content: "hello" }],
		},
	};

	it("a protected story goes through the story path with the model attached", async () => {
		const sent: { storyId: string; body: Record<string, unknown> }[] = [];
		const client = {
			chat: {
				stream: () => {
					throw new Error("must not take the plain path");
				},
				streamStory: async function* (
					storyId: string,
					body: Record<string, unknown>,
				) {
					sent.push({ storyId, body });
					yield { type: "done" } satisfies ChatStreamEvent;
				},
			},
		} as unknown as RowCatClient;
		const tool: ChatTool = {
			declaration: {
				name: "lore_search",
				description: "x",
				parameters: [],
			},
			run: async () => "",
		};

		for await (const _ of streamChatGenerationPlan(
			storyPlan,
			ROWCAT,
			{
				client,
				credentials: null,
				toolAccess: { tools: [tool], isValid: () => true },
			},
			{ signal: signal() },
		));

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			storyId: "story-1",
			body: { model: "claude-sonnet-5" },
		});
		expect(sent[0]?.body).not.toHaveProperty("generationId");
		expect(sent[0]?.body).not.toHaveProperty("tools");
	});

	it("sending a protected story via BYO throws instead of using another provider", () => {
		const h = harness();
		expect(() =>
			streamChatGenerationPlan(
				storyPlan,
				ANTHROPIC,
				{ client: h.client, credentials: h.credentials({}) },
				{ signal: signal() },
			),
		).toThrow();
		expect(h.calls).toEqual([]);
	});
});
