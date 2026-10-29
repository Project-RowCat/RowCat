import type { ChatSeedLoreDto } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import { selectLore } from "./lore.ts";
import {
	CHAT_LORE_TOOL_MAX_ENTRIES,
	CHAT_LORE_TOOL_NAME,
	chatLoreTool,
} from "./tool-lore.ts";

/**
 * What the lore search test guards: three things.
 *
 * First, absence. A room with nothing to search should not carry the declaration at all, so the
 * cost attaches only to conversations where the tool has work to do. Second, a single selector. The
 * handler must call the same function the assembler calls. If they diverge, auto-injection and
 * search return different entries, and nothing on screen says which is right. Third, the creator's
 * keywords never enter the prompt. A declaration that listed the keys would mix the creator's
 * chosen words into the model's sentences and lengthen every turn's prompt.
 */

const entry = (over: Partial<ChatSeedLoreDto> = {}): ChatSeedLoreDto => ({
	keys: [],
	content: "",
	constant: false,
	position: "system_bottom",
	order: 0,
	...over,
});

const LORD = entry({
	keys: ["영주"],
	content: "영주는 세 해째 자리를 비웠다.",
});
const TAVERN = entry({ keys: ["술집"], content: "술집 간판은 낡았다." });

const run = async (
	lore: readonly ChatSeedLoreDto[],
	query: string,
): Promise<string> => {
	const tool = chatLoreTool(lore);
	if (!tool) throw new Error("도구가 서지 않았다");
	return tool.run({ query }, new AbortController().signal);
};

describe("chatLoreTool", () => {
	it("does not stand when there is nothing to find", () => {
		expect(chatLoreTool([])).toBeNull();
	});

	/** Returning entries already in the prompt would waste a round trip. */
	it("does not stand with only always-injected entries", () => {
		expect(
			chatLoreTool([entry({ constant: true, content: "언제나" })]),
		).toBeNull();
	});

	/** An entry with no keys can never fire under the contract, so search cannot match it either. */
	it("does not stand with only keyless entries", () => {
		expect(chatLoreTool([entry({ content: "죽은 항목" })])).toBeNull();
	});

	it("the name is a shape all three providers accept without conversion", () => {
		expect(chatLoreTool([LORD])?.declaration.name).toBe(CHAT_LORE_TOOL_NAME);
		expect(CHAT_LORE_TOOL_NAME).toMatch(/^[a-z][a-z0-9_]*$/);
	});

	/**
	 * The same decision as the situation-image feature: the model is not told the trigger list. The
	 * declaration is a fixed string per room, so it does not disturb the prefix cache.
	 */
	it("the creator's keys do not ride in the declaration", () => {
		const declaration = chatLoreTool([LORD, TAVERN])?.declaration;
		const text = JSON.stringify(declaration);
		expect(text).not.toContain("영주");
		expect(text).not.toContain("술집");
	});

	it("returns the bodies of entries matching the query", async () => {
		expect(await run([LORD, TAVERN], "영주")).toBe(LORD.content);
	});

	it("an empty string when nothing matches; result assembly turns that fact into a sentence", async () => {
		expect(await run([LORD], "용")).toBe("");
	});

	/** A second selector would give two answers to the same question. */
	it("passes the same selector as the assembler", async () => {
		const lore = [LORD, TAVERN];
		expect(await run(lore, "술집")).toBe(
			selectLore([...lore], "술집")
				.map((found) => found.content)
				.join("\n\n"),
		);
	});

	/**
	 * A character cap alone lets one long entry push out the others, so the cut is made on entry
	 * boundaries.
	 */
	it("cuts the entry count at the cap", async () => {
		const many = Array.from(
			{ length: CHAT_LORE_TOOL_MAX_ENTRIES + 3 },
			(_, i) => entry({ keys: ["마을"], content: `자료 ${i}` }),
		);
		const result = await run(many, "마을");
		expect(result.split("\n\n")).toHaveLength(CHAT_LORE_TOOL_MAX_ENTRIES);
	});

	/**
	 * Always-injected entries are already in the prompt, so they are not repeated in search results.
	 */
	it("always-injected entries are not included in results", async () => {
		const always = entry({ constant: true, content: "언제나 서 있다" });
		expect(await run([LORD, always], "영주")).toBe(LORD.content);
	});
});
