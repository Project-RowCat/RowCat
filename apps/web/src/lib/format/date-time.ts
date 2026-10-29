import { PRODUCT_TIME_ZONE } from "@rowcat/domain";
import { cachedFormatter, intlLocale } from "#/lib/i18n/format.ts";

/**
 * Absolute date formatting: the one place in the web that applies the product time zone.
 *
 * This file exists for the same reason `relative-time.ts` owns 'how long ago'. The difference is
 * that what must not vary here is not the wording but which day it is, and the time zone determines
 * that:
 *
 *   server (UTC container) -> `August 20, 2026`
 *   browser (KST)          -> `August 21, 2026` (same value, different string)
 *
 * This breaks two things at once: hydration mismatches (server HTML and the first client render
 * disagree), and the same work's registration date differs by a day between web and app. The app
 * already made this decision in one file (`apps/mobile/src/lib/format.ts`); this file is the web
 * counterpart.
 *
 * ## Why a function instead of a formatter
 *
 * While the rule was scattered, five screens each wrote their own `Intl.DateTimeFormat` with the
 * time zone, each beside the same explanatory comment. Five copies of one rationale showed the file
 * was needed. One copy did drop the time zone and passed unnoticed (workspace draft and published
 * times). That omission throws no error; it just displays a different date.
 *
 * The raw function `productDateTimeFormat`, which takes options, exists so that a new format has
 * somewhere to go other than a direct `Intl` call. It fills in locale and time zone itself, so they
 * cannot be forgotten.
 *
 * ## Not here
 *
 * - Relative time: it belongs to `relative-time.ts`. That one depends on `Date.now()` and cannot
 *   be called on the server; this one works during SSR. Keeping them together would erase that
 *   difference.
 * - Numbers and sizes: a different axis, and the no-abbreviation rule has its own home.
 * - Whose timestamp it is ('last activity' or 'registered'): the caller says so.
 */

/**
 * Product time zone. The date shown is set by this time zone rather than by the viewer's device. A
 * device zone would make one value a different day for each person, and then 'when was this work
 * posted' would have no single answer. The value lives in `@rowcat/domain` beside the age rule, so
 * every app and the server agree on which day it is.
 */
export { PRODUCT_TIME_ZONE };

/**
 * The locale is the render's locale (cookie or Accept-Language, decided once per request), not the
 * browser's own setting, for the same reason as the time zone: the server and the browser must
 * format the same value the same way, or hydration mismatches.
 */

/**
 * Creates a formatter with locale and time zone already filled in.
 *
 * Callers supply only the shape of the output. The time zone is deliberately not a parameter: if it
 * could be passed in, someday one call site would fail to pass it.
 */
export const productDateTimeFormat = (
	options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat =>
	new Intl.DateTimeFormat(intlLocale(), {
		timeZone: PRODUCT_TIME_ZONE,
		...options,
	});

const zonedFormat = (options: Intl.DateTimeFormatOptions) =>
	cachedFormatter(
		(locale) =>
			new Intl.DateTimeFormat(locale, {
				timeZone: PRODUCT_TIME_ZONE,
				...options,
			}),
	);

/**
 * The formatter is created once per locale. Constructing an `Intl` instance is not cheap, and a
 * screen that uses this value renders a list of twenty rows or more.
 */
const DATE = zonedFormat({
	year: "numeric",
	month: "long",
	day: "numeric",
});

const DATE_TIME = zonedFormat({
	year: "numeric",
	month: "long",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

/**
 * Unreadable values render neither today's date nor 'Invalid Date'.
 *
 * `new Date(...)` does not throw on a parse failure; it returns an Invalid Date. Passing that to
 * `Intl.DateTimeFormat.format()` throws a `RangeError`, so one formatted line would crash the whole
 * screen. A non-date value yields an empty string (the same rule as `relative-time.ts`).
 */
const parse = (iso: string): Date | null => {
	const at = new Date(iso);
	return Number.isNaN(at.getTime()) ? null : at;
};

export function formatDate(iso: string): string {
	const at = parse(iso);
	return at ? DATE().format(at) : "";
}

export function formatDateTime(iso: string): string {
	const at = parse(iso);
	return at ? DATE_TIME().format(at) : "";
}
