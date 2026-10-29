import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { notFound, serviceUnavailable } from "../lib/errors.ts";
import { etagOf, notModified } from "../lib/http.ts";
import {
	type ByteGate,
	ByteGateUnavailableError,
	createByteGate,
	MEDIA_DELIVERY_LIMITS,
	releasingBody,
} from "../lib/media/delivery-gate.ts";
import { parseByteRange } from "../lib/media/range.ts";
import {
	getReadableMedia,
	readMediaBytes,
	readMediaRange,
} from "../services/media.ts";

/**
 * The only path that serves media bytes. Audio shares it because the question this route answers is
 * medium-independent: may this identity's bytes be served now. That is why the failure copy changed
 * from "image" to "file".
 *
 * It has one verb on purpose. Writes belong to the domain that owns the media (`/me/avatar`); there
 * is no generic `POST /media` where the body picks the kind, since then policy (cap, output size,
 * gate) becomes a request-borne value and bytes validated under the avatar cap could become a
 * cover.
 *
 * Why not point at the storage directly (a bucket's public URL would make this route unnecessary):
 * - access control: bytes whose status is not `ready` would be readable by address alone;
 * - safety checks: the pipeline loses the point where it can block before publication;
 * - portability: swapping storage would break every address already in HTML and caches, whereas
 *   an address that is ours makes a swap one adapter.
 *
 * Cache differs from covers. A cover's address is fixed (`/stories/:id/cover`), so `immutable`
 * waits for the `?v=` comparison. Media gets a new id, and so a new address, whenever it changes,
 * so the content behind an address never changes and `immutable` for one year is unconditionally
 * true. `public` is for avatars only (shown on public profiles, comments and notifications); scene
 * images may belong to an unpublished draft, so they are `private` like covers.
 */

/**
 * One slot pool per process, capping bytes held in buffers (`delivery-gate.ts`). Module-level
 * because the limit is the process's; tests swap in a small one.
 */
let gate: ByteGate = createByteGate(MEDIA_DELIVERY_LIMITS);

/** Test-only: shrinks the limit so tests can assert by value. */
export function __setMediaDeliveryGateForTest(next: ByteGate | null): void {
	gate = next ?? createByteGate(MEDIA_DELIVERY_LIMITS);
}

/** Slots free up within seconds, so the wait hint is short. */
const SATURATED_RETRY_AFTER_SECONDS = 2;

/**
 * Takes a slot, or answers 503 (not 429: the process is busy, which this request did not cause). A
 * receiver that already left drops out of the queue.
 */
async function reserve(bytes: number, signal: AbortSignal) {
	try {
		return await gate.acquire(bytes, signal);
	} catch (error) {
		if (error instanceof ByteGateUnavailableError)
			throw serviceUnavailable(
				"Please try again in a moment.",
				"media_busy",
				SATURATED_RETRY_AFTER_SECONDS,
			);
		throw error;
	}
}

export const media = new Hono<AppEnv>().get("/:mediaId", async (c) => {
	const mediaId = c.req.param("mediaId");
	const record = await getReadableMedia(mediaId);
	/**
	 * A missing media and one not yet public are the same 404; distinguishing them would make the
	 * response an existence detector.
	 */
	if (!record) throw notFound("File not found.");

	/**
	 * The ETag derives from the media id, not a byte hash: the id is already the content's identity
	 * (one id is always the same bytes), and rehashing hundreds of KB per response buys nothing. Range
	 * responses carry the same ETag because it identifies the resource, not the slice; per-slice
	 * values would make a client read two slices of one track as different resources.
	 */
	const etag = etagOf(record.id);
	c.header("ETag", etag);
	/**
	 * Conditional requests finish before any bytes are fetched, otherwise a 304 would still cost a
	 * storage round trip per response (avatars are drawn dozens per list page). Range requests end
	 * here too: a 304 has no body, and continuing into range math would emit a 304 carrying
	 * `Content-Range`.
	 */
	if (notModified(c, etag)) return c.body(null, 304);

	/**
	 * `Accept-Ranges` goes on every response, especially non-range ones: media clients usually decide
	 * from a 200's header whether to attempt seeking later.
	 */
	c.header("Accept-Ranges", "bytes");
	c.header("Content-Type", record.mime);
	/**
	 * Only normalized rasters and container-checked audio are stored, which already narrows sniffing
	 * risk; that is why this header is cheap, not a reason to drop it.
	 */
	c.header("X-Content-Type-Options", "nosniff");
	/**
	 * `public` fits avatars only. A scene image may be an unpublished draft's, and intermediate caches
	 * (CDN, corporate proxy, shared browser cache) must not hand it to anyone for a year: the address
	 * is a 122-bit random so it cannot be enumerated, but a leak through referrers, history or proxy
	 * logs would make it permanently public. The cover route uses `private` for the same reason; both
	 * are immutable (address = content). Range responses follow the same policy.
	 */
	c.header(
		"Cache-Control",
		`${record.kind === "avatar" ? "public" : "private"}, max-age=31536000, immutable`,
	);

	/**
	 * The total length comes from the row; reading bytes first to judge a range would load 10MiB into
	 * memory for a request that ends in 416.
	 */
	const total = record.byteSize;
	const range = parseByteRange(c.req.header("Range"), total);

	if (range.kind === "unsatisfiable") {
		/**
		 * A 416 must carry `Content-Range: bytes * /TOTAL` so the client can re-ask with the real size;
		 * without it a retry repeats the same failure.
		 */
		c.header("Content-Range", `bytes */${total}`);
		return c.body(null, 416);
	}

	/**
	 * ⚠️ HEAD neither takes a slot nor reads bytes. Hono runs HEAD through this GET handler and then
	 * discards the body without cancelling it (`new Response(null, res)`); a `releasingBody` there
	 * never sees an end or a cancel, so the slot never returns. Thirteen sessionless HEADs on a 10 MiB
	 * track would fill the 128 MiB pool and 503 all media in this process until restart. So HEAD
	 * answers headers from the row's values. The cost: an orphan pointer (row without bytes) still
	 * gets a 200 on HEAD, while GET stays honest with a 404; hiding that would mean reading bytes and
	 * making HEAD heavy again.
	 */
	if (c.req.method === "HEAD") {
		if (range.kind === "partial") {
			c.header(
				"Content-Range",
				`bytes ${range.start}-${range.endInclusive}/${total}`,
			);
			c.header("Content-Length", String(range.endInclusive - range.start + 1));
			return c.body(null, 206);
		}
		c.header("Content-Length", String(total));
		return c.body(null, 200);
	}

	if (range.kind === "partial") {
		const length = range.endInclusive - range.start + 1;
		/**
		 * The slot is sized to the slice, not the track: a playing track usually asks for a few hundred
		 * KB at a time, and counting whole tracks would let a few sounds eat the process's slots.
		 */
		const release = await reserve(length, c.req.raw.signal);
		let chunk: Buffer | null;
		try {
			chunk = await readMediaRange(record, range.start, range.endInclusive + 1);
		} catch (error) {
			release();
			throw error;
		}
		/**
		 * Row without bytes is an orphan pointer from an interrupted cleanup; same 404 as the full
		 * response, for the same reason.
		 */
		if (!chunk) {
			release();
			throw notFound("File not found.");
		}
		/**
		 * If the stored `byte_size` and the actual bytes disagree the slice comes short, and writing the
		 * row's value into `Content-Range` would promise bytes never sent, leaving the client waiting
		 * forever. Write only what is actually sent.
		 */
		const end = range.start + chunk.byteLength - 1;
		c.header("Content-Range", `bytes ${range.start}-${end}/${total}`);
		c.header("Content-Length", String(chunk.byteLength));
		if (chunk.byteLength !== length)
			console.warn(
				"[media] the range response disagrees with the stored length",
				{
					mediaId: record.id,
					expected: length,
					actual: chunk.byteLength,
				},
			);
		return c.body(
			releasingBody(chunk, release, { signal: c.req.raw.signal }),
			206,
		);
	}

	const release = await reserve(total, c.req.raw.signal);
	let bytes: Buffer | null;
	try {
		bytes = await readMediaBytes(record);
	} catch (error) {
		release();
		throw error;
	}
	/**
	 * Orphan pointer from an interrupted cleanup. 404 rather than 500, because the resource really is
	 * gone for the user and a 500 makes the screen retry forever with the same result.
	 */
	if (!bytes) {
		release();
		throw notFound("File not found.");
	}

	c.header("Content-Length", String(bytes.byteLength));
	/**
	 * The slot returns after the last chunk is sent, or when the receiver leaves. Stream cancel alone
	 * cannot reveal that, so the request's `signal` is passed too (see `releasingBody`).
	 */
	return c.body(releasingBody(bytes, release, { signal: c.req.raw.signal }));
});
