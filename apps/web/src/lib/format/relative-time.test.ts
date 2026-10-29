import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time.ts";

/**
 * This file pins the boundaries because several screens share this formatting. A change that breaks
 * it is silent: the same timestamp starts reading differently on different screens.
 */

const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("elapsed time line", () => {
	it("under a minute is just now", () => {
		expect(relativeTime(ago(0), NOW)).toBe("Just now");
		expect(relativeTime(ago(29 * SECOND), NOW)).toBe("Just now");
	});

	it("steps up through minutes, hours and days", () => {
		expect(relativeTime(ago(2 * MINUTE), NOW)).toBe("2 minutes ago");
		expect(relativeTime(ago(3 * HOUR), NOW)).toBe("3 hours ago");
		expect(relativeTime(ago(3 * DAY), NOW)).toBe("3 days ago");
	});

	/** Comes from `numeric: "auto"`, which gives `yesterday` here rather than `1 day ago`. */
	it("one day ago is yesterday", () => {
		expect(relativeTime(ago(DAY), NOW)).toBe("yesterday");
	});

	/**
	 * Unreadable values must not render as `NaN minutes ago`. Callers may draw the empty string as is (nothing
	 * appears), which is better than showing a wrong time.
	 */
	it("an unreadable value is an empty string", () => {
		expect(relativeTime("around yesterday", NOW)).toBe("");
	});
});
