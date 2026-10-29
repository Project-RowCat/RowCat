import { describe, expect, it } from "vitest";
import {
	CREATOR_ANALYTICS_WINDOW_LABEL,
	CREATOR_ANALYTICS_WINDOWS,
	type CreatorAnalyticsWork,
	creatorAnalyticsWindowStart,
	playStartConversion,
	uniqueCreatorAnalyticsWorks,
} from "./creator-analytics.ts";

/**
 * Pins the analytics window boundaries and the conversion ratio as values, so the server and the
 * screen count the same things.
 */

describe("creatorAnalyticsWindowStart", () => {
	const now = new Date("2026-09-07T15:30:00.000Z");

	it("all time has no boundary", () => {
		expect(creatorAnalyticsWindowStart("all", now)).toBeNull();
	});

	it("today is today's UTC midnight, not the last 24 hours", () => {
		expect(creatorAnalyticsWindowStart("day", now)?.toISOString()).toBe(
			"2026-09-07T00:00:00.000Z",
		);
	});

	it("the last 7 and 30 days start at the first midnight of N days **including** today", () => {
		expect(creatorAnalyticsWindowStart("week", now)?.toISOString()).toBe(
			"2026-09-01T00:00:00.000Z",
		);
		expect(creatorAnalyticsWindowStart("month", now)?.toISOString()).toBe(
			"2026-08-09T00:00:00.000Z",
		);
	});

	it("crosses month and year boundaries", () => {
		expect(
			creatorAnalyticsWindowStart(
				"week",
				new Date("2026-01-03T01:00:00.000Z"),
			)?.toISOString(),
		).toBe("2025-12-28T00:00:00.000Z");
	});

	it("independent of the device time zone; counts in UTC only", () => {
		/** The same instant written in two ways must produce the same boundary. */
		const local = new Date(2026, 8, 7, 23, 59);
		expect(creatorAnalyticsWindowStart("day", local)?.toISOString()).toBe(
			`${local.toISOString().slice(0, 10)}T00:00:00.000Z`,
		);
	});

	it("every vocabulary value has a word", () => {
		for (const window of CREATOR_ANALYTICS_WINDOWS)
			expect(CREATOR_ANALYTICS_WINDOW_LABEL[window]).toBeTruthy();
	});
});

describe("playStartConversion", () => {
	it("no views is null, not 0%", () => {
		expect(playStartConversion({ views: 0, playStarts: 0 })).toBeNull();
		expect(playStartConversion({ views: 0, playStarts: 3 })).toBeNull();
	});

	it("views without starts is 0", () => {
		expect(playStartConversion({ views: 10, playStarts: 0 })).toBe(0);
	});

	it("the ratio is as is; not clamped above 100%", () => {
		expect(playStartConversion({ views: 8, playStarts: 2 })).toBe(0.25);
		expect(playStartConversion({ views: 2, playStarts: 3 })).toBe(1.5);
	});
});

describe("uniqueCreatorAnalyticsWorks", () => {
	const work = (id: string, views: number): CreatorAnalyticsWork => ({
		id,
		title: id,
		visibility: "public",
		hidden: false,
		views,
		favorites: 0,
		comments: 0,
		playStarts: 0,
		windowViews: views,
		windowPlayStarts: 0,
		updatedAt: "2026-10-01T00:00:00.000Z",
	});

	/**
	 * Between page fetches the metrics can move, so a work can come back on the next page. Rows are
	 * keyed by work id, so drawing both copies would collide React keys.
	 */
	it("a work that comes back across a boundary stays as one row in its first position", () => {
		const rows = uniqueCreatorAnalyticsWorks([
			work("a", 10),
			work("b", 5),
			work("b", 7),
			work("c", 3),
		]);
		expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
		expect(rows[1]?.views).toBe(5);
	});
});
