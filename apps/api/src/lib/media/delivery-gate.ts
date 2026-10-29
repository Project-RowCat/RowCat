/**
 * Caps the bytes the process holds buffered while serving managed media (`GET /v2/media/:id`). It
 * guards the memory axis only.
 *
 * Weight is bytes, not request count. Avatars of tens of KB and 10 MiB audio tracks share this path
 * (and audio often arrives as small range requests), so a count limit tuned for avatars overflows
 * memory on a few tracks and one tuned for tracks queues dozens of avatars. The weight is what the
 * response actually buffers: the row's `byte_size` for a full read, the slice length for a range.
 * The remote image proxy (`remote-image/slots.ts`) counts requests because its single response cap
 * makes count equal bytes.
 *
 * It has no identity, on purpose. This path is sessionless (avatars are public, native audio sends
 * no cookie), IP is not an identity in this repository, and a fake identity must not reuse the
 * member budget (`remote-image/budget.ts`). The gate asks "how much right now", not "who": it
 * cannot stop one person's share, but it stops concurrent requests from knocking the process over.
 * The uncovered axis (total line bandwidth) is explained in `docs/ops/RATE-LIMITING.md`.
 *
 * Waiting is brief and FIFO rather than immediate refusal: many images arriving at once on a screen
 * change is normal and `<img>` does not retry. The queue wakes in arrival order; letting small
 * requests overtake would leave the free space always small, so a track could never get in, which
 * shows up as audio that "sometimes does not play" and does not reproduce.
 *
 * A response larger than the capacity has its weight folded down to the capacity and enters alone.
 * Refusing it forever would make that media unreadable in this deployment, an outage and not a
 * limit.
 */

export type ByteGateRefusal = "queue-full" | "wait-timeout" | "cancelled";

export class ByteGateUnavailableError extends Error {
	readonly reason: ByteGateRefusal;
	constructor(reason: ByteGateRefusal) {
		super(`media delivery gate unavailable: ${reason}`);
		this.name = "ByteGateUnavailableError";
		this.reason = reason;
	}
}

export interface ByteGate {
	/**
	 * Reserves `bytes` and returns the release function. Releasing twice is safe (body end and cancel
	 * can overlap). Rejects with `ByteGateUnavailableError` when no slot can be had.
	 */
	acquire(bytes: number, signal?: AbortSignal): Promise<() => void>;
	/** Held bytes and waiter count, for tests and diagnostics. */
	stats(): { inFlightBytes: number; inFlight: number; queued: number };
}

export interface ByteGateLimits {
	/** Bytes that may be held at once. */
	capacityBytes: number;
	/** Requests that may wait; beyond this is an immediate refusal. */
	maxQueued: number;
	/** Longest a request may wait. */
	maxWaitMs: number;
}

interface Waiter {
	weight: number;
	wake: () => void;
}

export function createByteGate(limits: ByteGateLimits): ByteGate {
	let inFlightBytes = 0;
	let inFlight = 0;
	const waiting: Waiter[] = [];

	/**
	 * A zero-byte response still weighs 1; at 0, repeated requests for an empty resource would pass
	 * the gate untouched even though each costs a storage round trip.
	 */
	const weightOf = (bytes: number): number =>
		Math.min(limits.capacityBytes, Math.max(1, Math.ceil(bytes)));

	const fits = (weight: number): boolean =>
		inFlight === 0 || inFlightBytes + weight <= limits.capacityBytes;

	const grant = (weight: number): (() => void) => {
		inFlightBytes += weight;
		inFlight += 1;
		let returned = false;
		return () => {
			if (returned) return;
			returned = true;
			inFlightBytes -= weight;
			inFlight -= 1;
			drain();
		};
	};

	/** Wakes from the front while they fit; if the head does not fit, the rest wait (FIFO). */
	const drain = () => {
		while (waiting.length > 0) {
			const head = waiting[0] as Waiter;
			if (!fits(head.weight)) return;
			waiting.shift();
			head.wake();
		}
	};

	return {
		acquire(bytes, signal) {
			if (signal?.aborted)
				return Promise.reject(new ByteGateUnavailableError("cancelled"));
			const weight = weightOf(bytes);
			if (waiting.length === 0 && fits(weight))
				return Promise.resolve(grant(weight));
			if (waiting.length >= limits.maxQueued)
				return Promise.reject(new ByteGateUnavailableError("queue-full"));

			return new Promise((resolve, reject) => {
				const waiter: Waiter = {
					weight,
					wake: () => {
						leave();
						resolve(grant(weight));
					},
				};
				const leave = () => {
					const at = waiting.indexOf(waiter);
					if (at !== -1) waiting.splice(at, 1);
					clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
				};
				const onAbort = () => {
					leave();
					reject(new ByteGateUnavailableError("cancelled"));
					/** If the head left, the next one may now fit. */
					drain();
				};
				const timer = setTimeout(() => {
					leave();
					reject(new ByteGateUnavailableError("wait-timeout"));
					drain();
				}, limits.maxWaitMs);
				signal?.addEventListener("abort", onAbort, { once: true });
				waiting.push(waiter);
			});
		},
		stats: () => ({ inFlightBytes, inFlight, queued: waiting.length }),
	};
}

/**
 * A body that streams one buffer while holding its slot.
 *
 * Releasing when the handler returns `c.body(buffer)` would make the gate lie: the bytes stay in
 * memory until written to the socket (longer for slow clients). So the slot returns after the last
 * chunk is handed over, or when the receiver leaves and the stream is cancelled.
 *
 * Cancellation alone is not trusted, so the request `signal` is a second return path. Server
 * adapters are supposed to cancel the stream when the receiver leaves, but if the client drops
 * while the store is being read, the adapter receives the body on an already-closed socket whose
 * `close` has passed and whose write waits for a `drain` that never comes: no end, no cancel, and
 * the slot never returns. Thirteen requests for a 10 MiB track that disconnect immediately would
 * make all media 503 until restart. The signal aborts when the connection ends first.
 */
export function releasingBody(
	bytes: Uint8Array,
	release: () => void,
	options: {
		signal?: AbortSignal;
		chunkBytes?: number;
		/**
		 * What ends a stalled response: the route passes `destroyResponse(c)`. Called once, after
		 * `stallMs` without a pull; the slot is returned either way.
		 */
		onStall?: () => void;
		stallMs?: number;
	} = {},
): ReadableStream<Uint8Array> {
	const {
		signal,
		chunkBytes = 256 * 1024,
		onStall,
		stallMs = BODY_STALL_MS,
	} = options;
	let stall: ReturnType<typeof setTimeout> | null = null;
	/** Only the first of end, cancel, abort and stall releases; the four really do overlap. */
	let returned = false;
	const giveBack = () => {
		if (returned) return;
		returned = true;
		if (stall !== null) clearTimeout(stall);
		signal?.removeEventListener("abort", giveBack);
		release();
	};
	/**
	 * A reader that stops reading. The server honours backpressure and has no response timeout, so a
	 * client that keeps its TCP window at zero never ends, never cancels and never disconnects: the slot
	 * stayed held for as long as the client liked, and thirteen such requests for a 10 MiB track pinned
	 * the whole gate (every avatar, cover and sound in the process answered 503). Pulls are the
	 * evidence of progress, so `stallMs` without one ends the response: a slow client on a bad network
	 * still pulls a chunk every few seconds, and only a client that has stopped does not.
	 */
	const armStall = () => {
		if (stall !== null) clearTimeout(stall);
		stall = setTimeout(() => {
			stall = null;
			if (returned) return;
			giveBack();
			onStall?.();
		}, stallMs);
	};
	if (signal?.aborted) giveBack();
	else signal?.addEventListener("abort", giveBack, { once: true });
	let offset = 0;
	return new ReadableStream<Uint8Array>({
		start() {
			if (!returned) armStall();
		},
		pull(controller) {
			if (offset >= bytes.byteLength) {
				controller.close();
				giveBack();
				return;
			}
			const end = Math.min(bytes.byteLength, offset + chunkBytes);
			controller.enqueue(bytes.subarray(offset, end));
			offset = end;
			armStall();
		},
		cancel() {
			giveBack();
		},
	});
}

/** How long a response may go without its reader taking the next chunk (`releasingBody`). */
export const BODY_STALL_MS = 30_000;

const MiB = 1024 * 1024;

/**
 * The numbers for managed media delivery, in one place.
 *
 * - 128 MiB: the largest stored media is one audio track (`RUNTIME_AUDIO_LIMITS.maxBytes`, 10
 *   MiB), so a dozen whole tracks fit at once, and image lists (tens of KB x tens) never reach it.
 *   Range requests count only their slice, so a playing track usually costs far less.
 * - Queue 256, 5 s: generous enough that normal requests on a screen change are not refused, but
 *   the queue cannot hold memory and sockets indefinitely.
 */
export const MEDIA_DELIVERY_LIMITS: ByteGateLimits = {
	capacityBytes: 128 * MiB,
	maxQueued: 256,
	maxWaitMs: 5_000,
};
