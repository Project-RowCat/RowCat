import {
	CHAT_MAX_TOOL_RESULT_CHARS,
	ChatGenerationMessage,
	type ChatToolCall,
} from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import {
	CHAT_TOOL_EMPTY_RESULT,
	CHAT_TOOL_RESULT_BOUNDARY,
	CHAT_TOOL_TRUNCATED_NOTICE,
	type ChatTool,
	chatToolDeclarations,
	chatToolErrorText,
	chatToolFailureText,
	chatToolResultMessage,
	readChatToolCall,
	resolveChatToolCall,
} from "./tool.ts";

/**
 * What the tests in this file check in the judgment layer: two things.
 *
 * First, no leniency. Fixing a value or dropping an unknown key is leniency. Once opened, the point
 * where it stops differs per caller, so the same conversation would run differently on each device.
 *
 * Second, boundary sentences survive. Tool results are untrusted input that enters
 * mid-conversation, and the safety policy's head and tail guards do not cover that position. If
 * truncation pushes the boundary sentence out, the request reaches upstream with no distinction
 * between data and instructions, and nothing reports it.
 */

const dice: ChatTool = {
	declaration: {
		name: "dice",
		description: "주사위를 굴린다",
		parameters: [
			{
				name: "sides",
				type: "number",
				description: "면 수",
				required: true,
				choices: [],
			},
			{
				name: "label",
				type: "string",
				description: "names",
				required: false,
				choices: [],
			},
		],
	},
	run: async () => "17",
};

const lore: ChatTool = {
	declaration: {
		name: "lore_search",
		description: "로어를 찾는다",
		parameters: [
			{
				name: "scope",
				type: "string",
				description: "범위",
				required: true,
				choices: ["place", "person"],
			},
		],
	},
	run: async () => "술집: 낡은 간판",
};

const call = (
	name: string,
	args: ChatToolCall["arguments"] = {},
): ChatToolCall => ({ id: "toolu_1", name, arguments: args });

describe("chatToolDeclarations", () => {
	/**
	 * If declaration and execution were written in two places, the mismatch would surface only after
	 * the model called that name. Declarations are derived from the registration instead.
	 */
	it("declarations come from registration", () => {
		expect(chatToolDeclarations([dice, lore]).map((d) => d.name)).toEqual([
			"dice",
			"lore_search",
		]);
	});
});

/**
 * What this group guarantees is that the turn does not die. While three adapters each ran one
 * `safeParse` and ended with an error on failure, common triggers such as a truncated stream or an
 * optional argument passed as `null` ended the turn. Users got a response that stopped
 * mid-sentence, and retrying stopped in the same place.
 */
describe("readChatToolCall", () => {
	it("readable calls pass as is", () => {
		expect(
			readChatToolCall({
				id: "toolu_1",
				name: "dice",
				arguments: { sides: 20 },
			}),
		).toEqual({ id: "toolu_1", name: "dice", arguments: { sides: 20 } });
	});

	/** A failure to read the arguments and a call the contract cannot use are different failures. */
	it("only arguments outside the vocabulary make an unreadable call", () => {
		for (const args of [null, "문자열", [1, 2], { depth: { nested: 1 } }])
			expect(
				readChatToolCall({ id: "toolu_1", name: "dice", arguments: args }),
			).toEqual({ id: "toolu_1", name: "dice", arguments: null });
	});

	/** A call with no arguments is an empty object, which is distinct from an unreadable one. */
	it("no arguments means an empty object", () => {
		expect(
			readChatToolCall({ id: "toolu_1", name: "dice", arguments: undefined })
				?.arguments,
		).toEqual({});
	});

	/**
	 * `null` is returned only when there is no valid pair to send back. A fabricated name would stop
	 * the upstream from recognizing its own call.
	 */
	it("identity or name outside the vocabulary is unusable", () => {
		expect(
			readChatToolCall({
				id: "toolu_1",
				name: "functions.dice",
				arguments: {},
			}),
		).toBeNull();
		expect(
			readChatToolCall({ id: "호출 1", name: "dice", arguments: {} }),
		).toBeNull();
	});

	/**
	 * Provider state must survive even in a round trip whose arguments were unreadable, because that
	 * request is still sent.
	 */
	it("echo state rides on both branches", () => {
		for (const args of [{ sides: 20 }, "읽지 못함"])
			expect(
				readChatToolCall({
					id: "toolu_1",
					name: "dice",
					arguments: args,
					providerState: "Cg8KDQoL",
				})?.providerState,
			).toBe("Cg8KDQoL");
	});
});

describe("resolveChatToolCall", () => {
	it("passes a valid call", () => {
		const resolved = resolveChatToolCall([dice], call("dice", { sides: 20 }));
		expect(resolved.status).toBe("ok");
		expect(resolved.status === "ok" && resolved.arguments).toEqual({
			sides: 20,
		});
	});

	it("optional arguments may be absent", () => {
		expect(resolveChatToolCall([dice], call("dice", { sides: 6 })).status).toBe(
			"ok",
		);
	});

	/** Lists what can be called. It is the list already declared, so it leaks nothing new. */
	it("returns a missing tool together with the callable ones", () => {
		const resolved = resolveChatToolCall([dice], call("summon"));
		expect(resolved.status).toBe("unknown_tool");
		expect(chatToolFailureText(resolved as never)).toContain("dice");
	});

	it("refuses when a required argument is missing", () => {
		expect(resolveChatToolCall([dice], call("dice")).status).toBe(
			"invalid_arguments",
		);
	});

	/**
	 * The string '20' is not coerced to a number. Where leniency stops would otherwise differ between
	 * callers.
	 */
	it("refuses a wrong type rather than fixing it", () => {
		const resolved = resolveChatToolCall([dice], call("dice", { sides: "20" }));
		expect(resolved.status).toBe("invalid_arguments");
		expect(chatToolFailureText(resolved as never)).toContain("number");
	});

	/**
	 * Models often use `null` to express absence. If a type mismatch rejects it, every call that
	 * leaves an optional argument empty is refused, and that round trip spends budget without
	 * accomplishing anything.
	 */
	it("reads a `null` optional argument as absent", () => {
		const resolved = resolveChatToolCall(
			[dice],
			call("dice", { sides: 6, label: null }),
		);
		expect(resolved.status).toBe("ok");
		/** This is absence rather than a value, so the key itself is not passed to the handler. */
		expect(resolved.status === "ok" && resolved.arguments).toEqual({
			sides: 6,
		});
	});

	it("a `null` required argument gets the same sentence as a missing one", () => {
		const resolved = resolveChatToolCall([dice], call("dice", { sides: null }));
		expect(resolved.status).toBe("invalid_arguments");
		expect(chatToolFailureText(resolved as never)).toContain("필수");
	});

	/**
	 * An unreadable argument never reaches execution. Folding it into an empty object would run a tool
	 * that lacks a required argument on a default the model did not choose, and the result would not
	 * be what the model asked for.
	 */
	it("returns unreadable arguments as a sentence", () => {
		const resolved = resolveChatToolCall([dice], {
			id: "toolu_1",
			name: "dice",
			arguments: null,
		});
		expect(resolved.status).toBe("unreadable_arguments");
		expect(chatToolFailureText(resolved as never)).toContain("읽지 못했습니다");
	});

	it("does not run an unreadable call even for a tool without arguments", () => {
		let ran = false;
		const coin: ChatTool = {
			declaration: { name: "coin", description: "동전", parameters: [] },
			run: async () => {
				ran = true;
				return "앞";
			},
		};
		const resolved = resolveChatToolCall([coin], {
			id: "toolu_1",
			name: "coin",
			arguments: null,
		});
		expect(resolved.status).toBe("unreadable_arguments");
		expect(ran).toBe(false);
	});

	/**
	 * Silently dropping it would make the model believe its value was used. That misbelief carries
	 * into the next turn's text, for example a description of a search on a condition that does not
	 * exist.
	 */
	it("refuses unknown argument keys rather than dropping them", () => {
		const resolved = resolveChatToolCall(
			[dice],
			call("dice", { sides: 20, loaded: true }),
		);
		expect(resolved.status).toBe("invalid_arguments");
		expect(chatToolFailureText(resolved as never)).toContain("loaded");
	});

	it("refuses values outside the list", () => {
		expect(
			resolveChatToolCall([lore], call("lore_search", { scope: "weapon" }))
				.status,
		).toBe("invalid_arguments");
	});

	/**
	 * A `choices` list only has meaning for `string`. A list written on a numeric parameter must not
	 * block every value.
	 */
	it("a numeric parameter's list does not block the value", () => {
		const numeric: ChatTool = {
			...dice,
			declaration: {
				...dice.declaration,
				parameters: [
					{
						name: "sides",
						type: "number",
						description: "",
						required: true,
						choices: ["6"],
					},
				],
			},
		};
		expect(
			resolveChatToolCall([numeric], call("dice", { sides: 20 })).status,
		).toBe("ok");
	});
});

describe("chatToolResultMessage", () => {
	const parse = (result: string) =>
		ChatGenerationMessage.parse(chatToolResultMessage("toolu_1", result));

	it("builds a tool message the contract accepts", () => {
		const message = parse("술집: 낡은 간판");
		expect(message.role).toBe("tool");
		expect(message.content).toContain("술집: 낡은 간판");
		expect(message.content).toContain(CHAT_TOOL_RESULT_BOUNDARY);
	});

	it("turns an empty result into a fact", () => {
		expect(parse("   ").content).toContain(CHAT_TOOL_EMPTY_RESULT);
	});

	/**
	 * The most important assertion in this file. If the body fills the limit, the boundary sentence is
	 * pushed out, and the request reaches upstream with no distinction between data and instructions.
	 */
	it("the boundary sentence survives past the cap", () => {
		const message = parse("가".repeat(CHAT_MAX_TOOL_RESULT_CHARS * 2));
		expect(message.content.endsWith(CHAT_TOOL_RESULT_BOUNDARY)).toBe(true);
		expect([...message.content].length).toBeLessThanOrEqual(
			CHAT_MAX_TOOL_RESULT_CHARS,
		);
	});

	/** Without saying so, the model would read a truncated list as complete. */
	it("says that it truncated", () => {
		expect(
			parse("가".repeat(CHAT_MAX_TOOL_RESULT_CHARS * 2)).content,
		).toContain(CHAT_TOOL_TRUNCATED_NOTICE);
	});

	/**
	 * The unit of the limit is the contract's unit. Fitting 8,000 by code points would make an
	 * emoji-only result 16,000 UTF-16 units, and the contract would reject that request. This
	 * assertion caught exactly that. Passing the contract schema in `parse` is half of this check.
	 */
	it("an emoji-only result passes the contract too", () => {
		const message = parse("🐈".repeat(CHAT_MAX_TOOL_RESULT_CHARS));
		expect(message.content.length).toBeLessThanOrEqual(
			CHAT_MAX_TOOL_RESULT_CHARS,
		);
		expect(message.content.endsWith(CHAT_TOOL_RESULT_BOUNDARY)).toBe(true);
	});

	/**
	 * Code points only decide where to cut. The cut never leaves a broken surrogate pair at the end.
	 */
	it("does not cut a surrogate pair in the middle", () => {
		const content = parse("🐈".repeat(CHAT_MAX_TOOL_RESULT_CHARS)).content;
		expect(content).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
		expect(content).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
	});

	/**
	 * Also checks a result just below the limit, to confirm that the margin reserved for the boundary
	 * sentence is actually computed.
	 */
	it("a result just under the cap passes the contract too", () => {
		expect(() =>
			parse("가".repeat(CHAT_MAX_TOOL_RESULT_CHARS - 1)),
		).not.toThrow();
	});

	it("results within the cap are not truncated", () => {
		expect(parse("짧다").content.startsWith("짧다")).toBe(true);
		expect(parse("짧다").content).not.toContain(CHAT_TOOL_TRUNCATED_NOTICE);
	});
});

describe("chatToolErrorText", () => {
	/**
	 * The thrown value cannot be controlled (store errors carry paths and keys, network errors carry
	 * URLs). This sentence becomes model input and can recur in the story.
	 */
	it("does not carry the original", () => {
		const text = chatToolErrorText("lore_search");
		expect(text).toContain("lore_search");
		expect(text).not.toContain("Error");
	});
});
