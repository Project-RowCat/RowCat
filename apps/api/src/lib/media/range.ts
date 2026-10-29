/**
 * Decides one `Range` header. Pure: knows neither HTTP nor storage.
 *
 * It exists as a separate file because range arithmetic is easy to get wrong at the edges and the
 * symptom is silently truncated audio, not a 500. Audio needs it because media clients seek and
 * resume with range requests; answering 200 with everything re-downloads the track on every seek
 * (Safari may give up playing).
 *
 * - Multi-range (`bytes=0-9,20-29`) is ignored (full 200), not served: nothing uses
 *   `multipart/byteranges` and RFC 9110 permits ignoring. Rejecting with 416 would leave the sender
 *   with nothing. Malformed syntax gets the same answer.
 * - `If-Range` is not handled: the address is the content (a new media id is a new address), so
 *   the bytes behind one address never change.
 */

export type ByteRangeDecision =
	/** Not a range request, or a shape we do not handle: serve the whole body as 200. */
	| { kind: "full" }
	/** Serve this slice as 206. The end is inclusive, as `Content-Range` writes it. */
	| { kind: "partial"; start: number; endInclusive: number }
	/** Points outside the resource: 416 with `Content-Range: bytes * /TOTAL`. */
	| { kind: "unsatisfiable" };

const FULL: ByteRangeDecision = { kind: "full" };

/**
 * Decides `Range: bytes=…` against the total length.
 *
 * ```text
 * bytes=0-9      first 10 bytes
 * bytes=10-      from 10 to the end
 * bytes=-10      the LAST 10 bytes (the suffix form is the easiest to get wrong)
 * ```
 *
 * A zero `total` returns full (an empty 200): a 416 would make a client fetching an empty resource
 * fail forever.
 */
export function parseByteRange(
	header: string | undefined | null,
	total: number,
): ByteRangeDecision {
	if (!header || total <= 0) return FULL;

	const match = /^bytes=(.*)$/i.exec(header.trim());
	if (match === null) return FULL;

	const spec = (match[1] ?? "").trim();
	// Multi-range is not built; see the header.
	if (spec.length === 0 || spec.includes(",")) return FULL;

	const parts = /^(\d*)-(\d*)$/.exec(spec);
	if (parts === null) return FULL;

	const rawStart = parts[1] ?? "";
	const rawEnd = parts[2] ?? "";
	if (rawStart.length === 0 && rawEnd.length === 0) return FULL;

	if (rawStart.length === 0) {
		// Suffix range. A suffix larger than the total is the whole resource, not a failure, otherwise a
		// client that does not know the size cannot get the last chunk.
		const suffix = Number(rawEnd);
		if (!Number.isSafeInteger(suffix)) return FULL;
		if (suffix === 0) return { kind: "unsatisfiable" };
		const start = Math.max(0, total - suffix);
		return { kind: "partial", start, endInclusive: total - 1 };
	}

	const start = Number(rawStart);
	if (!Number.isSafeInteger(start)) return FULL;
	if (start >= total) return { kind: "unsatisfiable" };

	if (rawEnd.length === 0)
		return { kind: "partial", start, endInclusive: total - 1 };

	const end = Number(rawEnd);
	if (!Number.isSafeInteger(end)) return FULL;
	// Start after end is syntactically invalid: ignore (full), not 416.
	if (end < start) return FULL;
	return { kind: "partial", start, endInclusive: Math.min(end, total - 1) };
}
