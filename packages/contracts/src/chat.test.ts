import { describe, expect, it } from "vitest";
import {
	CHAT_MAX_MESSAGE_CHARS,
	CHAT_MAX_TOOL_PROVIDER_STATE_CHARS,
	CHAT_MAX_TOOL_RESULT_CHARS,
	ChatGenerationMessage,
	ChatGenerationRequest,
	ChatGenerationRole,
	ChatStreamEvent,
	ChatToolCall,
	ChatToolDeclaration,
	ManagedChatGenerationRequest,
	RoutingSessionId,
} from "./chat.ts";

/**
 * Boundary of the generation request: what may cross this line and what may not.
 *
 * This locks in a risk that one routing field could bring in. The value leaves RowCat's server,
 * since the gateway receives it as a routing hint. If the contract did not narrow its shape, a
 * caller could one day put a room id or member id there, and that single line would break the claim
 * that the server holds no rooms.
 */

const base = {
	system: "System prompt",
	messages: [{ role: "user" as const, content: "hello" }],
};

describe("RoutingSessionId", () => {
	/**
	 * Shapes issued by the two id generators in this repo: web UUIDs and mobile Crockford base32.
	 */
	it.each([
		"0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
		"01J8ZQ4K7M2N3P5R6S7T8V9W0X",
	])("accepts what the id generator produces: %s", (value) => {
		expect(RoutingSessionId.safeParse(value).success).toBe(true);
	});

	/**
	 * Structured values are blocked by the contract, and this list is why the schema exists. Each
	 * entry is a value that would plausibly be sent if the field were a plain string, and none of them
	 * is opaque.
	 */
	it.each([
		"room:01J8ZQ4K7M2N3P5R6S7T8V9W0X",
		"member/abc123def456ghi789",
		"user@example.com",
		"story 01J8ZQ4K7M2N3P5R",
		"short",
		"x".repeat(65),
	])("refuses structured and out-of-range values: %s", (value) => {
		expect(RoutingSessionId.safeParse(value).success).toBe(false);
	});
});

describe("ChatGenerationRequest: the routing axis", () => {
	/**
	 * A client that does not know this field must send the same request it always did. Filling in null
	 * or an empty string would create a key in the upstream body.
	 */
	it("omitted means no key at all", () => {
		const parsed = ChatGenerationRequest.parse(base);
		expect(parsed).not.toHaveProperty("routingSessionId");
	});

	it("an opaque value passes as is", () => {
		expect(
			ChatGenerationRequest.parse({
				...base,
				routingSessionId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
			}).routingSessionId,
		).toBe("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0");
	});

	it("a request carrying a room id becomes 400", () => {
		expect(
			ChatGenerationRequest.safeParse({
				...base,
				routingSessionId: "room:01J8ZQ4K7M2N3P5R6S7T8V9W0X",
			}).success,
		).toBe(false);
	});

	/**
	 * Caching does not require identity. Room, work, member, and device ids have no place in this
	 * contract, and neither do upstream slugs or provider endpoints.
	 *
	 * The whole key set is counted on purpose. A check for 'no sensitive fields' would pass until a
	 * new field arrived and leaked.
	 */
	it("the request vocabulary is closed and carries no identity", () => {
		expect(Object.keys(ChatGenerationRequest.shape).sort()).toEqual([
			"context",
			"continuation",
			"maxOutputTokens",
			"messages",
			"reasoningEffort",
			"routingSessionId",
			"system",
			"tools",
		]);
		expect(Object.keys(ManagedChatGenerationRequest.shape).sort()).toEqual([
			"context",
			"continuation",
			"maxOutputTokens",
			"messages",
			"model",
			"reasoningEffort",
			"routingSessionId",
			"system",
			"tools",
		]);
	});
});

/**
 * The tool-call vocabulary is intentionally narrow. This file guards an absence, not a feature.
 *
 * The contract is easy to widen and never narrowed, so the absence of parallel calls, forced tool
 * choice, argument streaming, and nested parameters is pinned as values. A comment alone would
 * invite someone to add one 'just this once'.
 */
describe("tool call vocabulary", () => {
	it("a request declaring no tools is the same as before this axis", () => {
		expect(ChatGenerationRequest.parse(base).tools).toEqual([]);
	});

	/** The intersection of the three providers. No adapter should rename a tool. */
	it.each(["lore_search", "dice", "c"])("accepts tool name: %s", (name) => {
		expect(
			ChatToolDeclaration.safeParse({ name, description: "Description" })
				.success,
		).toBe(true);
	});

	it.each([
		"LoreSearch",
		"lore-search",
		"lore.search",
		"_lore",
		"1dice",
		"",
	])("refuses names that would need conversion: %s", (name) => {
		expect(
			ChatToolDeclaration.safeParse({ name, description: "Description" })
				.success,
		).toBe(false);
	});

	/** Without a description the model picks by name alone, and the failure is silent. */
	it("refuses a declaration without a description", () => {
		expect(
			ChatToolDeclaration.safeParse({ name: "dice", description: "" }).success,
		).toBe(false);
	});

	/** Flat scalars only. Opening arrays or objects would mean partly reimplementing JSON Schema. */
	it.each([
		"array",
		"object",
		"integer",
		"null",
	])("refuses non-scalar parameter types: %s", (type) => {
		expect(
			ChatToolDeclaration.safeParse({
				name: "dice",
				description: "Dice",
				parameters: [{ name: "sides", type }],
			}).success,
		).toBe(false);
	});

	it("refuses two parameters with the same name", () => {
		expect(
			ChatToolDeclaration.safeParse({
				name: "dice",
				description: "Dice",
				parameters: [
					{ name: "sides", type: "number" },
					{ name: "sides", type: "string" },
				],
			}).success,
		).toBe(false);
	});

	/** A call carries no identity field, because its values are sent upstream. */
	it("the call vocabulary is closed and carries no identity", () => {
		expect(Object.keys(ChatToolCall.shape).sort()).toEqual([
			"arguments",
			"id",
			"name",
			"providerState",
		]);
	});

	/**
	 * Unread arguments and empty arguments are different values. Sharing one slot for both would stop
	 * the round trip before a verdict, and the turn would die for lack of vocabulary.
	 */
	it("unreadable arguments are `null` and no arguments is an empty object", () => {
		expect(
			ChatToolCall.parse({ id: "toolu_1", name: "dice", arguments: null })
				.arguments,
		).toBeNull();
		expect(
			ChatToolCall.parse({ id: "toolu_1", name: "dice" }).arguments,
		).toEqual({});
	});

	/**
	 * Many models write null for an absent value. Treating that call as a protocol error would kill
	 * the whole turn, so null is accepted.
	 */
	it("accepts `null` argument values", () => {
		expect(
			ChatToolCall.safeParse({
				id: "toolu_1",
				name: "dice",
				arguments: { sides: 6, label: null },
			}).success,
		).toBe(true);
	});

	/**
	 * A provider state is normally absent. Only one provider requires it, so making it required would
	 * reject calls on every other path.
	 */
	it("a call stands without echo state", () => {
		const parsed = ChatToolCall.parse({ id: "toolu_1", name: "lore_search" });
		expect(parsed.providerState).toBeUndefined();
	});

	/**
	 * The shape is not narrowed. Knowing it would make this contract aware of provider reasoning
	 * vocabulary. Only an upper bound is set.
	 */
	it("echo state is opaque with only a cap", () => {
		expect(
			ChatToolCall.safeParse({
				id: "toolu_1",
				name: "lore_search",
				providerState: "Cg8KDQoLc2lnbmF0dXJlLi4=",
			}).success,
		).toBe(true);
		expect(
			ChatToolCall.safeParse({
				id: "toolu_1",
				name: "lore_search",
				providerState: "x".repeat(CHAT_MAX_TOOL_PROVIDER_STATE_CHARS + 1),
			}).success,
		).toBe(false);
	});

	/** Tool results are machine-generated values resent every turn, not human-written speech. */
	it("the tool result cap is below the message cap", () => {
		expect(CHAT_MAX_TOOL_RESULT_CHARS).toBeLessThan(CHAT_MAX_MESSAGE_CHARS);
	});
});

/**
 * A discriminated union by role, because expressibility is the reason for this shape.
 *
 * A single object with optional fields would allow user messages carrying tool calls, and tool
 * results with no matching call. Those requests would only fail with a 400 once they reached
 * upstream.
 */
describe("generation messages", () => {
	it("all three roles have a body", () => {
		for (const message of [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "Yes" },
			{ role: "tool", callId: "toolu_1", content: "Result" },
		]) {
			const parsed = ChatGenerationMessage.parse(message);
			expect(parsed.content).toBeTypeOf("string");
		}
	});

	it("an assistant turn carries a body and calls together", () => {
		const parsed = ChatGenerationMessage.parse({
			role: "assistant",
			content: "As the door opened,",
			toolCall: {
				id: "toolu_1",
				name: "lore_search",
				arguments: { q: "Tavern" },
			},
		});
		expect(parsed.role === "assistant" && parsed.toolCall?.name).toBe(
			"lore_search",
		);
	});

	it("a user utterance cannot hold tool calls", () => {
		const parsed = ChatGenerationMessage.parse({
			role: "user",
			content: "hello",
			toolCall: { id: "toolu_1", name: "lore_search", arguments: {} },
		});
		expect("toolCall" in parsed).toBe(false);
	});

	it("refuses an unpaired tool result", () => {
		expect(
			ChatGenerationMessage.safeParse({ role: "tool", content: "Result" })
				.success,
		).toBe(false);
	});

	/**
	 * An adapter that does not know a third role should fail. Folding it into user turns would be much
	 * worse.
	 */
	it("there are three wire roles", () => {
		expect([...ChatGenerationRole.options].sort()).toEqual([
			"assistant",
			"tool",
			"user",
		]);
	});
});

describe("tool_call frames", () => {
	it("not a terminal frame; done comes separately", () => {
		const parsed = ChatStreamEvent.parse({
			type: "tool_call",
			call: { id: "toolu_1", name: "dice", arguments: { sides: 20 } },
		});
		expect(parsed.type).toBe("tool_call");
		expect(ChatStreamEvent.parse({ type: "done" }).type).toBe("done");
	});

	/** Arguments are complete values. Partial JSON is finished inside the adapter. */
	it("refuses a frame carrying a partial argument string", () => {
		expect(
			ChatStreamEvent.safeParse({
				type: "tool_call",
				call: { id: "toolu_1", name: "dice", arguments: '{"sides":' },
			}).success,
		).toBe(false);
	});
});
