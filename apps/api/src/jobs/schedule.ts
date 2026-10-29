import type { JobSchedule } from "./types.ts";

/**
 * Pure "when is the next run" calculation, kept out of the scheduler because a wrong answer is
 * silent: a daily job that misreads the timezone would run destruction nine hours off with no
 * error.
 *
 * - The host timezone is never read. `Date#getHours()` and friends use the process's local zone,
 *   which `TZ` leaves to the image or orchestrator, so the same commit would run at different times
 *   per deployment. The zone is an argument, resolved with `Intl.DateTimeFormat`.
 * - Missed runs do not pile up. The next run is always the earliest occurrence after `from`;
 *   these jobs re-inspect current state each time, so catching up would repeat the same work.
 */

interface ZonedParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

const partsFormatter = (timeZone: string): Intl.DateTimeFormat =>
	new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});

function zonedParts(at: Date, timeZone: string): ZonedParts {
	const parts = partsFormatter(timeZone).formatToParts(at);
	const read = (type: Intl.DateTimeFormatPartTypes): number => {
		const n = Number(parts.find((p) => p.type === type)?.value ?? "0");
		return Number.isFinite(n) ? n : 0;
	};
	return {
		year: read("year"),
		month: read("month"),
		day: read("day"),
		// Some runtimes report midnight as "24" even with `hour12: false`; fold it to 0.
		hour: read("hour") % 24,
		minute: read("minute"),
		second: read("second"),
	};
}

/**
 * Starts from a `Date.UTC` guess and corrects by the measured offset. One pass is not always enough
 * (the correction can cross a DST boundary), so it runs twice. A value that still does not match is
 * a wall-clock time that does not exist in that zone (the spring-forward hour); the corrected value
 * is used as-is, since an hour's error does not matter for a daily maintenance job.
 */
function zonedTimeToUtc(parts: ZonedParts, timeZone: string): Date {
	let guess = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
	);
	for (let round = 0; round < 2; round++) {
		const seen = zonedParts(new Date(guess), timeZone);
		const seenUtc = Date.UTC(
			seen.year,
			seen.month - 1,
			seen.day,
			seen.hour,
			seen.minute,
			seen.second,
		);
		const wantUtc = Date.UTC(
			parts.year,
			parts.month - 1,
			parts.day,
			parts.hour,
			parts.minute,
			parts.second,
		);
		if (seenUtc === wantUtc) return new Date(guess);
		guess += wantUtc - seenUtc;
	}
	return new Date(guess);
}

/** The boundary is open (`> from`); a closed one would re-run immediately when a run ends within 1ms. */
export function nextRunAt(
	schedule: JobSchedule,
	from: Date,
	lastStartedAt: Date | null,
): Date {
	if (schedule.kind === "interval") {
		// The interval runs start to start. A slow run makes the next one due at once (the lock and
		// in-process gate prevent overlap); measuring from the end would let slow runs push the period
		// out.
		const base = lastStartedAt ?? from;
		const next = base.getTime() + schedule.everyMs;
		return new Date(Math.max(next, from.getTime() + 1));
	}

	const local = zonedParts(from, schedule.timeZone);
	const today = zonedTimeToUtc(
		{
			year: local.year,
			month: local.month,
			day: local.day,
			hour: schedule.hour,
			minute: schedule.minute,
			second: 0,
		},
		schedule.timeZone,
	);
	if (today.getTime() > from.getTime()) return today;

	// Same wall-clock time tomorrow. Adding 24 hours would drift the time across DST changes.
	const tomorrow = zonedParts(
		new Date(from.getTime() + 24 * 60 * 60 * 1000),
		schedule.timeZone,
	);
	return zonedTimeToUtc(
		{
			year: tomorrow.year,
			month: tomorrow.month,
			day: tomorrow.day,
			hour: schedule.hour,
			minute: schedule.minute,
			second: 0,
		},
		schedule.timeZone,
	);
}

/** Human-readable period; the boot log and operations docs use the same string. */
export function describeSchedule(schedule: JobSchedule): string {
	if (schedule.kind === "interval") {
		const seconds = Math.round(schedule.everyMs / 1000);
		return seconds % 60 === 0
			? `every ${seconds / 60} minutes`
			: `every ${seconds} seconds`;
	}
	const hh = String(schedule.hour).padStart(2, "0");
	const mm = String(schedule.minute).padStart(2, "0");
	return `daily at ${hh}:${mm} (${schedule.timeZone})`;
}
