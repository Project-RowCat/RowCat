import { REMOTE_IMAGE_LIMITS } from "./limits.ts";

/**
 * Resource budget of the remote-image proxy: bytes and concurrency.
 *
 * `fetch.ts` guards the correctness of one request (SSRF, format, size, deadline); this file guards
 * totals. They split because for a long time the only total limit was a request count of 240 per
 * member per minute, theoretically 2.4 GiB/minute (240 x 10 MiB): valid requests alone could
 * consume unbounded bandwidth and memory.
 *
 * ```text
 * per response   10 MiB             fetch.ts, enforced while counting the stream
 * per member     512 MiB / 10 min   admit by reservation, give back what was not used
 * per process    16 in flight, 64 queued   ceiling on buffered bytes (16 x 10 MiB)
 * ```
 *
 * ## Where the numbers come from
 *
 * - Window bytes: a work can declare 256 remote images
 *   (`RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxCount`, pinned by a test). Fetching all of them once
 *   at 2 MiB average is 512 MiB per window. Browsers and apps cache responses for an hour
 *   (`private, max-age=3600`), so redrawing the same screen barely uses the budget; beyond that is
 *   a loop, not a screen.
 * - Reservation size = response cap: the real size is unknown at admission, so the largest case
 *   is reserved. A member can therefore hold at most 512 / 10 = 51 concurrent fetches, a number a
 *   normal screen never reaches because `loading="lazy"` requests only visible images.
 * - Process concurrency 16: responses are buffered whole (magic-byte check), so concurrency is
 *   memory; worst case 16 x 10 MiB = 160 MiB. Overflow requests wait briefly instead of being
 *   refused, so a scene change loading many images at once does not drop normal requests to
 *   placeholders. The wait is capped (64 queued, 5 s).
 *
 * ## What this budget is not
 *
 * - Not a runtime-session budget. The server cannot see a session, and the proxy takes no
 *   parameter claiming a story or artifact (a claim would be authorization). The unit is the
 *   member: one member's preview and playback share a budget and never touch another member's.
 * - Not the managed-media (`/v2/media/:id`) budget. That path is public with no session (native
 *   audio sends no cookie) and IP is not an identity in this repository. It has an identity-free
 *   byte-weighted slot (`lib/media/delivery-gate.ts`) that bounds memory but not one member's total
 *   bandwidth; closing that needs a session on the asset path, a separate decision.
 */

const MiB = 1024 * 1024;

export const REMOTE_IMAGE_BUDGET = {
	/** Bytes one member may fetch in one window. */
	bytesPerWindow: 512 * MiB,
	windowMs: 10 * 60_000,
	/** Amount reserved on entry; the same value as the response cap, since nothing larger can be received. */
	reservePerRequest: REMOTE_IMAGE_LIMITS.maxBytes,
	/** Concurrent fetches per process. */
	maxInFlight: 16,
	/** Requests allowed to wait for a slot; beyond this, refuse immediately. */
	maxQueued: 64,
	/** Maximum wait for a slot; shorter than the fetch deadline (10 s). */
	maxWaitMs: 5_000,
} as const;
