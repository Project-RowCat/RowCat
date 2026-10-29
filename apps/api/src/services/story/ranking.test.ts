import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
	POPULAR_ADULT_DEMOTION,
	POPULAR_WEIGHTS,
	popularScore,
	RELEVANCE_WEIGHTS,
	relevanceScore,
} from "./ranking.ts";

/**
 * Pins the properties of the ranking weights by value. The numbers may change, but if these
 * relations break, the specification in the `ranking.ts` header becomes false.
 */

const row = (over: Partial<Parameters<typeof relevanceScore>[1]> = {}) => ({
	title: "The Convenience Store That Rewinds the Night",
	tags: ["convenience store", "time loop"],
	creatorNickname: "Author",
	author: "Author",
	description: "A day rewound every night.",
	...over,
});

describe("relevance weights", () => {
	test("title exact > title prefix > title contains", () => {
		expect(RELEVANCE_WEIGHTS.titleExact).toBeGreaterThan(
			RELEVANCE_WEIGHTS.titlePrefix,
		);
		expect(RELEVANCE_WEIGHTS.titlePrefix).toBeGreaterThan(
			RELEVANCE_WEIGHTS.titleContains,
		);
	});

	test("one title prefix outweighs everything outside the title combined — the title is the story's name", () => {
		const rest =
			RELEVANCE_WEIGHTS.tagExact +
			RELEVANCE_WEIGHTS.creatorNickname +
			RELEVANCE_WEIGHTS.author +
			RELEVANCE_WEIGHTS.description;
		expect(RELEVANCE_WEIGHTS.titlePrefix).toBeGreaterThan(rest);
	});

	test("tags rank above nickname, author and description", () => {
		expect(RELEVANCE_WEIGHTS.tagContains).toBeGreaterThan(
			RELEVANCE_WEIGHTS.creatorNickname,
		);
		expect(RELEVANCE_WEIGHTS.creatorNickname).toBeGreaterThan(
			RELEVANCE_WEIGHTS.description,
		);
	});
});

describe("relevanceScore", () => {
	test("a story matching only in the title ranks above one matching only in the description", () => {
		const titleOnly = relevanceScore(
			"convenience store",
			row({ tags: [], description: "" }),
		);
		const descriptionOnly = relevanceScore(
			"convenience store",
			row({
				title: "Another title",
				tags: [],
				description: "A convenience store story",
			}),
		);
		expect(titleOnly).toBeGreaterThan(descriptionOnly);
		expect(descriptionOnly).toBeGreaterThan(0);
	});

	test("a story matching both title and tag ranks above one matching only the title — it is a sum, not a product", () => {
		expect(relevanceScore("convenience store", row())).toBeGreaterThan(
			relevanceScore("convenience store", row({ tags: [] })),
		);
	});

	test("exact, prefix and contains are exclusive", () => {
		expect(
			relevanceScore(
				"The Convenience Store That Rewinds the Night",
				row({ tags: [] }),
			),
		).toBe(RELEVANCE_WEIGHTS.titleExact + RELEVANCE_WEIGHTS.description * 0);
		expect(
			relevanceScore("The Convenience", row({ tags: [], description: "" })),
		).toBe(RELEVANCE_WEIGHTS.titlePrefix);
		expect(
			relevanceScore("convenience store", row({ tags: [], description: "" })),
		).toBe(RELEVANCE_WEIGHTS.titleContains);
	});

	test("ignores case — same as SQL's ILIKE and lower()", () => {
		expect(relevanceScore("CAT", row({ title: "cat", tags: [] }))).toBe(
			relevanceScore("cat", row({ title: "CAT", tags: [] })),
		);
	});

	test("matching the creator's nickname scores, and with no creator that tier is 0", () => {
		const base = row({ title: "x", tags: [], author: "y", description: "z" });
		expect(relevanceScore("Author", base)).toBe(
			RELEVANCE_WEIGHTS.creatorNickname,
		);
		expect(relevanceScore("Author", { ...base, creatorNickname: null })).toBe(
			0,
		);
	});

	test("an empty query is 0", () => {
		expect(relevanceScore("  ", row())).toBe(0);
	});
});

describe("popularScore", () => {
	test("favorites > participants > views by weight", () => {
		expect(POPULAR_WEIGHTS.favorite).toBeGreaterThan(
			POPULAR_WEIGHTS.uniquePlayStarter,
		);
		expect(POPULAR_WEIGHTS.uniquePlayStarter).toBeGreaterThan(
			POPULAR_WEIGHTS.view,
		);
	});

	test("no activity at all is 0", () => {
		expect(
			popularScore({
				uniquePlayStarters: 0,
				favorites: 0,
				views: 0,
				adult: false,
			}),
		).toBe(0);
	});

	test("adult stories are demoted by multiplication — only the order changes, not visibility", () => {
		const all = popularScore({
			uniquePlayStarters: 2,
			favorites: 1,
			views: 5,
			adult: false,
		});
		const adult = popularScore({
			uniquePlayStarters: 2,
			favorites: 1,
			views: 5,
			adult: true,
		});
		expect(adult).toBeCloseTo(all * POPULAR_ADULT_DEMOTION);
	});
});

/**
 * Ranking must not revert to counting events, locked by source shape.
 *
 * The value test (`routes/stories/popular.test.ts`) says the current code is right; this guards
 * against the shortest refactor that revives the playback-mode bias: swapping
 * `story.unique_play_starters` for `story.play_starts` in the score. No type breaks and no response
 * shape changes, and the larger value makes the ranking look healthier.
 *
 * Comments are stripped before checking: this guards code, not prose, and the word appears in the
 * explanatory header.
 */
const rankingSource = readFileSync(
	new URL("./index.ts", import.meta.url),
	"utf8",
)
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^[ \t]*\/\/.*$/gm, "");

describe("the signals the popular ranking reads", () => {
	test("reads neither the event counter (`play_starts`) nor the event ledger (`story_play_log`)", () => {
		expect(rankingSource).not.toContain("play_starts");
		expect(rankingSource).not.toContain("story_play_log");
	});

	test("reads the people ledger and its counter", () => {
		expect(rankingSource).toContain("unique_play_starters");
		expect(rankingSource).toContain("story_play_starter");
	});

	test("there is no per-playback-mode coefficient — today's usage pattern isn't written into business logic", () => {
		for (const word of ["runtime", "chat", "playMode", "kind"])
			expect(Object.keys(POPULAR_WEIGHTS)).not.toContain(word);
	});
});
