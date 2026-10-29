import { describe, expect, test } from "vitest";
import {
	CREATOR_ANALYTICS_WINDOW_LABEL,
	CREATOR_ANALYTICS_WINDOWS,
	creatorAnalyticsWindowStart,
} from "./creator-analytics.ts";
import {
	STORY_PERIOD_LABEL,
	STORY_PERIODS,
	storyPeriodStart,
} from "./story.ts";
import {
	CALENDAR_WINDOW_LABEL,
	CALENDAR_WINDOWS,
	calendarWindowStart,
	utcCalendarDay,
} from "./time-window.ts";

/**
 * A time window is one definition: popular sort on discovery and creator analytics count the same
 * days. This file pins three things by value: the window starts at UTC midnight, the labels mean
 * the same as that boundary, and the vocabulary, labels, and boundaries of both screens come from
 * one source.
 */

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

describe("calendar window boundaries", () => {
	/** A late-evening time, to show whether the start folds to midnight. */
	const now = new Date("2026-09-07T21:34:56.789Z");

	test("all has no boundary", () => {
		expect(calendarWindowStart("all", now)).toBeNull();
	});

	test("day is today's UTC midnight, not a rolling 24 hours", () => {
		expect(iso(calendarWindowStart("day", now))).toBe(
			"2026-09-07T00:00:00.000Z",
		);
	});

	test("week is seven UTC calendar days including today", () => {
		expect(iso(calendarWindowStart("week", now))).toBe(
			"2026-09-01T00:00:00.000Z",
		);
	});

	test("month is thirty UTC calendar days including today", () => {
		expect(iso(calendarWindowStart("month", now))).toBe(
			"2026-08-09T00:00:00.000Z",
		);
	});

	/**
	 * A zero time component is the literal form of a closed boundary. The server cuts with `>=`, so an
	 * event at exactly that midnight is inside, and one millisecond earlier is outside. The inclusion
	 * behavior itself is verified by a real query (apps/api/src/routes/stories/popular.test.ts).
	 */
	test("the window start has zero time components", () => {
		for (const window of ["day", "week", "month"] as const) {
			const start = calendarWindowStart(window, now);
			if (!start) throw new Error(`${window} has a boundary`);
			expect(start.getUTCHours()).toBe(0);
			expect(start.getUTCMinutes()).toBe(0);
			expect(start.getUTCSeconds()).toBe(0);
			expect(start.getUTCMilliseconds()).toBe(0);
		}
	});

	test("just after midnight it is still today's midnight; the window does not fall back to yesterday", () => {
		expect(
			iso(calendarWindowStart("day", new Date("2026-09-07T00:00:00.000Z"))),
		).toBe("2026-09-07T00:00:00.000Z");
		expect(
			iso(calendarWindowStart("day", new Date("2026-09-07T00:00:00.001Z"))),
		).toBe("2026-09-07T00:00:00.000Z");
	});

	test("crosses months and years", () => {
		/**
		 * A 7-day window starting March 1 crosses into February. In a leap year the start is February 24.
		 */
		expect(
			iso(calendarWindowStart("week", new Date("2028-03-01T05:00:00Z"))),
		).toBe("2028-02-24T00:00:00.000Z");
		/** In a common year the start is one day later, February 23. */
		expect(
			iso(calendarWindowStart("week", new Date("2027-03-01T05:00:00Z"))),
		).toBe("2027-02-23T00:00:00.000Z");
		/** A 30-day window that spans a year boundary. */
		expect(
			iso(calendarWindowStart("month", new Date("2026-01-05T12:00:00Z"))),
		).toBe("2025-12-07T00:00:00.000Z");
	});

	test("does not read the host time zone; both ends of a UTC day give the same window", () => {
		const early = calendarWindowStart("week", new Date("2026-09-07T00:00:00Z"));
		const late = calendarWindowStart("week", new Date("2026-09-07T23:59:59Z"));
		expect(iso(early)).toBe(iso(late));
	});
});

describe("date ledger boundaries", () => {
	test("the date string from midnight has the view ledger's shape", () => {
		const start = calendarWindowStart("week", new Date("2026-09-07T21:00:00Z"));
		if (!start) throw new Error("week has a boundary");
		expect(utcCalendarDay(start)).toBe("2026-09-01");
	});

	test("lexical order is time order; `>=` comparison holds", () => {
		const cutoff = utcCalendarDay(new Date("2026-09-01T00:00:00Z"));
		expect(utcCalendarDay(new Date("2026-09-01T23:59:59Z")) >= cutoff).toBe(
			true,
		);
		expect(utcCalendarDay(new Date("2026-08-31T23:59:59Z")) >= cutoff).toBe(
			false,
		);
	});
});

describe("both screens read the same source", () => {
	test("same vocabulary", () => {
		expect(STORY_PERIODS).toBe(CALENDAR_WINDOWS);
		expect(CREATOR_ANALYTICS_WINDOWS).toBe(CALENDAR_WINDOWS);
	});

	test("same labels, with no `This week` or `This month`", () => {
		expect(STORY_PERIOD_LABEL).toBe(CALENDAR_WINDOW_LABEL);
		expect(CREATOR_ANALYTICS_WINDOW_LABEL).toBe(CALENDAR_WINDOW_LABEL);
		expect(CALENDAR_WINDOW_LABEL).toEqual({
			all: "All time",
			day: "Today",
			week: "Last 7 days",
			month: "Last 30 days",
		});
		/**
		 * `This week` and `This month` mean ISO weeks and calendar months. This window is neither, so putting those
		 * words on it would describe something the screen does not count.
		 */
		for (const label of Object.values(CALENDAR_WINDOW_LABEL)) {
			expect(label).not.toBe("This week");
			expect(label).not.toBe("This month");
		}
	});

	test("same boundaries: discovery's `Last 7 days` and analytics' `Last 7 days` are the same days", () => {
		const now = new Date("2026-09-07T13:00:00Z");
		for (const window of CALENDAR_WINDOWS)
			expect(iso(storyPeriodStart(window, now))).toBe(
				iso(creatorAnalyticsWindowStart(window, now)),
			);
	});
});
