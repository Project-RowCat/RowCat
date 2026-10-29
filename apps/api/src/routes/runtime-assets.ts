import { classifyRuntimeAssetValue } from "@rowcat/runtime/asset";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { ApiError, badRequest } from "../lib/errors.ts";
import { requireViewer } from "../lib/gates.ts";
import { toArrayBuffer } from "../lib/http.ts";
import { checkRateLimit, reserveRateLimit } from "../lib/rate-limit/index.ts";
import { REMOTE_IMAGE_BUDGET } from "../lib/remote-image/budget.ts";
import {
	fetchRemoteImage,
	type RemoteImageFailure,
} from "../lib/remote-image/fetch.ts";
import {
	createSlotGate,
	type SlotGate,
	SlotUnavailableError,
} from "../lib/remote-image/slots.ts";

/**
 * Remote images for the creator runtime — `GET /v2/runtime/assets/remote?url=…`.
 *
 * RowCat fetches the image `asset("https://…")` points at and relays it, so a player's device never
 * reaches the creator's host. Otherwise one `asset("https://creator.example/pixel?id=…")` leaks the
 * player's IP to the creator and breaks the promise that the runtime has no `fetch`.
 *
 * This is an image proxy, not an HTTP proxy. The response is one image in a supported format and
 * nothing from upstream (status, headers, body, error text — `lib/remote-image/fetch.ts`). Failures
 * go out under two codes only, with no detail: distinguishing private network / 404 / format / size
 * would turn this endpoint into a probe of other networks from inside our server.
 *
 * Why it is not an open proxy:
 *
 * ```text
 * session          guests get 401
 * per-member count lib/rate-limit's runtimeRemoteAsset — 240/min
 * per-member bytes runtimeRemoteAssetBytes — 512 MiB / 10 min, reserved on entry, settled after
 * process slots    16 concurrent, 64 queued — caps buffered memory
 * destination      syntax → DNS → address (private, loopback, metadata refused) → again per redirect
 * response         four image/* types, magic bytes must match, 10 MiB, 10 s
 * ```
 *
 * The request count alone allowed 2.4 GiB/min, so bytes are counted separately
 * (`lib/remote-image/budget.ts` holds the numbers and their derivation). Order matters:
 *
 * ```text
 * count → syntax (a 400 spends no budget) → slot → reserve → fetch (count bytes read) → settle
 * ```
 *
 * Settling charges the bytes actually read, including wrong-format and capped responses — they used
 * our line too. Redirects are not separate reservations: every hop of one request sits under one
 * response cap, and redirect bodies are cut unread. When the client disconnects, upstream is
 * aborted and only what was read is charged; the slot and reservation are released together. The
 * budget's unit is the member because the request has no session or story parameter (a claim there
 * would be authorization), so preview and playback share one budget.
 *
 * Authorization is not tied to story entitlement for the same reason. The image is already on the
 * public internet, so what is protected here is our resources, not a secret.
 *
 * Cache is `private, max-age=3600`. Not `immutable`, because the content is not ours and the
 * creator can replace the file on their CDN (unlike the media route's one-year cache). `private`
 * because the response needs a session. Cache identity is the full URL including the query, so two
 * signed URLs never collapse. Upstream cache directives are ignored.
 */

/** The only two failure codes; neither carries detail. */
const ASSET_INVALID = "runtime_asset_invalid";
const ASSET_UNAVAILABLE = "runtime_asset_unavailable";

/** Lets the browser's `<img>` retry, but not immediately. */
const UNAVAILABLE_RETRY_AFTER_SECONDS = 30;

/** Slots free up within seconds, so the wait is short. */
const SATURATED_RETRY_AFTER_SECONDS = 5;

/** Module-level because it is the per-process memory ceiling; one per request would be no ceiling. */
let slots: SlotGate = createSlotGate(REMOTE_IMAGE_BUDGET);

/** Test-only: shrinks the slots to check the concurrency cap by value. No product caller. */
export function __setRemoteImageSlotsForTest(next: SlotGate | null): void {
	slots = next ?? createSlotGate(REMOTE_IMAGE_BUDGET);
}

/**
 * The failure's inner name, read by ops logs and tests; the response carries only the two codes. No
 * URL, host or byte count is logged — that would put signed URLs in the log.
 */
function logUnavailable(
	reason: RemoteImageFailure | "saturated" | "queue-full",
): void {
	if (reason === "cancelled") return;
	console.info(`[runtime-assets] remote unavailable: reason=${reason}`);
}
export const runtimeAssets = new Hono<AppEnv>().get("/remote", async (c) => {
	const viewer = requireViewer(await c.get("viewer")());
	await checkRateLimit("runtimeRemoteAsset", viewer.id);

	/**
	 * Syntax is judged by the same function as the runtime: anything `asset()` rejects is a 400 here,
	 * and so is a logical path (`characters/sena/smile`), which is not proxy input.
	 */
	const raw = c.req.query("url") ?? "";
	const target = classifyRuntimeAssetValue(raw);
	if (target === null || target.kind !== "remote")
		throw badRequest("Not a remote image address.", ASSET_INVALID);

	const signal = c.req.raw.signal;

	let releaseSlot: () => void;
	try {
		releaseSlot = await slots.acquire(signal);
	} catch (error) {
		if (!(error instanceof SlotUnavailableError)) throw error;
		logUnavailable(error.reason === "queue-full" ? "queue-full" : "saturated");
		throw new ApiError(503, ASSET_UNAVAILABLE, "Couldn't fetch the image.", {
			retryAfterSeconds: SATURATED_RETRY_AFTER_SECONDS,
		});
	}

	let read = 0;
	let result: Awaited<ReturnType<typeof fetchRemoteImage>>;
	try {
		/** Over budget is a 429 here; the `finally` returns the slot. */
		const reservation = await reserveRateLimit(
			"runtimeRemoteAssetBytes",
			viewer.id,
			REMOTE_IMAGE_BUDGET.reservePerRequest,
		);
		try {
			result = await fetchRemoteImage(target.url, {
				signal,
				meter: (bytes) => {
					read += bytes;
				},
			});
		} finally {
			await reservation.settle(read);
		}
	} finally {
		releaseSlot();
	}

	if (!result.ok) {
		logUnavailable(result.reason);
		throw new ApiError(502, ASSET_UNAVAILABLE, "Couldn't fetch the image.", {
			retryAfterSeconds: UNAVAILABLE_RETRY_AFTER_SECONDS,
		});
	}

	c.header("Content-Type", result.contentType);
	c.header("Content-Length", String(result.bytes.byteLength));
	/** The format the bytes declared, so the browser cannot sniff it into something else. */
	c.header("X-Content-Type-Options", "nosniff");
	c.header("Cache-Control", "private, max-age=3600");
	return c.body(toArrayBuffer(result.bytes));
});
