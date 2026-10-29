import { describe, expect, it } from "vitest";
import { applyOverlay, reconcileOverlay } from "./draft-overlay.ts";

/**
 * Edit overlay, where characters disappear. A wrong rule erases just-typed characters on every save
 * (the record wins); holding too long keeps another device's edit off screen forever.
 */

interface Draft {
	title: string;
	prompt: string;
	tags: string[];
}

const record = (over: Partial<Draft> = {}): Draft => ({
	title: "Title",
	prompt: "Body",
	tags: ["a"],
	...over,
});

describe("catching up", () => {
	/** The value we sent came back; this round is over and the record is heard again. */
	it("removes the keys the record caught up on", () => {
		expect(
			reconcileOverlay({ title: "New title" }, record({ title: "New title" })),
		).toEqual({});
	});

	/**
	 * Not caught up yet. Accepting the record here would erase just-typed characters whenever a
	 * backed-up save lands; the queue already holds the newest value.
	 */
	it("leaves keys that didn't catch up", () => {
		const overlay = { title: "New title" };
		expect(reconcileOverlay(overlay, record())).toBe(overlay);
	});

	/** One key catching up does not discard the rest. */
	it("decides per key", () => {
		expect(
			reconcileOverlay(
				{ title: "caught up", prompt: "not yet" },
				record({ title: "caught up" }),
			),
		).toEqual({ prompt: "not yet" });
	});

	/**
	 * With nothing to change the same object is returned, so callers can skip a render-time `setState`
	 * on identity; otherwise this adjustment is itself an infinite render.
	 */
	it("nothing to change gives the same reference", () => {
		const overlay = { prompt: "not yet" };
		expect(reconcileOverlay(overlay, record())).toBe(overlay);
		expect(reconcileOverlay({}, record())).toEqual({});
	});

	/** Tags are arrays; comparing by reference would never catch up. */
	it("arrays compare by value", () => {
		expect(reconcileOverlay({ tags: ["a"] }, record())).toEqual({});
		expect(reconcileOverlay({ tags: ["a", "b"] }, record())).toEqual({
			tags: ["a", "b"],
		});
	});
});

describe("overlay", () => {
	/** If the order flipped, just-typed characters would be overwritten by the stored value. */
	it("the overlay beats the record", () => {
		expect(applyOverlay(record(), { title: "New title" })).toEqual({
			title: "New title",
			prompt: "Body",
			tags: ["a"],
		});
	});

	it("an empty overlay leaves the record as is", () => {
		expect(applyOverlay(record(), {})).toEqual(record());
	});
});
