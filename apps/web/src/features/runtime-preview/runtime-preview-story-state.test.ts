import { emptyStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import { describe, expect, it } from "vitest";
import { RUNTIME_PREVIEW } from "./runtime-preview-copy.ts";
import {
	formatStoryStateValue,
	STORY_STATE_FORMAT_LIMITS,
	storyStateRows,
} from "./runtime-preview-story-state.ts";

describe("durable state formatter", () => {
	it("keys are written in name order: the same state is the same text", () => {
		expect(formatStoryStateValue({ b: 1, a: 2 })).toBe(
			formatStoryStateValue({ a: 2, b: 1 }),
		);
		expect(formatStoryStateValue({ b: 1, a: 2 })).toContain('"a": 2');
	});

	it("depth, entry count and strings are clipped and the clipping is stated", () => {
		const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
		expect(formatStoryStateValue(deep)).toContain("{…}");
		expect(
			formatStoryStateValue(Array.from({ length: 60 }, (_, index) => index)),
		).toContain("more");
		expect(formatStoryStateValue("x".repeat(500))).toContain("…");
	});

	it("past the total length it is cut whole", () => {
		const huge = Object.fromEntries(
			Array.from({ length: 40 }, (_, index) => [`k${index}`, "y".repeat(190)]),
		);
		const text = formatStoryStateValue(huge);
		expect(text.length).toBeLessThanOrEqual(
			STORY_STATE_FORMAT_LIMITS.maxTotalLength + "… (truncated)".length,
		);
		expect(text).toContain("truncated");
	});

	it("empty values and primitives are written as is", () => {
		expect(formatStoryStateValue(null)).toBe("null");
		expect(formatStoryStateValue([])).toBe("[]");
		expect(formatStoryStateValue({})).toBe("{}");
		expect(formatStoryStateValue(false)).toBe("false");
	});

	it("an empty snapshot has no rows", () => {
		expect(storyStateRows(emptyStoryStateSnapshot())).toEqual([]);
	});
});

/**
 * Checks that the copy says the three operations are different. Restart renews only the VM and
 * keeps both lifetimes. `Reset play` clears only the playthrough and keeps long progress. `Reset long progress`
 * is the reverse and is for creators and debugging only. Folding them into one button would erase
 * unlocks worth several chapters whenever someone replays a chapter. The three buttons on screen
 * and the three words here express the same fact.
 */
describe("vocabulary of the two lifetimes", () => {
	it("the three operations have different names", () => {
		const names = [
			RUNTIME_PREVIEW.restart,
			RUNTIME_PREVIEW.resetPlaythrough,
			RUNTIME_PREVIEW.resetPersistent,
		];
		expect(new Set(names).size).toBe(names.length);
	});

	it("the Reset play copy says long progress stays", () => {
		expect(RUNTIME_PREVIEW.resetPlaythroughHint).toContain(
			"definePersistentState",
		);
		expect(RUNTIME_PREVIEW.resetPlaythroughHint).toContain("stays");
	});

	it("the Reset long progress copy says it clears only preview memory", () => {
		expect(RUNTIME_PREVIEW.resetPersistentHint).toContain("preview memory");
	});

	/**
	 * Checks that both copy strings say restart carries over saved state. Without that wording, a
	 * creator who restarted because they disliked a response would read it as erasing their progress.
	 */
	it("says Restart carries progress over", () => {
		expect(RUNTIME_PREVIEW.staleBody).toContain("keeps");
		expect(RUNTIME_PREVIEW.resetPlaythroughHint).toContain("carries");
	});

	/**
	 * States the lifetime of this memory honestly; it must not be called cloud save (see §76). Writing
	 * that it is saved would mislead a creator who reloads and loses progress, a promise this preview
	 * never made.
	 */
	it("does not promise cloud saves", () => {
		expect(RUNTIME_PREVIEW.stateScope).toContain("Refreshing");
		for (const forbidden of ["cloud", "saved on the server", "synced"])
			expect(RUNTIME_PREVIEW.stateScope, forbidden).not.toContain(forbidden);
	});

	/**
	 * The two sections of the `State` panel need different names. Merged into one list, two identical
	 * key lines would be indistinguishable.
	 */
	it("the State panel's two sections have different names", () => {
		expect(RUNTIME_PREVIEW.statePlaythrough).not.toBe(
			RUNTIME_PREVIEW.statePersistent,
		);
	});
});
