import { STORY_COMMENTS_ANCHOR } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import { arrivedAtHash, HASH_ARRIVAL_RELEASE_EVENTS } from "./hash-arrival.ts";

describe("arrivedAtHash", () => {
	it("recognizes the hash of addresses the inbox builds", () => {
		expect(
			arrivedAtHash(`#${STORY_COMMENTS_ANCHOR}`, STORY_COMMENTS_ANCHOR),
		).toBe(true);
		expect(arrivedAtHash(STORY_COMMENTS_ANCHOR, STORY_COMMENTS_ANCHOR)).toBe(
			true,
		);
	});

	/**
	 * Does not move on other anchors or on an empty hash. Pulling the view there would take away the
	 * reading position.
	 */
	it("does not move for another or empty hash", () => {
		expect(arrivedAtHash("", STORY_COMMENTS_ANCHOR)).toBe(false);
		expect(arrivedAtHash("#comments-x", STORY_COMMENTS_ANCHOR)).toBe(false);
	});
});

/**
 * All four ways a person scrolls on their own must stop the alignment. If one is missing, the page
 * is pulled back on that input path.
 */
it("a person's interaction stops the alignment", () => {
	expect([...HASH_ARRIVAL_RELEASE_EVENTS].sort()).toEqual([
		"keydown",
		"pointerdown",
		"touchstart",
		"wheel",
	]);
});
