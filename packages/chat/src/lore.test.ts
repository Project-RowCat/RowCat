import type { ChatSeedLoreDto } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import { selectLore, selectLoreTraced } from "./lore.ts";

/**
 * The decision list must not change which entries are selected. This file pins that property. The
 * structure already implies it: selectLore returns the traced run's selected list. The test exists
 * so that anyone who later splits the two paths for performance has to break this file first.
 */

const lore = (
	partial: Partial<ChatSeedLoreDto> & Pick<ChatSeedLoreDto, "content">,
): ChatSeedLoreDto => ({
	keys: [],
	constant: false,
	position: "system_bottom",
	order: 0,
	...partial,
});

const ENTRIES: ChatSeedLoreDto[] = [
	lore({ content: "항구 설정", keys: ["항구", "부두"] }),
	lore({ content: "상시 설정", constant: true, order: 5 }),
	lore({ content: "사막 설정", keys: ["사막"], order: 9 }),
	lore({ content: "   ", constant: true, order: 100 }),
	lore({ content: "키 없는 항목" }),
	lore({ content: "빈 키만 있는 항목", keys: ["  ", ""] }),
];

const SCANS = [
	"",
	"아무 말",
	"항구에 도착했다",
	"항구와 사막",
	"부두에서 기다린다",
	"사막",
];

describe("selectLoreTraced", () => {
	it("picks the same list as selectLore for any input", () => {
		for (const scan of SCANS)
			expect(selectLoreTraced(ENTRIES, scan).selected).toEqual(
				selectLore(ENTRIES, scan),
			);
	});

	it("the decision list keeps authoring order and omits no entry", () => {
		const { decisions } = selectLoreTraced(ENTRIES, "항구");
		expect(decisions.map((decision) => decision.index)).toEqual([
			0, 1, 2, 3, 4, 5,
		]);
		expect(decisions.map((decision) => decision.id)).toEqual([
			"lore:0",
			"lore:1",
			"lore:2",
			"lore:3",
			"lore:4",
			"lore:5",
		]);
	});

	it("each decision has its own word for why it matched or not", () => {
		const { decisions } = selectLoreTraced(ENTRIES, "항구에 도착했다");
		expect(
			decisions.map((decision) => [decision.reason, decision.active]),
		).toEqual([
			["key-match", true],
			["constant", true],
			["no-key-match", false],
			["empty-content", false],
			["no-keys", false],
			["no-keys", false],
		]);
	});

	it("records the matching key, null when none matched", () => {
		const { decisions } = selectLoreTraced(ENTRIES, "부두에서 기다린다");
		expect(decisions[0]?.matchedKey).toBe("부두");
		expect(decisions[1]?.matchedKey).toBeNull();
		expect(decisions[2]?.matchedKey).toBeNull();
	});

	it("injection order is the sorted position, null for inactive entries", () => {
		const { selected, decisions } = selectLoreTraced(ENTRIES, "항구와 사막");
		expect(selected.map((entry) => entry.content)).toEqual([
			"사막 설정",
			"상시 설정",
			"항구 설정",
		]);
		expect(
			decisions.map((decision) => [decision.content, decision.injectedIndex]),
		).toEqual([
			["항구 설정", 2],
			["상시 설정", 1],
			["사막 설정", 0],
			[null, null],
			[null, null],
			[null, null],
		]);
	});

	it("bodies of entries not included are not held in the decision", () => {
		const { decisions } = selectLoreTraced(ENTRIES, "아무 말");
		for (const decision of decisions)
			expect(decision.content === null).toBe(!decision.active);
	});

	it("the contribution is the trimmed body's length, measured for inactive entries too", () => {
		const { decisions } = selectLoreTraced(
			[lore({ content: "  열두 글자입니다  ", keys: ["없는키"] })],
			"",
		);
		expect(decisions[0]?.contentLength).toBe("열두 글자입니다".length);
		expect(decisions[0]?.active).toBe(false);
	});

	it("case-insensitive substring match, the same rule as selectLore", () => {
		const entries = [lore({ content: "영문", keys: ["Harbor"] })];
		expect(
			selectLoreTraced(entries, "the HARBOR is quiet").decisions[0],
		).toMatchObject({
			active: true,
			reason: "key-match",
			matchedKey: "Harbor",
		});
	});
});
