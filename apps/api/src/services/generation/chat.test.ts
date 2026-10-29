import { CONTINUATION_FALLBACK_NUDGE } from "@rowcat/chat";
import type {
	ChatStreamEvent,
	ManagedChatGenerationRequest,
	ModelReasoningDto,
	RowCatManagedModel,
} from "@rowcat/contracts";
import { CHAT_ERROR_CODE } from "@rowcat/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildProviderRequestBody,
	rejectsPrefillWithReasoning,
	resolveUpstreamReasoning,
	startChatGeneration,
	translateProviderStream,
	usesExplicitPromptCaching,
} from "./chat.ts";
import { DISCLOSED_PROVIDERS, resolveManagedModel } from "./managed-models.ts";

/**
 * Rules for the body that goes upstream, with no database or network.
 *
 * Covers three things: whether the cache decision keys on the resolved upstream slug, which models
 * get explicit cache control, and that enabling caching does not change the prompt. That real
 * requests go out in this shape is checked by the route test through the app
 * (`routes/chat.test.ts`); that one is skipped without Postgres, so this file always guards the
 * branch.
 */

const request: ManagedChatGenerationRequest = {
	system: "System prompt",
	messages: [{ role: "user", content: "Hi" }],
	tools: [],
	maxOutputTokens: 512,
	reasoningEffort: null,
	context: { requestedMode: "all-ages", minorCharacterPresent: false },
	model: "claude-sonnet-5",
	/** Ordinary generation by default; continuation paths build their own describe. */
	continuation: false,
};

describe("usesExplicitPromptCaching", () => {
	/**
	 * The decision axis is the provider namespace. Hard-coding model names would silently turn caching
	 * off the day the registry's upstream slug is bumped, and the symptom is the invoice, not an
	 * error.
	 */
	it("Anthropic models need explicit cache control", () => {
		expect(usesExplicitPromptCaching("anthropic/claude-sonnet-5")).toBe(true);
		expect(usesExplicitPromptCaching("anthropic/claude-opus-5")).toBe(true);
	});

	it("other providers are left to implicit caching", () => {
		expect(usesExplicitPromptCaching("google/gemini-3-pro")).toBe(false);
		expect(usesExplicitPromptCaching("openai/gpt-5.2")).toBe(false);
	});
});

/**
 * The cache decision stands after routing resolution.
 *
 * The public identity (`claude-sonnet-5`) has no provider namespace; deciding on it would need a
 * second managed-identity list in the caching code, and that copy would be updated on one side only
 * when a model is added, with the invoice as the symptom.
 */
describe("cache decision ← resolved upstream", () => {
	it("doesn't decide from the public identity alone", () => {
		/** Pins the fact that the identity has no `anthropic/` prefix. */
		expect(usesExplicitPromptCaching("claude-sonnet-5")).toBe(false);
		expect(usesExplicitPromptCaching("claude-opus-5")).toBe(false);
	});

	it.each([
		["claude-sonnet-5", true],
		["claude-opus-5", true],
		["deepseek-v4-pro", false],
		["gemini-3.6-flash", false],
		["gpt-5.6-luna", false],
		["mimo-v2.6-flash", false],
		["deepseek-v4.1-flash", false],
		["glm-5.3", false],
		["glm-5.3-flash", false],
		/** A slug with a dot (`anthropic/claude-opus-4.8`) matches the same prefix. */
		["claude-opus-4-8", true],
		["claude-sonnet-4-5", true],
		["claude-fable-5-1", true],
		["gemini-3.8-flash", false],
		["claude-opus-5-5", true],
		["gpt-6-sol", false],
		["gpt-6-luna", false],
		["claude-sonnet-5-5", true],
		["gpt-6.1-sol", false],
	] as const)("%s → cache control after resolution %s", (id, expected) => {
		const upstream = resolveManagedModel(id)?.upstream;
		expect(upstream).toBeTruthy();
		expect(usesExplicitPromptCaching(String(upstream))).toBe(expected);
	});

	/**
	 * Real assembly splits on the same axis; a correct predicate with a different body is useless.
	 */
	it("cache_control is attached only to bodies of managed models resolved to Anthropic", () => {
		const anthropic = buildProviderRequestBody(
			request,
			String(resolveManagedModel("claude-sonnet-5")?.upstream),
		);
		const deepseek = buildProviderRequestBody(
			request,
			String(resolveManagedModel("deepseek-v4-pro")?.upstream),
		);
		expect(anthropic.model).toBe("anthropic/claude-sonnet-5");
		expect(anthropic.cache_control).toEqual({ type: "ephemeral" });
		expect(deepseek.model).toBe("deepseek/deepseek-v4-pro");
		expect(deepseek).not.toHaveProperty("cache_control");
	});
});

describe("buildProviderRequestBody", () => {
	it("turns on automatic prompt caching for Anthropic models", () => {
		const body = buildProviderRequestBody(request, "anthropic/claude-sonnet-5");
		expect(body.cache_control).toEqual({ type: "ephemeral" });
	});

	it("non-Anthropic models still generate as is — just without cache control", () => {
		const body = buildProviderRequestBody(request, "google/gemini-3-pro");
		expect(body).not.toHaveProperty("cache_control");
		expect(body.messages).toEqual([
			{ role: "system", content: "System prompt" },
			{ role: "user", content: "Hi" },
		]);
		expect(body.max_tokens).toBe(512);
		expect(body.stream).toBe(true);
	});

	it("turning caching on doesn't change the prompt by a character", () => {
		/**
		 * A cache optimization that changes what the model sees is a behavior change, not an
		 * optimization. Removing `cache_control` must leave the cached and uncached bodies equal.
		 */
		const { cache_control, ...cached } = buildProviderRequestBody(
			request,
			"anthropic/x",
		);
		expect(cache_control).toEqual({ type: "ephemeral" });
		expect(cached).toEqual({
			...buildProviderRequestBody(request, "other/x"),
			model: "anthropic/x",
		});
	});

	/**
	 * This is not response caching: reusing a whole probabilistic response is a different product
	 * behavior, and only the input cache is enabled. The body must show no trace of it.
	 */
	it("doesn't turn response caching on", () => {
		const body = buildProviderRequestBody(request, "anthropic/claude-sonnet-5");
		const keys = Object.keys(body);
		expect(keys).toEqual([
			"model",
			"provider",
			"cache_control",
			"messages",
			"max_tokens",
			"stream",
			"stream_options",
		]);
	});

	/**
	 * Keeps upstream from retaining prompts; this line enforces a published promise.
	 *
	 * The privacy policy's overseas-transfer table gives the retention period as "the period needed to
	 * generate the response". The gateway default (`data_collection: "allow"`) makes storing providers
	 * candidates, which contradicts that sentence, and the contradiction would only show up as a
	 * public lie.
	 *
	 * Also checks it is sent unconditionally: a branch by model or setting would be a path where the
	 * policy becomes false.
	 */
	it.each([
		"anthropic/claude-sonnet-5",
		"google/gemini-3.7-flash",
		"deepseek/deepseek-v4-pro",
		"xiaomi/mimo-v2.6-flash",
		"z-ai/glm-5.3",
	])("%s — requires not being routed to providers that store data", (model) => {
		const body = buildProviderRequestBody(request, model);
		expect(body.provider).toMatchObject({ data_collection: "deny" });
	});

	/**
	 * Locks the executing providers to a US-based set; this is why the policy's "United States"
	 * (its overseas-transfer disclosure) is true.
	 *
	 * The gateway's default routing includes hosts in other countries serving the same model. The
	 * policy names OpenRouter (US) as the recipient and US-based sub-processors, so a request without
	 * `only` sends prompts to a country not disclosed. Also checks the same list is sent for every
	 * model and that no other routing axis (`order`, `zdr`, `allow_fallbacks`) appears without
	 * grounds.
	 */
	it.each([
		"openai/gpt-5.6-sol",
		"anthropic/claude-sonnet-5",
		"google/gemini-3.7-flash",
		"deepseek/deepseek-v4-pro",
		"xiaomi/mimo-v2.6-flash",
		"z-ai/glm-5.2",
	])("%s — sends only to the disclosed set of US providers", (model) => {
		const body = buildProviderRequestBody(request, model);
		const provider = body.provider as Record<string, unknown>;
		expect(Object.keys(provider)).toEqual(["data_collection", "only"]);
		expect(provider.only).toEqual([...DISCLOSED_PROVIDERS]);
	});

	/**
	 * A host from another country in the list would make the policy's country column false. Blocks the
	 * Chinese-owned hosts that really serve the same models by value, so a change adding one slug is
	 * visible in review.
	 */
	it("the allowlist has no host outside the US", () => {
		for (const foreign of [
			"alibaba",
			"baidu",
			"siliconflow",
			"streamlake",
			"novita",
			"gmicloud",
			"z-ai",
			"xiaomi",
			"deepseek",
		])
			expect(DISCLOSED_PROVIDERS).not.toContain(foreign);
	});

	/**
	 * No room id is sent for routing optimization. That the server has no rooms is a product boundary,
	 * and cache hit rate is no reason to relax it.
	 */
	it("doesn't send room or conversation identifiers upstream", () => {
		const body = buildProviderRequestBody(request, "anthropic/claude-sonnet-5");
		expect(body).not.toHaveProperty("session_id");
		expect(body).not.toHaveProperty("user");
		expect(body).not.toHaveProperty("metadata");
	});

	/**
	 * The upstream `model` is the resolved slug. Sending the request's public identity would give the
	 * gateway an unknown name, and the failure would reach the user only as a 502.
	 */
	it("carries the handed-over upstream slug, not the request's public identity", () => {
		const body = buildProviderRequestBody(request, "anthropic/claude-sonnet-5");
		expect(request.model).toBe("claude-sonnet-5");
		expect(body.model).toBe("anthropic/claude-sonnet-5");
	});
});

/**
 * Reasoning effort: the server does not trust the client.
 *
 * Covers three things: the requested tier becoming an upstream parameter, how a tier the model
 * lacks is folded, and that the body is unchanged when absent. All three can be wrong without an
 * error, showing up only in response character and the invoice.
 */
describe("reasoning parameters", () => {
	const FOUR: ModelReasoningDto = {
		efforts: ["minimal", "low", "medium", "high"],
		defaultEffort: "medium",
	};
	const THREE: ModelReasoningDto = {
		efforts: ["low", "medium", "high"],
		defaultEffort: "medium",
	};

	const bodyFor = (
		effort: ManagedChatGenerationRequest["reasoningEffort"],
		capability: ModelReasoningDto | null,
	) =>
		buildProviderRequestBody(
			{ ...request, reasoningEffort: effort },
			"openai/gpt-5.6-sol",
			capability,
		);

	it("the chosen level goes out as the unified parameter", () => {
		expect(bodyFor("high", FOUR)).toMatchObject({
			reasoning: { effort: "high" },
		});
		expect(bodyFor("minimal", FOUR)).toMatchObject({
			reasoning: { effort: "minimal" },
		});
	});

	/**
	 * Never falls to another model, and never rejects with 400: the failure is not the user's fault
	 * (an old global choice) and would block the conversation.
	 */
	it("an unsupported level folds to that model's default", () => {
		expect(bodyFor("minimal", THREE)).toMatchObject({
			reasoning: { effort: "medium" },
		});
	});

	/**
	 * No key when absent: the body for a non-adjustable model must be byte-identical to before this
	 * axis existed.
	 */
	it("a model that can't be adjusted has no key", () => {
		expect(bodyFor("high", null)).not.toHaveProperty("reasoning");
	});

	it("a request that carries none has no key either", () => {
		expect(bodyFor(null, FOUR)).not.toHaveProperty("reasoning");
	});

	/** This axis touches no other axis; output cap and messages are unchanged. */
	it("the rest of the body doesn't change by a character", () => {
		const { reasoning: _reasoning, ...rest } = bodyFor("high", FOUR);
		expect(rest).toEqual(bodyFor(null, FOUR));
	});

	/**
	 * The normalization rule itself, also checked as a pure function so it cannot diverge from body
	 * assembly.
	 */
	it("normalization has only three branches", () => {
		expect(resolveUpstreamReasoning(FOUR, "low")).toBe("low");
		expect(resolveUpstreamReasoning(THREE, "minimal")).toBe("medium");
		expect(resolveUpstreamReasoning(null, "high")).toBeNull();
		expect(resolveUpstreamReasoning(FOUR, null)).toBeNull();
	});
});

/**
 * Bodies through the real registry. Unlike the section above, which feeds the rules a synthetic
 * capability, this assembles the body from the capability the managed registry actually returns.
 *
 * The checks above can all pass and still be wrong: if the registry holds a tier the model lacks,
 * the body faithfully sends it, the gateway folds it to the nearest value instead of rejecting it,
 * and the mismatch appears in no log.
 */
describe("DeepSeek V4 — the body after the registry", () => {
	/** The two targets under test; narrowing to the vocabulary makes typos a compile error. */
	const DEEPSEEK: readonly RowCatManagedModel[] = [
		"deepseek-v4-pro",
		"deepseek-v4-flash",
	];

	const managedBody = (
		id: RowCatManagedModel,
		effort: ManagedChatGenerationRequest["reasoningEffort"],
	) => {
		const route = resolveManagedModel(id);
		if (!route) throw new Error(`model not in the registry: ${id}`);
		return buildProviderRequestBody(
			{ ...request, model: id, reasoningEffort: effort },
			route.upstream,
			route.reasoning,
		);
	};

	/**
	 * Neither stale clients nor non-web clients can open this door.
	 *
	 * A request can carry anything even when the catalogue lacks the tier: an old browser, a stored
	 * global preference, a direct script. The server re-decides here, and with capability `null` no
	 * value produces the parameter.
	 */
	it.each(
		DEEPSEEK,
	)("whatever level is sent for %s, no reasoning key appears", (id) => {
		for (const effort of ["minimal", "low", "medium", "high", null] as const)
			expect(managedBody(id, effort)).not.toHaveProperty("reasoning");
	});

	/**
	 * Never falls to another model. Reasoning normalization does not touch the target, and this checks
	 * that in the same body; silent provider substitution is something this repository keeps blocking.
	 */
	it("normalization doesn't change the target", () => {
		expect(managedBody("deepseek-v4-pro", "high").model).toBe(
			"deepseek/deepseek-v4-pro",
		);
		expect(managedBody("deepseek-v4-flash", "high").model).toBe(
			"deepseek/deepseek-v4-flash",
		);
	});

	/**
	 * Byte-identical to before this axis. Any trace in the body of a target that does not expose
	 * reasoning (empty object, `null`, default) draws a 400 from upstreams that do not know the key.
	 */
	it("the body is the same as before the reasoning axis existed", () => {
		expect(managedBody("deepseek-v4-pro", "high")).toEqual(
			managedBody("deepseek-v4-pro", null),
		);
	});
});

/**
 * Sticky routing: enabling the cache and returning to that cache are different axes.
 *
 * Locks three things: the value becomes the upstream `session_id` as is; when absent the key itself
 * is absent (`session_id: undefined` would change the body for clients unaware of this axis); and
 * it can stand together with `cache_control`, since if either displaced the other this optimization
 * would vanish entirely on the Anthropic path.
 */
describe("buildProviderRequestBody — routing session", () => {
	const routed: ManagedChatGenerationRequest = {
		...request,
		routingSessionId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
	};

	it("the product vocabulary becomes upstream's session_id", () => {
		expect(
			buildProviderRequestBody(routed, "anthropic/claude-sonnet-5").session_id,
		).toBe("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0");
	});

	/** An old client's body is byte-identical to before this axis. */
	it("absent means the key itself is absent", () => {
		const body = buildProviderRequestBody(request, "anthropic/claude-sonnet-5");
		expect(body).not.toHaveProperty("session_id");
		expect(Object.keys(body)).not.toContain("session_id");
	});

	/**
	 * The two are a pair: cache control says the prefix may be cached, and the session key sends the
	 * next turn to the endpoint holding that cache. Neither replaces the other.
	 */
	it("stands together with cache_control on the Anthropic path", () => {
		const body = buildProviderRequestBody(routed, "anthropic/claude-sonnet-5");
		expect(body.cache_control).toEqual({ type: "ephemeral" });
		expect(body.session_id).toBe("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0");
	});

	/**
	 * Also applies to upstreams without cache control; their caching is implicit and unrelated to
	 * routing.
	 */
	it("attached for non-Anthropic upstreams too", () => {
		const body = buildProviderRequestBody(routed, "google/gemini-3-pro");
		expect(body).not.toHaveProperty("cache_control");
		expect(body.session_id).toBe("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0");
	});

	/**
	 * The prompt and routing constraints are unchanged. If this axis altered the context or disturbed
	 * no-retention routing, that would be a different change, not a cost optimization.
	 */
	it("doesn't touch the prompt, routing constraints or caps", () => {
		const base = buildProviderRequestBody(request, "anthropic/claude-sonnet-5");
		const body = buildProviderRequestBody(routed, "anthropic/claude-sonnet-5");
		expect(body.messages).toEqual(base.messages);
		expect(body.provider).toEqual(base.provider);
		expect(body.max_tokens).toEqual(base.max_tokens);
		expect({ ...body, session_id: undefined }).toEqual({
			...base,
			session_id: undefined,
		});
	});
});

/**
 * Whether `Continue generating` on the managed path works upstream.
 *
 * The gateway takes one OpenAI-compatible shape, but upstream constraints follow through. Anthropic
 * differs per model: 4.6+ rejects assistant prefill itself (so it uses the nudge), and the 4.5
 * generation, which accepts prefill, rejects prefill on a thinking-enabled request and trailing
 * whitespace in the last assistant content. All are 400s that reach the user only as `Generation failed.`.
 *
 * Holds by value that "OpenAI-compatible means identical" is not assumed: upstreams without the
 * constraint carry reasoning parameters on continuation too.
 */
const continuation: ManagedChatGenerationRequest = {
	...request,
	messages: [
		{ role: "user", content: "Continue" },
		{ role: "assistant", content: "The door opens and he" },
	],
	continuation: true,
	reasoningEffort: "high",
};

const capability: ModelReasoningDto = {
	efforts: ["low", "medium", "high"],
	defaultEffort: "medium",
};

type SentMessages = { role: string; content: string }[];

describe("rejectsPrefillWithReasoning", () => {
	it("the Anthropic family can't take a prefill and reasoning together", () => {
		expect(rejectsPrefillWithReasoning("anthropic/claude-sonnet-4.5")).toBe(
			true,
		);
		expect(rejectsPrefillWithReasoning("anthropic/claude-haiku-4.5")).toBe(
			true,
		);
	});

	it("other upstreams have no such constraint", () => {
		for (const model of [
			"google/gemini-3.5-flash",
			"openai/gpt-6-astra",
			"deepseek/deepseek-v4-pro",
		])
			expect(rejectsPrefillWithReasoning(model)).toBe(false);
	});
});

describe("continuation body — prefill shape", () => {
	/**
	 * Trailing whitespace in a prefill is a 400 on Anthropic. A cut response often ends mid-sentence
	 * on a space, so without trimming that room's `Continue generating` would always fail.
	 */
	it("strips the prefill's trailing whitespace", () => {
		const body = buildProviderRequestBody(
			continuation,
			"anthropic/claude-sonnet-4.5",
			capability,
			"prefill",
		);
		expect((body.messages as SentMessages).at(-1)).toEqual({
			role: "assistant",
			content: "The door opens and he",
		});
	});

	/**
	 * Trimming applies to every upstream; both paths must send the same prefill to get the same
	 * result.
	 */
	it("trims on other upstreams too", () => {
		const body = buildProviderRequestBody(
			continuation,
			"google/gemini-3.5-flash",
			capability,
			"prefill",
		);
		expect((body.messages as SentMessages).at(-1)?.content).toBe(
			"The door opens and he",
		);
	});

	/**
	 * Prefill + reasoning is a 400 on Anthropic upstreams and disappears when reasoning is off, so the
	 * cause stays hidden. The registry's current prefill lines (4.5 generation) have no managed
	 * reasoning capability, but this blocks the combination itself rather than relying on that.
	 */
	it("drops the reasoning parameter for prefill continuation on the Anthropic upstream", () => {
		const body = buildProviderRequestBody(
			continuation,
			"anthropic/claude-sonnet-4.5",
			capability,
			"prefill",
		);
		expect(body.reasoning).toBeUndefined();
	});

	/** Upstreams without the constraint do not lose the user's chosen setting. */
	it("continuation on other upstreams carries the reasoning parameter as is", () => {
		const body = buildProviderRequestBody(
			continuation,
			"google/gemini-3.5-flash",
			capability,
			"prefill",
		);
		expect(body.reasoning).toEqual({ effort: "high" });
	});

	/** Ordinary generation is unchanged. */
	it("outside continuation, reasoning is carried on Anthropic too", () => {
		const body = buildProviderRequestBody(
			{ ...continuation, continuation: false },
			"anthropic/claude-sonnet-4.5",
			capability,
			"prefill",
		);
		expect(body.reasoning).toEqual({ effort: "high" });
	});
});

describe("continuation body — nudge shape", () => {
	/**
	 * Upstreams that do not accept prefill end with a nudge. That is Claude 4.6+ (confirmed
	 * 2026-09-23: 400 even without reasoning), and before this shape existed managed `Continue generating` always
	 * failed on those models.
	 *
	 * The cut response stands before the nudge as stored: the whitespace constraint applies only to
	 * the last assistant content, and the trailing whitespace tells the model the cut fell between
	 * words.
	 */
	it("keeps the cut response as stored and ends with a nudge", () => {
		const body = buildProviderRequestBody(
			continuation,
			"anthropic/claude-sonnet-5",
			capability,
			"nudge",
		);
		expect(body.messages).toEqual([
			{ role: "system", content: "System prompt" },
			{ role: "user", content: "Continue" },
			{ role: "assistant", content: "The door opens and he" },
			{ role: "user", content: CONTINUATION_FALLBACK_NUDGE },
		]);
	});

	/**
	 * A nudge has no prefill, so the constraint does not apply; reasoning is carried even on Anthropic
	 * upstreams.
	 */
	it("doesn't drop the reasoning parameter", () => {
		const body = buildProviderRequestBody(
			continuation,
			"anthropic/claude-sonnet-5",
			capability,
			"nudge",
		);
		expect(body.reasoning).toEqual({ effort: "high" });
	});

	/**
	 * Without a shape the nudge is used: a conversation ending on a user turn is accepted by every
	 * upstream, while prefill is used only for confirmed lines, since sending it blindly could make
	 * that continuation always fail.
	 */
	it("goes to nudge when no shape is passed", () => {
		const body = buildProviderRequestBody(
			continuation,
			"anthropic/claude-sonnet-5",
			capability,
		);
		expect((body.messages as SentMessages).at(-1)).toEqual({
			role: "user",
			content: CONTINUATION_FALLBACK_NUDGE,
		});
	});

	/** Ordinary generation gets no nudge; the shape applies to continuation only. */
	it("outside continuation the messages are unchanged", () => {
		const body = buildProviderRequestBody(
			{ ...continuation, continuation: false },
			"anthropic/claude-sonnet-5",
			capability,
			"nudge",
		);
		expect((body.messages as SentMessages).at(-1)).toEqual({
			role: "assistant",
			content: "The door opens and he",
		});
	});
});

describe("continuation body — what both shapes share", () => {
	/**
	 * If the conversation does not end on the assistant, nothing is done. The continuation premise
	 * already broke, there is nothing to revive, and an invented nudge would create a turn the user
	 * never pressed.
	 */
	it.each([
		"prefill",
		"nudge",
	] as const)("%s — leaves the messages alone when the last one isn't the assistant", (shape) => {
		const messages = [{ role: "user" as const, content: "Hi" }];
		const body = buildProviderRequestBody(
			{ ...continuation, messages },
			"anthropic/claude-sonnet-5",
			capability,
			shape,
		);
		expect(body.messages).toEqual([
			{ role: "system", content: "System prompt" },
			...messages,
		]);
	});

	/** System prompt, routing and cache control are unchanged in continuation. */
	it.each([
		"prefill",
		"nudge",
	] as const)("%s — the system prompt and routing constraints are unchanged", (shape) => {
		const body = buildProviderRequestBody(
			continuation,
			"anthropic/claude-sonnet-5",
			capability,
			shape,
		);
		expect((body.messages as SentMessages)[0]).toEqual({
			role: "system",
			content: "System prompt",
		});
		expect(body.cache_control).toEqual({ type: "ephemeral" });
		expect(body.provider).toEqual({
			data_collection: "deny",
			only: [...DISCLOSED_PROVIDERS],
		});
	});
});

/**
 * Whether the registry's shape actually reaches the upstream body, through the real entry point.
 *
 * The pure function defaults to nudge, so if the one line in `startChatGeneration` that passes the
 * registry value were dropped, prefill lines (4.5 generation) would silently become nudges while
 * every pure check stayed green. So only `fetch` is intercepted here and the rest goes through the
 * production path, unlike the other checks in this file, which pass arguments by hand.
 */
describe("startChatGeneration — the registry decides the continuation shape", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const upstreamBodyFor = async (
		model: RowCatManagedModel,
	): Promise<Record<string, unknown>> => {
		const sent: string[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
			sent.push(String(init?.body));
			return new Response("data: [DONE]\n\n", {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		});
		const events = await startChatGeneration(
			{ ...continuation, model },
			new AbortController().signal,
		);
		for await (const _event of events) {
			// Drain the body so the upstream socket is released; what is checked here is the request side.
		}
		const [raw] = sent;
		if (raw === undefined) throw new Error("no upstream request went out");
		return JSON.parse(raw) as Record<string, unknown>;
	};

	it.each([
		"claude-fable-5-1",
		"claude-opus-5-5",
		"claude-sonnet-5-5",
		"claude-sonnet-5",
		"claude-opus-4-6",
	] as const)("%s goes out as a nudge and carries reasoning", async (model) => {
		const body = await upstreamBodyFor(model);
		expect((body.messages as SentMessages).at(-1)).toEqual({
			role: "user",
			content: CONTINUATION_FALLBACK_NUDGE,
		});
		expect(body.reasoning).toEqual({ effort: "high" });
	});

	it.each([
		"claude-haiku-4-5",
		"claude-sonnet-4-5",
	] as const)("%s goes out as a prefill", async (model) => {
		const body = await upstreamBodyFor(model);
		expect((body.messages as SentMessages).at(-1)).toEqual({
			role: "assistant",
			content: "The door opens and he",
		});
	});
});

/**
 * Upstream shape of tool calls. This file guards two things.
 *
 * One is symmetry of absence: a request that declares no tools must have a body byte-identical to
 * before this axis existed, which is the whole of old-client compatibility.
 *
 * The other is role translation: our messages and this spec's messages once happened to share a
 * shape (`{ role, content }`) and the tool role ended that coincidence; without translation
 * upstream reads an unpaired call and answers 400.
 */
describe("tool declarations", () => {
	const dice = {
		name: "dice",
		description: "Rolls a die",
		parameters: [
			{
				name: "sides",
				type: "number" as const,
				description: "number of faces",
				required: true,
				choices: [],
			},
			{
				name: "label",
				type: "string" as const,
				description: "",
				required: false,
				choices: ["a", "b"],
			},
		],
	};

	it("no tools means the key itself is absent", () => {
		const body = buildProviderRequestBody(request, "anthropic/claude-sonnet-5");
		expect("tools" in body).toBe(false);
		expect("parallel_tool_calls" in body).toBe(false);
	});

	/**
	 * The contract narrows to one call per stream, so we first ask upstream not to send parallel
	 * calls.
	 */
	it("with tools, parallel calls are turned off too", () => {
		const body = buildProviderRequestBody(
			{ ...request, tools: [dice] },
			"anthropic/claude-sonnet-5",
		);
		expect(body.parallel_tool_calls).toBe(false);
		expect(body.tools).toEqual([
			{
				type: "function",
				function: {
					name: "dice",
					description: "Rolls a die",
					parameters: {
						type: "object",
						properties: {
							sides: { type: "number", description: "number of faces" },
							label: { type: "string", enum: ["a", "b"] },
						},
						required: ["sides"],
						additionalProperties: false,
					},
				},
			},
		]);
	});

	/** This spec's arguments are a JSON string, not an object. */
	it("moves the assistant turn carrying the call and its result under the spec's names", () => {
		const body = buildProviderRequestBody(
			{
				...request,
				messages: [
					{ role: "user", content: "Roll it" },
					{
						role: "assistant",
						content: "He picked up the die.",
						toolCall: { id: "call_1", name: "dice", arguments: { sides: 20 } },
					},
					{ role: "tool", callId: "call_1", content: "17" },
				],
			},
			"anthropic/claude-sonnet-5",
		);
		expect(body.messages).toEqual([
			{ role: "system", content: "System prompt" },
			{ role: "user", content: "Roll it" },
			{
				role: "assistant",
				content: "He picked up the die.",
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "dice", arguments: '{"sides":20}' },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_1", content: "17" },
		]);
	});

	/**
	 * The reassembled assistant turn lacks the reasoning blocks upstream attached. The Gemini 3 family
	 * keeps the call's signature in that array and rejects 400 when it arrives missing, so it is put
	 * back in place without being opened.
	 */
	it("returns the call's round-trip state to the reasoning block slot", () => {
		const state = JSON.stringify([
			{ type: "reasoning.encrypted", data: "AAAA", format: "google-gemini-v1" },
		]);
		const body = buildProviderRequestBody(
			{
				...request,
				messages: [
					{ role: "user", content: "Roll it" },
					{
						role: "assistant",
						content: "",
						toolCall: {
							id: "call_1",
							name: "dice",
							arguments: { sides: 20 },
							providerState: state,
						},
					},
					{ role: "tool", callId: "call_1", content: "17" },
				],
			},
			"google/gemini-3.7-flash",
		);
		expect((body.messages as Record<string, unknown>[])[2]).toMatchObject({
			role: "assistant",
			reasoning_details: [
				{
					type: "reasoning.encrypted",
					data: "AAAA",
					format: "google-gemini-v1",
				},
			],
		});
	});

	/**
	 * An unreadable value produces no key; a request equal to one from before this axis existed beats
	 * sending an invented array.
	 */
	it("no key when the round-trip state is missing or broken", () => {
		for (const providerState of [undefined, "not an array"]) {
			const body = buildProviderRequestBody(
				{
					...request,
					messages: [
						{
							role: "assistant",
							content: "",
							toolCall: {
								id: "call_1",
								name: "dice",
								arguments: { sides: 20 },
								...(providerState === undefined ? {} : { providerState }),
							},
						},
						{ role: "tool", callId: "call_1", content: "17" },
					],
				},
				"google/gemini-3.7-flash",
			);
			const assistant = (body.messages as Record<string, unknown>[])[1];
			expect(assistant && "reasoning_details" in assistant).toBe(false);
		}
	});

	/** Messages of a tool-free conversation keep their old shape through translation. */
	it("messages without tools keep their shape", () => {
		const body = buildProviderRequestBody(request, "other/x");
		expect(body.messages).toEqual([
			{ role: "system", content: "System prompt" },
			{ role: "user", content: "Hi" },
		]);
	});
});

// Upstream stream → our frames

/** One SSE set from upstream; runs just this function, with no database or network. */
const providerStream = (
	frames: readonly string[],
): ReadableStream<Uint8Array> => {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const frame of frames) controller.enqueue(encoder.encode(frame));
			controller.close();
		},
	});
};

const collectFrames = async (
	body: ReadableStream<Uint8Array>,
): Promise<ChatStreamEvent[]> => {
	const events: ChatStreamEvent[] = [];
	for await (const event of translateProviderStream(
		body,
		"claude-sonnet-5",
		"anthropic/claude-sonnet-5",
	))
		events.push(event);
	return events;
};

const toolCallFrame = (index: number, name: string, args: string): string =>
	`data: ${JSON.stringify({
		choices: [
			{
				delta: {
					tool_calls: [
						{ index, id: `call_${index}`, function: { name, arguments: args } },
					],
				},
			},
		],
	})}\n\n`;

describe("tool calls in the upstream stream", () => {
	it("gathers fragmented arguments into one complete call", async () => {
		const events = await collectFrames(
			providerStream([
				toolCallFrame(0, "dice", '{"sid'),
				toolCallFrame(0, "", 'es":6}'),
				'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
				"data: [DONE]\n\n",
			]),
		);
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "call_0", name: "dice", arguments: { sides: 6 } },
			},
		]);
		expect(events.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
	});

	/**
	 * Only encrypted blocks are sent. Passing human-readable reasoning text or summaries would send
	 * that prose to the device and into the next request, breaking the line this repository draws that
	 * thinking content is stored nowhere, on the managed path only.
	 */
	it("sends only encrypted reasoning blocks along with the call", async () => {
		const reasoning = (details: unknown[]): string =>
			`data: ${JSON.stringify({ choices: [{ delta: { reasoning_details: details } }] })}\n\n`;
		const events = await collectFrames(
			providerStream([
				reasoning([
					{ type: "reasoning.text", text: "Let me look up the lore first" },
				]),
				reasoning([{ type: "reasoning.encrypted", data: "AAAA", index: 0 }]),
				reasoning([{ type: "reasoning.summary", summary: "summary" }]),
				reasoning([{ type: "reasoning.encrypted", data: "BBBB", index: 1 }]),
				toolCallFrame(0, "dice", '{"sides":6}'),
				"data: [DONE]\n\n",
			]),
		);
		const call = events.find((event) => event.type === "tool_call");
		const state = call?.type === "tool_call" ? call.call.providerState : "";
		expect(JSON.parse(state ?? "[]")).toEqual([
			{ type: "reasoning.encrypted", data: "AAAA", index: 0 },
			{ type: "reasoning.encrypted", data: "BBBB", index: 1 },
		]);
		expect(state).not.toContain("Let me look up the lore");
		expect(state).not.toContain("summary");
	});

	/** A model that does not require it gets the same frame as before this axis. */
	it("no reasoning block means no round-trip state", async () => {
		const events = await collectFrames(
			providerStream([
				toolCallFrame(0, "dice", '{"sides":6}'),
				"data: [DONE]\n\n",
			]),
		);
		const call = events.find((event) => event.type === "tool_call");
		expect(call?.type === "tool_call" && call.call.providerState).toBe(
			undefined,
		);
	});

	/**
	 * Keeps the first call and the turn survives. This was once an error, which would kill the turn
	 * after body text already streamed and leave a response stopped mid-sentence. An unpaired call
	 * does not make the next request a 400 because the device builds that request's assistant turn
	 * (`nextChatToolRequest`).
	 */
	it("of parallel calls only the first remains, and the body and finish flow as is", async () => {
		const events = await collectFrames(
			providerStream([
				'data: {"choices":[{"delta":{"content":"Let me look."}}]}\n\n',
				toolCallFrame(0, "dice", '{"sides":6}'),
				toolCallFrame(1, "dice", '{"sides":20}'),
				'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
				"data: [DONE]\n\n",
			]),
		);
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "call_0", name: "dice", arguments: { sides: 6 } },
			},
		]);
		expect(events.filter((event) => event.type === "error")).toEqual([]);
		expect(events[0]).toEqual({ type: "delta", text: "Let me look." });
		expect(events.at(-1)?.type).toBe("done");
	});

	/**
	 * Broken arguments do not kill the turn. Hitting the output cap leaves the argument JSON cut in
	 * half, which is common while the call itself is fine; sent as "unreadable", the device's ruling
	 * returns a sentence and the model can call again.
	 */
	it("broken argument JSON goes out as an unreadable call", async () => {
		const events = await collectFrames(
			providerStream([
				toolCallFrame(0, "dice", "{broken JSON"),
				"data: [DONE]\n\n",
			]),
		);
		expect(events.filter((event) => event.type === "tool_call")).toEqual([
			{
				type: "tool_call",
				call: { id: "call_0", name: "dice", arguments: null },
			},
		]);
		expect(events.filter((event) => event.type === "error")).toEqual([]);
		expect(events.at(-1)?.type).toBe("done");
	});

	/**
	 * Only the case where no pairing can be returned remains: a name outside the vocabulary has no
	 * slot to carry it, and upstream does not recognize its own call under an invented name.
	 */
	it("a name outside the vocabulary ends in an error", async () => {
		const events = await collectFrames(
			providerStream([
				toolCallFrame(0, "functions.dice", '{"sides":6}'),
				"data: [DONE]\n\n",
			]),
		);
		expect(events.at(-1)).toMatchObject({
			type: "error",
			code: CHAT_ERROR_CODE.providerFailed,
		});
		expect(events.some((event) => event.type === "done")).toBe(false);
	});

	/** A stream with no tool call carries no such frame at all. */
	it("not calling a tool means no tool_call frame", async () => {
		const events = await collectFrames(
			providerStream([
				'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
				'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
				"data: [DONE]\n\n",
			]),
		);
		expect(events.some((event) => event.type === "tool_call")).toBe(false);
		expect(events).toEqual([
			{ type: "delta", text: "Hi" },
			{ type: "done", finishReason: "stop" },
		]);
	});
});
