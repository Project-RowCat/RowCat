/**
 * The single definition of a time window. Popular sort on discovery and creator analytics must
 * count the same days.
 *
 * Analytics once cut by UTC calendar day, while discovery cut by `now - 7 × 86400000`. Two screens
 * with the same label showed different numbers, and neither was wrong on its own terms. Copies of
 * the cutoff in each service would let that drift return without any test failing.
 *
 * Windows are UTC calendar days, not rolling 24-hour periods. `day` is today, `week` is the last
 * seven UTC calendar days including today, and `month` is the last thirty. The view log
 * (story_view_log) is keyed by a date string and cannot be cut by time of day. Time-stamped logs
 * (plays, favorites) use the same midnight boundary, so a ratio built from both
 * (playStartConversion) divides numbers from the same window.
 *
 * Labels avoid `This week` and `This month`, which mean ISO weeks and calendar months. `now` is a parameter so
 * that boundary tests do not depend on the wall clock.
 */

export const CALENDAR_WINDOWS = ["all", "day", "week", "month"] as const;
export type CalendarWindow = (typeof CALENDAR_WINDOWS)[number];

/**
 * Number of UTC calendar days a window covers, including today. `all` has no boundary, so it is
 * null.
 */
export const CALENDAR_WINDOW_DAYS: Record<CalendarWindow, number | null> =
	Object.freeze({
		all: null,
		day: 1,
		week: 7,
		month: 30,
	});

/**
 * Human-readable labels, which must mean what the computed window means. The discovery toolbar and
 * the analytics window picker both read this table. Separate copies would let one change and
 * produce a label like 'this week' over a window that counts seven days.
 */
export const CALENDAR_WINDOW_LABEL: Record<CalendarWindow, string> =
	Object.freeze({
		all: "All time",
		day: "Today",
		week: "Last 7 days",
		month: "Last 30 days",
	});

/**
 * Start of the window: the first UTC midnight of the N days that include today, or null for `all`.
 * The boundary is closed. The returned instant is inside (`>=`), and one millisecond before it is
 * outside.
 */
export function calendarWindowStart(
	window: CalendarWindow,
	now: Date,
): Date | null {
	const days = CALENDAR_WINDOW_DAYS[window];
	if (days === null) return null;
	const start = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	start.setUTCDate(start.getUTCDate() - (days - 1));
	return start;
}

/**
 * `YYYY-MM-DD` in UTC, the same shape as the `day` column in the view log. Lexical order equals
 * chronological order, so `>=` works directly. Both logs count the same days because the
 * timestamped cutoff and this string come from the same midnight.
 */
export const utcCalendarDay = (date: Date): string =>
	date.toISOString().slice(0, 10);
