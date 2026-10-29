/**
 * Numbers and dates shown on screen. **They show the same values as the web.**
 *
 * This file exists for exactly that one reason. If a work's registration date differs by a day
 * between the web and the app, users read one of them as wrong, and we have no way to say which is
 * right. So the device time zone is not used; the product time zone is fixed, and its value is
 * `PRODUCT_TIME_ZONE` in `@rowcat/domain` — the same value the web, the operations console and the
 * server's age rule read.
 *
 * Only the zone is shared. Locale and formats stay **display** decisions each app makes for its own
 * screens; what must not diverge is **which day it is**. The zone itself used to be a literal here
 * on the same grounds, and that left a fork to find four copies of one value.
 *
 * Adding no dependency is also a decision. `Intl` already exists in Hermes (SDK 57's default build
 * includes `Intl`), and the only rule needed is "divide by 1024 until it stops".
 */

import { PRODUCT_TIME_ZONE } from "@rowcat/domain";

/**
 * Formatters are built **once** at module level. Creating `Intl` instances is not cheap, the list
 * shows twenty rows, and the detail redraws.
 */
const DATE = new Intl.DateTimeFormat("en-US", {
	timeZone: PRODUCT_TIME_ZONE,
	year: "numeric",
	month: "long",
	day: "numeric",
});

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
	timeZone: PRODUCT_TIME_ZONE,
	dateStyle: "long",
	timeStyle: "short",
});

/**
 * Never draws today's date for an unreadable value.
 *
 * `new Date("…")` does not throw on a parse failure; it yields `Invalid Date`. Passing that to a
 * formatter produces a different string per runtime (empty or "Invalid Date"), and neither is
 * meaningful to the user. A non-value leaves the slot empty instead of inventing a fact.
 */
const parse = (iso: string): Date | null => {
	const at = new Date(iso);
	return Number.isNaN(at.getTime()) ? null : at;
};

export const formatDate = (iso: string): string | null => {
	const at = parse(iso);
	return at ? DATE.format(at) : null;
};

export const formatDateTime = (iso: string): string | null => {
	const at = parse(iso);
	return at ? DATE_TIME.format(at) : null;
};

/**
 * The "how long ago" line. It is **the same sentences** as the web's `lib/format/relative-time.ts`.
 *
 * The rule is carried over from the web's account screen and conversation list. If the boundaries
 * diverge (for example, only one side moves `Just now` to 30 seconds or writes `yesterday` as `1 day ago`), the same
 * conversation states different times on two screens, and users read one of them as wrong. The
 * arithmetic matches the web character for character: rounding makes the `Just now` boundary 30 seconds
 * and the `yesterday` boundary 24 hours.
 *
 * ## `Intl.RelativeTimeFormat` is not used — **Hermes does not have it**
 *
 * This is where it differs from the other formatters in this file, and the fact was first
 * discovered **on the simulator.** Hermes provides `Intl.DateTimeFormat`, `NumberFormat` and
 * `Collator`, but not `Intl.RelativeTimeFormat`. The absence is not silent: the moment the module
 * loads it throws `undefined cannot be used as a constructor` and **the whole screen dies.** Node
 * has the constructor, so every unit test in this repository was green.
 *
 * So the sentences are written as a table. This is not imitating locale data: it **writes out the
 * branches the web actually produces** (`en-US` + `numeric: "auto"`). `format.test.ts` checks
 * by value that the web's output and this table never diverge. A polyfill is not added because that
 * would bundle all the locale data; only a handful of sentences are needed.
 *
 * **Unlike absolute dates, this does not consider the time zone.** A relative label is the
 * **difference** between two instants and is independent of time zone; inserting the product zone would
 * change nothing and add one more rule.
 *
 * Not promoted to a shared package, for the same reason as absolute dates: this is a **display**
 * decision.
 *
 * `now` is an argument for testability. The default is `Date.now()`, so callers pass nothing, but
 * there is no reason to wait for the real clock to check the boundaries (30 seconds, 60 minutes, 24
 * hours).
 */

/**
 * The places where `numeric: "auto"` uses words instead of numbers. English has only one.
 *
 * From two days ago onward it is `2 days ago` again. Extending this table by hand is not done: it would
 * mean hand-expanding locale data, and the moment it diverges from the web's output the reason this
 * file exists is gone.
 */
const NAMED_DAYS: Record<number, string> = { 1: "yesterday" };

/** `numeric: "auto"` still counts in numerals for minutes and hours, singular at one. */
const ago = (n: number, unit: "minute" | "hour" | "day"): string =>
	`${n} ${unit}${n === 1 ? "" : "s"} ago`;

/** An unreadable value is an empty string; today's date is never invented (same axis as `parse` above). */
export function relativeTime(iso: string, now: number = Date.now()): string {
	const elapsed = now - Date.parse(iso);
	if (!Number.isFinite(elapsed)) return "";
	const minutes = Math.round(elapsed / 60_000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return ago(minutes, "minute");
	const hours = Math.round(minutes / 60);
	if (hours < 24) return ago(hours, "hour");
	const days = Math.round(hours / 24);
	return NAMED_DAYS[days] ?? ago(days, "day");
}

const SIZE_UNITS = ["KB", "MB", "GB", "TB"] as const;

/**
 * File size. **The same rule** as the web's work detail: if the same work shows different sizes on
 * two screens, that value too becomes one nobody can verify.
 *
 * Decimals are kept only below 10 (9.7 MB is meaningful; the `.4` of 973.4 KB is not).
 */
export function formatSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "-";
	if (bytes < 1024) return `${bytes} B`;
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value < 10 ? 1 : 0)} ${SIZE_UNITS[unit]}`;
}

/**
 * Totals and favourite counts. **Never abbreviated.**
 *
 * `12.4K` renders 12,400 and 12,449 as the same glyphs. That trades accuracy for fitting a narrow
 * screen, and the creator analytics screen refused abbreviation for the same reason (`AGENTS.md`,
 * `### Analytics — creator metrics`).
 */
export const formatCount = (value: number): string =>
	Number.isFinite(value) ? value.toLocaleString("en-US") : "-";
