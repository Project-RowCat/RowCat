import { describe, expect, test } from "vitest";
import { describeSchedule, nextRunAt } from "./schedule.ts";
import type { JobSchedule } from "./types.ts";

/**
 * Schedule computation, tested by value with no DB or timer. A wrong result is silent: a daily job
 * misreading the time zone would delete nine hours off, visible only by comparing log timestamps.
 */

const seoulDaily = (hour: number, minute = 0): JobSchedule => ({
	kind: "daily",
	hour,
	minute,
	timeZone: "Asia/Seoul",
});

/** Wall-clock time in that zone, so assertions are human-readable. */
const wallClock = (at: Date, timeZone: string): string =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone,
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	})
		.format(at)
		.replace(", ", " ");

describe("interval schedule", () => {
	test("the first due time is one interval from now — it does not run right after boot", () => {
		const now = new Date("2026-08-25T00:00:00.000Z");
		const next = nextRunAt({ kind: "interval", everyMs: 300_000 }, now, null);
		expect(next.toISOString()).toBe("2026-08-25T00:05:00.000Z");
	});

	test("the interval is between **starts** — a slow run does not push the schedule back", () => {
		const startedAt = new Date("2026-08-25T00:00:00.000Z");
		// A run that took 6 minutes just finished.
		const now = new Date("2026-08-25T00:06:00.000Z");
		const next = nextRunAt(
			{ kind: "interval", everyMs: 300_000 },
			now,
			startedAt,
		);
		// Already past, so due immediately; not finish time + 5 minutes.
		expect(next.getTime()).toBeLessThanOrEqual(now.getTime() + 1);
	});

	test("the due time is always after `from` — the same instant is never read as due again", () => {
		const now = new Date("2026-08-25T00:00:00.000Z");
		const next = nextRunAt({ kind: "interval", everyMs: 300_000 }, now, now);
		expect(next.getTime()).toBeGreaterThan(now.getTime());
	});
});

describe("daily schedule", () => {
	test("today, if today's time has not come yet", () => {
		// Seoul 2026-08-25 01:00 (= 16:00 UTC the day before)
		const now = new Date("2026-08-24T16:00:00.000Z");
		const next = nextRunAt(seoulDaily(3), now, null);
		expect(wallClock(next, "Asia/Seoul")).toBe("2026-08-25 03:00");
	});

	test("the next day, if it has already passed", () => {
		// Seoul 2026-08-25 04:00
		const now = new Date("2026-08-24T19:00:00.000Z");
		const next = nextRunAt(seoulDaily(3), now, null);
		expect(wallClock(next, "Asia/Seoul")).toBe("2026-08-26 03:00");
	});

	test("does not read the host timezone — asking about the same instant in two timezones gives different answers", () => {
		const now = new Date("2026-08-24T16:00:00.000Z");
		const seoul = nextRunAt(seoulDaily(3), now, null);
		const utc = nextRunAt(
			{ kind: "daily", hour: 3, minute: 0, timeZone: "UTC" },
			now,
			null,
		);
		expect(seoul.toISOString()).not.toBe(utc.toISOString());
		expect(wallClock(utc, "UTC")).toBe("2026-08-25 03:00");
	});

	test("keeps the wall-clock time even in regions with daylight saving", () => {
		// A "+24 hours" implementation would slip an hour here. US Eastern DST starts 2026-03-08, and the
		// next run from the day before must still be 03:00.
		const schedule: JobSchedule = {
			kind: "daily",
			hour: 3,
			minute: 0,
			timeZone: "America/New_York",
		};
		// New York 2026-03-07 04:00 (that day's 03:00 has already passed)
		const now = new Date("2026-03-07T09:00:00.000Z");
		const next = nextRunAt(schedule, now, null);
		expect(wallClock(next, "America/New_York")).toBe("2026-03-08 03:00");
	});

	test("does not pile up missed runs — even after stopping for three days, the next is one run", () => {
		// Seoul 2026-08-28 04:00; the last run was on the 25th.
		const now = new Date("2026-08-27T19:00:00.000Z");
		const lastStarted = new Date("2026-08-24T18:00:00.000Z");
		const next = nextRunAt(seoulDaily(3), now, lastStarted);
		expect(wallClock(next, "Asia/Seoul")).toBe("2026-08-29 03:00");
	});

	test("midnight is expressible too — at 01:00 Seoul, 00:30 has passed, so it is tomorrow", () => {
		const now = new Date("2026-08-24T16:00:00.000Z"); // Seoul 2026-08-25 01:00
		const next = nextRunAt(seoulDaily(0, 30), now, null);
		expect(wallClock(next, "Asia/Seoul")).toBe("2026-08-26 00:30");
	});

	test("just before midnight, today's 00:30 is still ahead", () => {
		const now = new Date("2026-08-24T15:10:00.000Z"); // Seoul 2026-08-25 00:10
		const next = nextRunAt(seoulDaily(0, 30), now, null);
		expect(wallClock(next, "Asia/Seoul")).toBe("2026-08-25 00:30");
	});
});

describe("human-readable schedule", () => {
	test("interval — read in minutes when it divides evenly", () => {
		expect(describeSchedule({ kind: "interval", everyMs: 300_000 })).toBe(
			"every 5 minutes",
		);
		expect(describeSchedule({ kind: "interval", everyMs: 45_000 })).toBe(
			"every 45 seconds",
		);
	});

	test("daily — **the timezone is in the string** (the operations docs and boot log use the same value)", () => {
		expect(describeSchedule(seoulDaily(3))).toBe("daily at 03:00 (Asia/Seoul)");
	});
});
