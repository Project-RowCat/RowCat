import type { Rev } from "@rowcat/contracts/sync";
import { describe, expect, it } from "vitest";
import { absorbHlc, compareRev, HLC_ORIGIN, maxRev, tickHlc } from "./clock.ts";

/**
 * Clock tests. The clock decides which edit wins, so its results are pinned exactly. Failures here
 * are silent. A one-step ordering error shows nothing on screen; later, when two devices meet, one
 * side's draft disappears. By then it is too late, because the revisions used for that decision are
 * already stored on both devices.
 */

const DEVICE = "device-a";
const rev = (t: number, c: number, d = DEVICE): Rev => ({ t, c, d });

describe("local tick", () => {
	it("the first tick uses the wall clock as is", () => {
		const { state, rev: issued } = tickHlc(HLC_ORIGIN, 1_000, DEVICE);
		expect(state).toEqual({ t: 1_000, c: 0 });
		expect(issued).toEqual({ t: 1_000, c: 0, d: DEVICE });
	});

	it("the counter resets to 0 when the wall clock moves forward", () => {
		const first = tickHlc({ t: 1_000, c: 5 }, 2_000, DEVICE);
		expect(first.state).toEqual({ t: 2_000, c: 0 });
	});

	it("consecutive ticks in the same millisecond split by the counter", () => {
		/**
		 * A common real path: attaching a message while also touching the room, or autosave writing
		 * several children in a row. Without the counter, those revisions would be equal and the order
		 * would be lost.
		 */
		const first = tickHlc(HLC_ORIGIN, 1_000, DEVICE);
		const second = tickHlc(first.state, 1_000, DEVICE);
		const third = tickHlc(second.state, 1_000, DEVICE);

		expect([first.rev.c, second.rev.c, third.rev.c]).toEqual([0, 1, 2]);
		expect(compareRev(first.rev, second.rev)).toBeLessThan(0);
		expect(compareRev(second.rev, third.rev)).toBeLessThan(0);
	});

	it("t does not go down when the wall clock goes back", () => {
		/** Backward clock moves really happen (manual change, NTP correction), so this case is tested. */
		const { state, rev: issued } = tickHlc({ t: 5_000, c: 0 }, 1_000, DEVICE);
		expect(state).toEqual({ t: 5_000, c: 1 });
		expect(compareRev(issued, rev(5_000, 0))).toBeGreaterThan(0);
	});
});

describe("remote absorption", () => {
	it("absorbs a revision from the future rather than refusing it", () => {
		const state = absorbHlc(
			{ t: 1_000, c: 3 },
			rev(9_000, 2, "device-b"),
			1_100,
		);
		expect(state).toEqual({ t: 9_000, c: 3 });

		const next = tickHlc(state, 1_100, DEVICE);
		expect(compareRev(next.rev, rev(9_000, 2, "device-b"))).toBeGreaterThan(0);
	});

	it("with equal t it continues from the larger counter", () => {
		const state = absorbHlc(
			{ t: 1_000, c: 4 },
			rev(1_000, 7, "device-b"),
			1_000,
		);
		expect(state).toEqual({ t: 1_000, c: 8 });
	});

	it("when the wall clock is ahead of both it restarts the counter", () => {
		const state = absorbHlc(
			{ t: 1_000, c: 4 },
			rev(2_000, 9, "device-b"),
			5_000,
		);
		expect(state).toEqual({ t: 5_000, c: 0 });
	});
});

describe("total order", () => {
	it("t comes first", () => {
		expect(compareRev(rev(1, 99), rev(2, 0))).toBeLessThan(0);
	});

	it("equal t splits by c", () => {
		expect(compareRev(rev(1, 1), rev(1, 2))).toBeLessThan(0);
	});

	it("equal t and c split by device id", () => {
		expect(compareRev(rev(1, 1, "a"), rev(1, 1, "b"))).toBeLessThan(0);
		expect(compareRev(rev(1, 1, "b"), rev(1, 1, "a"))).toBeGreaterThan(0);
		expect(compareRev(rev(1, 1, "a"), rev(1, 1, "a"))).toBe(0);
	});

	it("maxRev gives the same answer with arguments swapped", () => {
		const older = rev(1_000, 0, "a");
		const newer = rev(1_000, 1, "b");
		expect(maxRev(older, newer)).toEqual(newer);
		expect(maxRev(newer, older)).toEqual(newer);
		expect(maxRev(older, { ...older })).toEqual(older);
	});
});

describe("corrupt values", () => {
	it("NaN and negatives do not break the total order", () => {
		const { state, rev: issued } = tickHlc(
			{ t: Number.NaN, c: -3 },
			Number.NaN,
			DEVICE,
		);
		expect(state).toEqual({ t: 0, c: 1 });
		expect(Number.isInteger(issued.t)).toBe(true);
		expect(compareRev(issued, rev(0, 0))).toBeGreaterThan(0);
	});
});
