/**
 * Display formats. Numbers are never abbreviated: `12.4K` makes 12,400 and 12,449 the same glyphs,
 * and an operator cannot compare yesterday with today that way (creator analytics has the same
 * rule).
 *
 * Times are pinned to the product timezone (`PRODUCT_TIME_ZONE` in `@rowcat/domain`). With the
 * device timezone two operators discussing one incident would quote different times, which is
 * costly during incident response.
 */

import { PRODUCT_TIME_ZONE } from "@rowcat/domain";

export const formatCount = (value: number): string =>
	value.toLocaleString("ko-KR");

const dateTimeFormat = new Intl.DateTimeFormat("ko-KR", {
	timeZone: PRODUCT_TIME_ZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

/**
 * Returns an unparseable value verbatim instead of throwing: one bad timestamp must not turn the
 * whole table into an error screen.
 */
export function formatDateTime(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date);
}

export function formatRelative(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

/** Uptime is the only consumer. */
export function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ${minutes % 60}m`;
	return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Tables only. The full id stays in the `title` attribute (and copying uses it); a 32-character id
 * column eats half the table while operators read only the first few characters.
 */
export const shortId = (id: string): string =>
	id.length <= 12 ? id : `${id.slice(0, 8)}…`;
