import type { StoryVisibility } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import {
	WORK_VISIBILITY_BADGE,
	WORK_VISIBILITY_LABEL,
} from "./work-lifecycle-copy.ts";

/**
 * **The visibility weight matches web.**
 *
 * Web's `creator-work-card.tsx` holds the same table (`VISIBILITY_BADGE`). It is copied here
 * because the two apps do not import each other, so the test locks it **by value**: a promise in a
 * comment would not stop only one side being changed.
 *
 * ⚠️ For a while this app drew everything with `Badge`'s default (`secondary`). That compiled and
 * the screen looked plausible, but a scanning eye could not tell published works from archived
 * ones. That distinction is exactly why this column exists.
 *
 * ## Four states, three weights, on purpose
 *
 * The weight answers not "what is it now" but **"where does it live"**:
 *
 * ```text
 * default     public              in the catalogue
 * outline     unlisted · private  alive, but not in the catalogue
 * secondary   archived            put away
 * ```
 *
 * `unlisted` and `private` share a weight because they are the same cell on this axis. The words
 * tell them apart (`WORK_VISIBILITY_LABEL`); color is always secondary. The only remaining variant
 * is `destructive`, whose color means "cannot be undone", so painting a work that is not offered to
 * the list with it would make the badge read as a warning.
 */
describe("published story visibility badges", () => {
	it("same as the web's table", () => {
		expect(WORK_VISIBILITY_BADGE).toEqual({
			public: "default",
			unlisted: "outline",
			private: "outline",
			archived: "secondary",
		});
	});

	/**
	 * A new vocabulary value must break compilation in this table; a ternary would let the new state
	 * silently fall to the default. The pairing is checked by requiring the **same keys** as the
	 * name-tag table.
	 */
	it("covers the same states as the label table", () => {
		expect(Object.keys(WORK_VISIBILITY_BADGE).sort()).toEqual(
			Object.keys(WORK_VISIBILITY_LABEL).sort(),
		);
	});

	/**
	 * If the weights collapse to one, this table does nothing; that regression happened for real.
	 *
	 * Counts **cells**, not states (see the header table). If each state demanded its own weight, the
	 * only spare variant once a fifth value arrives is `destructive`, and the shortest way to satisfy
	 * that would be painting a warning color on an ordinary state.
	 */
	it("the weight splits into three cells", () => {
		const weights = (
			Object.keys(WORK_VISIBILITY_BADGE) as StoryVisibility[]
		).map((visibility) => WORK_VISIBILITY_BADGE[visibility]);
		expect(new Set(weights).size).toBe(3);
	});

	/** In the catalogue and out of it must be **different** weights; this is the most common distinction. */
	it("public isn't the same weight as any of the others", () => {
		for (const visibility of ["unlisted", "private", "archived"] as const)
			expect(WORK_VISIBILITY_BADGE[visibility]).not.toBe(
				WORK_VISIBILITY_BADGE.public,
			);
	});

	/**
	 * Even when colors match, the words always differ. That fact is why `unlisted` and `private` may
	 * share a weight, so if this breaks, that decision's premise is gone.
	 */
	it("labels differ per state", () => {
		const labels = Object.values(WORK_VISIBILITY_LABEL);
		expect(new Set(labels).size).toBe(labels.length);
	});

	/** The warning color is not a visibility color: `destructive` means "cannot be undone". */
	it("no state uses a warning color", () => {
		expect(Object.values(WORK_VISIBILITY_BADGE)).not.toContain("destructive");
	});
});
