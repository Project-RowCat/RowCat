import { describe, expect, it } from "vitest";
import {
	applyNarrationOutputPolicy,
	narrationOutputPolicy,
	stripCastTrackingLines,
} from "./narration-output.ts";

/**
 * Pins the two questions the output policy answers, as values:
 * - Whether a cast-status table instruction still remains when the character card is off.
 * - Whether the tracking block is overridden when the pack says it should come before the body.
 *
 * The real pack body cannot be checked here, because this package does not depend on
 * @rowcat/prompt-packs (weight). That comparison lives at the app assembly point,
 * apps/web/src/test/prompt-pack-parity.test.ts.
 *
 * The fixture lines are written for this test, not copied from a pack: the public release carries
 * no pack text at any commit (docs/chat/NARRATION.md). Only the block names the code itself matches
 * (`Character Database`, `RELATION DATABASE`, `NARRATIVE NAVIGATOR`, `Logic`) are the pack's.
 */

describe("stripping lines that instruct a character status table", () => {
	it("only lines with that vocabulary disappear and the rest stays", () => {
		const body = [
			"# OUTPUT STRUCTURE",
			"- Put every tracking block, relation databases included, under the story",
			"- Never put two images in a row",
			"`Order: status, Logic, story, then the Character Database (RELATION DATABASE)`",
			"- Sits ahead of the memory block and follows the Relation Database",
			"- 마지막 줄",
		].join("\n");

		expect(stripCastTrackingLines(body)).toBe(
			[
				"# OUTPUT STRUCTURE",
				"- Never put two images in a row",
				"- 마지막 줄",
			].join("\n"),
		);
	});

	/** Case varies: the twelve pack variants mix three spellings of the cast-status block name. */
	it("matches despite notation differences", () => {
		for (const line of [
			"<details><summary>Character Database</summary>",
			"# RELATION DATABASE",
			"follows the Relation Database",
			"relation databases",
		])
			expect(stripCastTrackingLines(`앞\n${line}\n뒤`)).toBe("앞\n뒤");
	});

	it("the original when nothing matches", () => {
		const body =
			"# NARRATIVE NAVIGATOR\n- Draw this table at the top of each reply";
		expect(stripCastTrackingLines(body)).toBe(body);
	});

	it("leaves lines describing the `Logic` block alone", () => {
		const body = [
			"<details><summary>Logic</summary>",
			"- Keep it as a running database and update it every turn",
			"</details>",
		].join("\n");
		expect(stripCastTrackingLines(body)).toBe(body);
	});
});

describe("output policy", () => {
	/** Core of question 2: the tracking block goes last, wherever the pack says to place it. */
	it("body first, tracking blocks at the very end", () => {
		const policy = narrationOutputPolicy({ castTracking: true });
		expect(policy).toContain("본문을 **먼저**");
		expect(policy).toContain("**응답의 맨 끝**");
	});

	it("says to drop tracking when space runs short", () => {
		expect(narrationOutputPolicy({ castTracking: true })).toContain(
			"추적 블록을 생략하고 본문을 끝맺습니다",
		);
	});

	it("forbids that table when character cards are off", () => {
		const off = narrationOutputPolicy({ castTracking: false });
		expect(off).toContain("Character Database");
		expect(off).toContain("RELATION DATABASE");
		expect(off).toContain("사용하지 않습니다");
	});

	it("says nothing about that block when character cards are on", () => {
		const on = narrationOutputPolicy({ castTracking: true });
		expect(on).not.toContain("Character Database");
		expect(on).not.toContain("RELATION DATABASE");
	});
});

describe("body + policy", () => {
	const body = [
		"# NARRATIVE NAVIGATOR",
		"- Draw this table at the top of each reply",
		"- Put every tracking block, relation databases included, under the story",
	].join("\n");

	it("the policy stands **after** the body: before it, recency would override it", () => {
		const applied = applyNarrationOutputPolicy(body, { castTracking: true });
		expect(applied.startsWith("# NARRATIVE NAVIGATOR")).toBe(true);
		expect(applied.indexOf("# [출력 규약")).toBeGreaterThan(
			applied.indexOf("# NARRATIVE NAVIGATOR"),
		);
	});

	it("with character cards off, narrowing and the prohibition apply **together**", () => {
		const applied = applyNarrationOutputPolicy(body, { castTracking: false });
		expect(applied).not.toContain("under the story");
		expect(applied).toContain("사용하지 않습니다");
	});

	it("with character cards on, the body stays as is", () => {
		const applied = applyNarrationOutputPolicy(body, { castTracking: true });
		expect(applied.startsWith(body)).toBe(true);
	});

	it("an empty body stands no policy either", () => {
		expect(applyNarrationOutputPolicy("", { castTracking: false })).toBe("");
		expect(applyNarrationOutputPolicy("  \n ", { castTracking: true })).toBe(
			"  \n ",
		);
	});
});
