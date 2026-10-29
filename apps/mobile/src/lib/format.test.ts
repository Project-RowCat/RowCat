import { describe, expect, it } from "vitest";
import { formatCount, formatDate, formatSize, relativeTime } from "./format.ts";

/**
 * Values shown on screen: **the ones that must match the web.**
 *
 * The time zone is the point of this file. Printing with the device time zone makes the same work's
 * registration date differ by a day between the web and the app, and users read one of them as
 * wrong. The guarantee only holds if the same strings come out regardless of the `TZ` of the
 * machine running the tests.
 */

describe("dates print in the product timezone", () => {
	it("just before UTC midnight is the next day in Seoul", () => {
		// `2026-01-01T15:00Z` = Seoul 2026-01-02 00:00. Using the device time zone would make this value
		// flicker.
		expect(formatDate("2026-01-01T15:00:00.000Z")).toBe("January 2, 2026");
	});

	it("the same instant is the same day whatever the notation", () => {
		expect(formatDate("2026-01-01T15:00:00.000Z")).toBe(
			formatDate("2026-01-02T00:00:00.000+09:00"),
		);
	});

	it("doesn't draw today's date for unreadable values", () => {
		/**
		 * `new Date("…")` does not throw on a parse failure. Passing that to a formatter produces a
		 * different string per runtime, and neither is meaningful to the user.
		 */
		expect(formatDate("yesterday")).toBeNull();
		expect(formatDate("")).toBeNull();
	});
});

describe("sizes follow the same rule as the web", () => {
	it.each([
		[0, "0 B"],
		[512, "512 B"],
		[1024, "1.0 KB"],
		[1536, "1.5 KB"],
		// Decimals are kept only below 10 (the `.4` of 973.4 KB is meaningless).
		[996_147, "973 KB"],
		[10 * 1024 * 1024, "10 MB"],
		[9 * 1024 * 1024, "9.0 MB"],
	])("%s bytes is %s", (bytes, expected) => {
		expect(formatSize(bytes)).toBe(expected);
	});

	it("doesn't invent numbers for nonsense values", () => {
		expect(formatSize(-1)).toBe("-");
		expect(formatSize(Number.NaN)).toBe("-");
	});
});

describe("doesn't abbreviate numbers", () => {
	it("inserts only thousands separators", () => {
		/**
		 * `12.4K` renders 12,400 and 12,449 as the same glyphs. That trades accuracy for fitting a narrow
		 * screen, and the creator analytics screen refused abbreviation for the same reason.
		 */
		expect(formatCount(12_449)).toBe("12,449");
		expect(formatCount(1_247_017)).toBe("1,247,017");
		expect(formatCount(0)).toBe("0");
	});

	it.each(["K", "M", "B"])("doesn't attach units like %s", (unit) => {
		expect(formatCount(1_234_567)).not.toContain(unit);
	});
});

/**
 * Relative time: **the same sentences** as the web (`apps/web/src/lib/format/relative-time.ts`).
 *
 * The conversation list row draws this value, and the web's same list uses the same rule. If the
 * boundaries diverge, the same conversation states different times on two screens, and users read
 * one of them as wrong.
 *
 * ## The last check in this group is the most important one in this file
 *
 * This app's implementation does **not** use `Intl.RelativeTimeFormat`: Hermes lacks the
 * constructor, so the screen dies the moment the module loads (`format.ts` records that incident).
 * The sentences therefore come from a hand-written table, and divergence from the web does not
 * surface as a compile error but only as **the two apps stating the same instant differently**.
 *
 * The final check below builds the web's output with the constructor available in Node and compares
 * against it. The place this test runs has that API (Node with full ICU), so **only the device
 * lacks it**, and that fact becomes a value.
 */
describe("relative time", () => {
	const now = Date.parse("2026-03-03T12:00:00.000Z");
	const ago = (ms: number) => new Date(now - ms).toISOString();

	it.each([
		[0, "Just now"],
		/** Rounding makes the boundary 30 seconds; the web uses the same arithmetic. */
		[29_000, "Just now"],
		[30_000, "1 minute ago"],
		[60_000, "1 minute ago"],
		[59 * 60_000, "59 minutes ago"],
		[60 * 60_000, "1 hour ago"],
		[23 * 3_600_000, "23 hours ago"],
		[24 * 3_600_000, "yesterday"],
		[3 * 24 * 3_600_000, "3 days ago"],
	])("%s milliseconds ago is %s", (elapsed, expected) => {
		expect(relativeTime(ago(elapsed), now)).toBe(expected);
	});

	/**
	 * Never invents a time for an unreadable value. An empty slot in a list row is better than `Just now`
	 * written on a conversation that was not just created.
	 */
	it("unreadable values are the empty string", () => {
		expect(relativeTime("around yesterday", now)).toBe("");
		expect(relativeTime("", now)).toBe("");
	});

	/**
	 * **Identical, character for character, to the sentences the web actually produces.**
	 *
	 * The point is that the expected values come from `Intl.RelativeTimeFormat`, not from hand-written
	 * values. Hand-written expectations would compare our table with our table and guard nothing.
	 */
	it("gives the same sentence as the web's Intl output", () => {
		const web = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

		for (const n of [1, 2, 3, 30, 59])
			expect(relativeTime(ago(n * 60_000), now), `${n} minutes`).toBe(
				web.format(-n, "minute"),
			);

		for (const n of [1, 2, 12, 23])
			expect(relativeTime(ago(n * 3_600_000), now), `${n} hours`).toBe(
				web.format(-n, "hour"),
			);

		/** Checks both the position where `yesterday` is a word and where it returns to numerals. */
		for (const n of [1, 2, 3, 7, 30, 400])
			expect(relativeTime(ago(n * 86_400_000), now), `${n} days`).toBe(
				web.format(-n, "day"),
			);
	});
});
