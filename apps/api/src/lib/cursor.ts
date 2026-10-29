import { badRequest } from "./errors.ts";

/**
 * `(created_at, id)` cursor shared by the time-ordered lists (comments, moderation queue). One copy
 * because an encode/decode mismatch fails silently at page boundaries.
 *
 * - Not offset: both lists grow while being read, and `OFFSET` would duplicate or drop the
 *   boundary row.
 * - `id` rides along to order rows within the same millisecond; the pair is compared as a row
 *   (`(a,b) > (x,y)`), so `id` only decides on equal timestamps.
 * - Precision is part of the contract: values pass through JS `Date` (ms), so the tables using
 *   this cursor declare `created_at` as `timestamp(3)`. At microsecond precision the next page
 *   would let the boundary row through again.
 * - base64url keeps clients from parsing the value, so the sort key can change server-side.
 */
export interface TimelineCursor {
	createdAt: Date;
	id: string;
}

export const encodeTimelineCursor = (c: TimelineCursor): string =>
	Buffer.from(`${c.createdAt.getTime()}.${c.id}`, "utf8").toString("base64url");

/** Largest time `Date` can represent (ms); anything above is Invalid Date. */
const MAX_TIMESTAMP_MS = 8.64e15;
/** Length of ids from `newId()` (hyphenless UUID). */
const MAX_CURSOR_ID_LENGTH = 32;

/**
 * Malformed cursors throw rather than silently falling back to the first page, which would make
 * infinite scroll repeat the same rows with no visible cause.
 */
export function decodeTimelineCursor(raw: string): TimelineCursor {
	const text = Buffer.from(raw, "base64url").toString("utf8");
	const dot = text.indexOf(".");
	const ms = Number(text.slice(0, dot));
	const id = text.slice(dot + 1);
	// `isSafeInteger` alone passes up to 9.007e15 while `Date` stops at 8.64e15; values between would
	// become Invalid Date and surface as a driver 500. The id length is capped too.
	if (
		dot < 1 ||
		!Number.isSafeInteger(ms) ||
		ms < 0 ||
		ms > MAX_TIMESTAMP_MS ||
		!id ||
		id.length > MAX_CURSOR_ID_LENGTH
	)
		throw badRequest(
			"Couldn't continue loading the list. Please refresh and try again.",
			"invalid_cursor",
		);
	return { createdAt: new Date(ms), id };
}
