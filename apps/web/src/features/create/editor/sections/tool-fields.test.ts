import {
	createDraftToolRecord,
	DRAFT_TOOL_RESERVED_NAMES,
} from "@rowcat/authoring";
import { CHAT_RESERVED_TOOL_NAMES } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import {
	isBlankTool,
	joinChoices,
	joinRows,
	parseWholeNumber,
	sameParameters,
	splitChoices,
	splitRows,
	toolSummary,
} from "./tool-fields.ts";

/**
 * Creator tool card rules that must hold without rendering. The text-box conversions are the risky
 * ones: each box is controlled from the record, so a conversion that does not round-trip exactly
 * would eat the line break or comma the creator just typed.
 */

const stamp = {
	id: "tool-1",
	now: "2026-01-01T00:00:00.000Z",
	rev: { t: 1, c: 0, d: "device" },
};
const tool = (
	input: Partial<Parameters<typeof createDraftToolRecord>[0]> = {},
) =>
	createDraftToolRecord(
		{ draftId: "draft-1", positionIndex: 0, ...input },
		stamp,
	);

describe("text box conversions round-trip exactly", () => {
	it.each(["", "one", "one\n", "one\n\ntwo", "\n"])("rows: %j", (text) => {
		expect(joinRows(splitRows(text))).toBe(text);
	});

	it.each([
		"",
		"pier",
		"pier,",
		"pier, ",
		" pier , market",
	])("choices: %j", (text) => {
		expect(joinChoices(splitChoices(text))).toBe(text);
	});

	it("an empty choices box is no choices, not one empty choice", () => {
		expect(splitChoices("")).toEqual([]);
	});
});

describe("the collapsed card", () => {
	it("a new tool is blank and says it is not ready", () => {
		const blank = tool();
		expect(isBlankTool(blank)).toBe(true);
		const summary = toolSummary(blank);
		expect(summary.hasName).toBe(false);
		expect(summary.issues.length).toBeGreaterThan(0);
	});

	it("a complete tool has no issues", () => {
		const summary = toolSummary(
			tool({
				name: "harbor_weather",
				description: "The weather.",
				template: "Rain.",
			}),
		);
		expect(summary.hasName).toBe(true);
		expect(summary.headline).toBe("harbor_weather");
		expect(summary.issues).toEqual([]);
	});

	it("text in another kind's field still counts as written", () => {
		expect(isBlankTool(tool({ kind: "table", system: "kept" }))).toBe(false);
	});
});

describe("number boxes", () => {
	it("keep the previous value for unreadable input rather than saving 0", () => {
		expect(parseWholeNumber("", 3)).toBe(3);
		expect(parseWholeNumber("abc", 3)).toBe(3);
		expect(parseWholeNumber("5", 3)).toBe(5);
	});
});

describe("parameters compare by value", () => {
	it("a fresh copy of the same rows is the same", () => {
		const row = {
			name: "place",
			type: "string" as const,
			description: "",
			required: false,
			choices: [],
		};
		expect(sameParameters([row], [{ ...row }])).toBe(true);
		expect(sameParameters([row], [{ ...row, required: true }])).toBe(false);
	});
});

/**
 * @rowcat/authoring does not depend on @rowcat/chat, so it spells the reserved tool names itself.
 * This app imports both, which makes it the place that pins the two together: if lore search were
 * renamed in chat only, a creator could publish a tool the registry silently skips.
 */
describe("reserved tool names", () => {
	it("authoring reserves exactly what the chat registry reserves", () => {
		expect([...DRAFT_TOOL_RESERVED_NAMES].sort()).toEqual(
			[...CHAT_RESERVED_TOOL_NAMES].sort(),
		);
	});
});
