/**
 * Shared display rule for "time since" lines, used by several screens. It was moved here from the
 * sync section. Two copies would let the same timestamp read differently on different screens, for
 * example if one copy moved the `just now` boundary to 30 seconds or wrote `yesterday` as `1 day ago`.
 *
 * This file owns wording only. Callers say what the timestamp refers to (last sync or last
 * activity). Adding that context here would turn the file into a phrase store.
 *
 * Do not call this on the server. The result depends on Date.now(), so server render and hydration
 * could produce different text. The current caller sits inside a browser-only boundary.
 */

import { translator } from "#/lib/i18n/current.ts";
import { cachedFormatter } from "#/lib/i18n/format.ts";

const RELATIVE = cachedFormatter(
	(locale) => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
);

/**
 * `now` is a parameter so tests can check the boundaries (59 seconds, 60 minutes, 24 hours) without
 * waiting on the real clock.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
	const elapsed = now - Date.parse(iso);
	if (!Number.isFinite(elapsed)) return "";
	const minutes = Math.round(elapsed / 60_000);
	if (minutes < 1) return translator("common")("time.justNow");
	if (minutes < 60) return RELATIVE().format(-minutes, "minute");
	const hours = Math.round(minutes / 60);
	if (hours < 24) return RELATIVE().format(-hours, "hour");
	return RELATIVE().format(-Math.round(hours / 24), "day");
}
