import { describe, expect, it } from "vitest";
import {
	CHAT_REPLY_SUGGESTION_HISTORY_LIMIT,
	canSuggestReply,
	type ReplySuggestionMessage,
	type ReplySuggestionRow,
	replySuggestionTurnKey,
	selectReplySuggestionWindow,
} from "./reply-suggestion.ts";

const message = (
	index: number,
	role: "user" | "assistant" = "user",
): ReplySuggestionMessage => ({ role, speaker: "", content: `말 ${index}` });

const conversation = (count: number): ReplySuggestionMessage[] =>
	Array.from({ length: count }, (_, index) =>
		message(index, index % 2 === 0 ? "user" : "assistant"),
	);

/** Baseline state in which a suggestion may appear. Each test flips one axis. */
const OPEN = {
	generating: false,
	composerEmpty: true,
	failed: false,
	rows: [
		{ role: "user" },
		{ role: "assistant" },
	] satisfies ReplySuggestionRow[],
};

describe("selectReplySuggestionWindow", () => {
	it("cuts the window length **from the end**", () => {
		const window = selectReplySuggestionWindow({
			messages: conversation(CHAT_REPLY_SUGGESTION_HISTORY_LIMIT + 5),
			opening: "도입부",
		});
		expect(window).toHaveLength(CHAT_REPLY_SUGGESTION_HISTORY_LIMIT);
		expect(window[window.length - 1]?.content).toBe(
			`말 ${CHAT_REPLY_SUGGESTION_HISTORY_LIMIT + 4}`,
		);
	});

	it("the opening is not included when stored messages exist", () => {
		const window = selectReplySuggestionWindow({
			messages: conversation(2),
			opening: "도입부",
		});
		expect(window.map((row) => row.content)).toEqual(["말 0", "말 1"]);
	});

	it("in a room where nothing was exchanged the opening is everything", () => {
		expect(
			selectReplySuggestionWindow({ messages: [], opening: "  도입부  " }),
		).toEqual([{ role: "assistant", speaker: "", content: "도입부" }]);
	});

	it("empty with neither opening nor messages: invents nothing", () => {
		expect(
			selectReplySuggestionWindow({ messages: [], opening: null }),
		).toEqual([]);
		expect(
			selectReplySuggestionWindow({ messages: [], opening: "   " }),
		).toEqual([]);
	});
});

describe("canSuggestReply", () => {
	it("stands after an assistant response", () => {
		expect(canSuggestReply(OPEN)).toBe(true);
	});

	it("does not stand while a response streams", () => {
		expect(canSuggestReply({ ...OPEN, generating: true })).toBe(false);
	});

	it("**does not stand while there is draft text**: filling never gets a path that erases it", () => {
		expect(canSuggestReply({ ...OPEN, composerEmpty: false })).toBe(false);
	});

	it("does not stand while a failure notice shows: that slot's answer is regenerate", () => {
		expect(canSuggestReply({ ...OPEN, failed: true })).toBe(false);
	});

	it("does not stand after a user turn awaiting an answer", () => {
		expect(
			canSuggestReply({
				...OPEN,
				rows: [{ role: "assistant" }, { role: "user" }],
			}),
		).toBe(false);
	});

	it("does not stand on a truncated response: `Continue` comes first", () => {
		expect(
			canSuggestReply({
				...OPEN,
				rows: [{ role: "user" }, { role: "assistant", truncated: true }],
			}),
		).toBe(false);
	});

	/**
	 * Suggestions must not appear over an interrupted response either, since an open tail is an open
	 * tail. Otherwise the suggestion and `Continue` would stand side by side on that one screen.
	 */
	it("does not stand on an interrupted response either: the tail is open all the same", () => {
		expect(
			canSuggestReply({
				...OPEN,
				rows: [{ role: "user" }, { role: "assistant", incomplete: true }],
			}),
		).toBe(false);
	});

	it("a row without both axes (the opening) does not read as interrupted", () => {
		expect(canSuggestReply({ ...OPEN, rows: [{ role: "assistant" }] })).toBe(
			true,
		);
	});

	it("does not stand when there are no rows to draw", () => {
		expect(canSuggestReply({ ...OPEN, rows: [] })).toBe(false);
	});
});

describe("replySuggestionTurnKey", () => {
	it("it is the last row's id: when it changes, held suggestions are dropped", () => {
		expect(replySuggestionTurnKey([{ id: "a" }, { id: "b" }])).toBe("b");
	});

	it("`null` when there are no rows to draw", () => {
		expect(replySuggestionTurnKey([])).toBeNull();
	});
});
