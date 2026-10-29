import { describe, expect, it } from "vitest";
import type { ChatRole } from "./model.ts";
import {
	CHAT_SEARCH_MIN_QUERY_LENGTH,
	CHAT_SEARCH_RESULT_PAGE_SIZE,
	normalizeSearchQuery,
	normalizeSearchText,
	type SearchableMessage,
	searchMessages,
} from "./search.ts";

/**
 * Search rule tests, run without any screen. Every failure here is silent: a case mismatch finds
 * nothing while the screen shows `No results` as if all were well, and an off-by-one highlight
 * still paints something.
 */

let sequence = 0;

const message = (
	content: string,
	options: {
		role?: ChatRole;
		speaker?: string;
		deletedAt?: string | null;
		id?: string;
	} = {},
): SearchableMessage => ({
	id: options.id ?? `m${++sequence}`,
	role: options.role ?? "assistant",
	speaker: options.speaker ?? "",
	content,
	createdAt: "2026-01-01T00:00:00.000Z",
	deletedAt: options.deletedAt ?? null,
});

/** Renders highlight ranges as readable text, so offsets do not have to be counted by hand. */
const marked = (snippet: string, ranges: { start: number; end: number }[]) => {
	let out = "";
	let at = 0;
	for (const range of ranges) {
		out += snippet.slice(at, range.start);
		out += `[${snippet.slice(range.start, range.end)}]`;
		at = range.end;
	}
	return out + snippet.slice(at);
};

/**
 * Tests that look only at the result array. Counts and `Show more` are checked in a separate section
 * below.
 */
const hits = (
	messages: SearchableMessage[],
	query: string,
): ReturnType<typeof searchMessages>["results"] =>
	searchMessages(messages, query).results;

describe("empty query", () => {
	it.each(["", "   ", "\n\t", "    "])("%j finds nothing", (query) => {
		expect(hits([message("아무 말이나")], query)).toEqual([]);
	});

	it("allows one character", () => {
		expect(CHAT_SEARCH_MIN_QUERY_LENGTH).toBe(1);
		expect(hits([message("밤이 깊었다")], "밤")).toHaveLength(1);
	});
});

describe("case", () => {
	it.each([
		["Hello", "hello"],
		["hello", "HELLO"],
		["HeLLo", "hELlO"],
	])("본문 %j를 %j로 찾는다", (content, query) => {
		expect(hits([message(content)], query)).toHaveLength(1);
	});

	/**
	 * The locale is pinned because a result that differs only on Turkish-locale devices would be very
	 * hard to reproduce.
	 */
	it("capital I folds to i on any device", () => {
		expect(normalizeSearchText("INDEX")).toBe("index");
	});
});

describe("Korean and Latin text", () => {
	const room = [
		message("문을 열자 차가운 바람이 스며들었다."),
		message("The door creaked open."),
		message("혼합된 문장 — mixed 한글 and Latin."),
	];

	it("Hangul substring", () => {
		expect(hits(room, "차가운").map((r) => r.messageId)).toEqual([room[0]?.id]);
	});

	it("English substring (case-insensitive)", () => {
		expect(hits(room, "CREAKED").map((r) => r.messageId)).toEqual([
			room[1]?.id,
		]);
	});

	it("each matches even mixed in one sentence", () => {
		expect(hits(room, "한글")).toHaveLength(1);
		expect(hits(room, "mixed")).toHaveLength(1);
	});

	/** Word boundaries are not checked. Substring matching is the rule. */
	it("matches inside a word too", () => {
		expect(hits([message("스며들었다")], "며들")).toHaveLength(1);
	});
});

describe("raw markdown", () => {
	const source = message(
		"**굵게** 강조한 `코드`와 [링크](https://example.com)",
	);

	it.each([
		"**굵게**",
		"`코드`",
		"[링크]",
		"https://example.com",
	])("%j를 적힌 그대로 찾는다", (query) => {
		expect(hits([source], query)).toHaveLength(1);
	});

	/**
	 * Punctuation is not stripped. Stripping it would stop a query typed exactly as it appears on
	 * screen (for example, a word wrapped in Markdown bold markers) from matching.
	 */
	it("does not strip asterisks before searching", () => {
		expect(hits([source], "**굵게**")[0]?.snippet).toContain("**굵게**");
	});
});

describe("line breaks and whitespace", () => {
	it("a phrase across a line break matches as one line", () => {
		const results = hits(
			[message("문을 열었다\n그리고 나갔다")],
			"열었다 그리고",
		);
		expect(results).toHaveLength(1);
		expect(
			marked(results[0]?.snippet ?? "", results[0]?.matchRanges ?? []),
		).toBe("문을 [열었다\n그리고] 나갔다");
	});

	it("multiple spaces count as one", () => {
		expect(hits([message("아주    멀리")], "아주 멀리")).toHaveLength(1);
	});

	it("skips blank lines between paragraphs", () => {
		expect(
			hits([message("첫 문단.\n\n둘째 문단.")], "첫 문단. 둘째"),
		).toHaveLength(1);
	});

	it("trims the query's surrounding whitespace", () => {
		expect(normalizeSearchQuery("  깊은 밤 \n")).toBe("깊은 밤");
		expect(hits([message("깊은 밤")], "  깊은   밤  ")).toHaveLength(1);
	});
});

describe("several matches in one message", () => {
	const results = hits([message("밤. 밤. 밤.")], "밤");

	it("one result per message", () => {
		expect(results).toHaveLength(1);
	});

	it("every match inside the preview is highlighted", () => {
		expect(
			marked(results[0]?.snippet ?? "", results[0]?.matchRanges ?? []),
		).toBe("[밤]. [밤]. [밤].");
	});
});

describe("roles", () => {
	const room = [
		message("같은 낱말", { role: "user", speaker: "지훈" }),
		message("같은 낱말", { role: "assistant" }),
	];
	const results = hits(room, "같은");

	it("both roles are searched", () => {
		expect(results).toHaveLength(2);
	});

	it("results carry role and speaker as is", () => {
		expect(results.map((r) => r.role)).toEqual(["assistant", "user"]);
		expect(results.find((r) => r.role === "user")?.speaker).toBe("지훈");
	});
});

describe("deleted messages", () => {
	it("tombstones do not appear in search", () => {
		const room = [
			message("사라진 장면", { deletedAt: "2026-01-02T00:00:00.000Z" }),
			message("남아 있는 장면"),
		];
		expect(hits(room, "장면").map((r) => r.messageId)).toEqual([room[1]?.id]);
	});
});

describe("order", () => {
	it("newest first", () => {
		const room = [message("첫 밤"), message("둘째 밤"), message("셋째 밤")];
		expect(hits(room, "밤").map((r) => r.messageId)).toEqual([
			room[2]?.id,
			room[1]?.id,
			room[0]?.id,
		]);
	});

	it("index carries the ascending coordinate as is", () => {
		const room = [
			message("가"),
			message("나 밤"),
			message("다"),
			message("라 밤"),
		];
		expect(hits(room, "밤").map((r) => r.index)).toEqual([3, 1]);
	});
});

/**
 * Detects a split surrogate pair. Iterating by code point would expose a lone half as its own
 * character, which is what this check looks for.
 */
const hasLoneSurrogate = (text: string): boolean =>
	[...text].some((char) => {
		const code = char.codePointAt(0) as number;
		return code >= 0xd800 && code <= 0xdfff;
	});

describe("preview", () => {
	const snippetOf = (content: string, query: string): string =>
		hits([message(content)], query)[0]?.snippet ?? "";

	it("a short body appears as is", () => {
		expect(snippetOf("짧은 밤", "밤")).toBe("짧은 밤");
	});

	it("a match at the very start: no leading ellipsis", () => {
		const snippet = snippetOf(`밤${"가".repeat(200)}`, "밤");
		expect(snippet.startsWith("밤")).toBe(true);
		expect(snippet.endsWith("…")).toBe(true);
	});

	it("a match in the middle: ellipses on both sides", () => {
		const snippet = snippetOf(`${"가".repeat(100)}밤${"나".repeat(100)}`, "밤");
		expect(snippet.startsWith("…")).toBe(true);
		expect(snippet.endsWith("…")).toBe(true);
		// Layout: 40 characters, then the ellipsis, then the match.
		expect(snippet[41]).toBe("밤");
	});

	it("a match at the very end: no trailing ellipsis", () => {
		const snippet = snippetOf(`${"가".repeat(200)}밤`, "밤");
		expect(snippet.startsWith("…")).toBe(true);
		expect(snippet.endsWith("밤")).toBe(true);
	});

	it("length stays bounded on long bodies", () => {
		const snippet = snippetOf(
			`${"가".repeat(5000)}밤${"나".repeat(5000)}`,
			"밤",
		);
		expect(snippet.length).toBeLessThanOrEqual(2 + 40 + 1 + 80);
	});

	it("highlight ranges point at the original's case", () => {
		const results = hits([message("Hello World")], "world");
		const range = results[0]?.matchRanges[0];
		expect(results[0]?.snippet.slice(range?.start, range?.end)).toBe("World");
	});

	it("matches pushed out of the preview are not highlighted", () => {
		const results = hits([message(`밤${"가".repeat(500)}밤`)], "밤");
		expect(results[0]?.matchRanges).toHaveLength(1);
	});

	it("does not split an emoji in half", () => {
		const snippet = snippetOf(`밤가${"🌙".repeat(200)}`, "밤");
		expect(hasLoneSurrogate(snippet)).toBe(false);
	});

	it("highlights matches between emoji exactly", () => {
		const content = `${"🌙".repeat(50)}밤${"🌙".repeat(50)}`;
		const results = hits([message(content)], "밤");
		const range = results[0]?.matchRanges[0];
		expect(results[0]?.snippet.slice(range?.start, range?.end)).toBe("밤");
		expect(hasLoneSurrogate(results[0]?.snippet ?? "")).toBe(false);
	});
});

describe("counting and preview are different axes", () => {
	const room = Array.from({ length: 120 }, (_, index) =>
		message(`${index}번째 밤`, { id: `m-${index}` }),
	);

	it("counts every match", () => {
		expect(searchMessages(room, "밤").matched).toBe(120);
	});

	it("builds previews only up to the default page size", () => {
		const view = searchMessages(room, "밤");
		expect(view.results).toHaveLength(CHAT_SEARCH_RESULT_PAGE_SIZE);
		expect(view.hasMore).toBe(true);
	});

	it("`Show more` widens the window", () => {
		const view = searchMessages(room, "밤", { limit: 200 });
		expect(view.results).toHaveLength(120);
		expect(view.hasMore).toBe(false);
	});

	it("what is built is always the newest side", () => {
		const view = searchMessages(room, "밤", { limit: 2 });
		expect(view.results.map((result) => result.messageId)).toEqual([
			"m-119",
			"m-118",
		]);
	});
});

describe("the shortcut for queries without whitespace", () => {
	/**
	 * Results must be the same whether or not whitespace folding is skipped. That equivalence is the
	 * only justification for the shortcut.
	 */
	const spread = message("문을\n\n열었다   그리고\t나갔다");

	it.each([
		"열었다",
		"그리고",
		"나갔다",
		"문을",
	])("공백 없는 %j는 접기 없이도 걸린다", (query) => {
		expect(hits([spread], query)).toHaveLength(1);
	});

	it("a query with whitespace still matches folded text", () => {
		expect(hits([spread], "열었다 그리고")).toHaveLength(1);
	});

	it("characters not adjacent do not match unless across whitespace", () => {
		expect(hits([spread], "문을열었다")).toEqual([]);
	});
});
