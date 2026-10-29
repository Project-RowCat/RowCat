/**
 * Slots for remote fetches one process holds at once: the memory ceiling.
 *
 * Responses are buffered whole before the format is judged (magic bytes in `fetch.ts`), so the
 * number of concurrent fetches is the ceiling on bytes the process holds. The per-member byte
 * budget (`budget.ts`) limits one person's share but not memory when many members arrive at once;
 * that axis is here.
 *
 * ## No immediate refusal
 *
 * With no free slot a request waits briefly. A scene change requesting dozens of images at once is
 * normal, and refusing would drop those images to placeholders (`<img>` does not retry). The wait
 * has two caps, queue length and time; beyond either it is refused, with the proxy's single failure
 * code.
 *
 * ## Cancellation gives the slot back
 *
 * A waiting request whose signal fires leaves the queue. A request that got a slot must always
 * return it (`release` is idempotent because `finally` and cancellation can overlap).
 */

export type SlotRefusal = "queue-full" | "wait-timeout" | "cancelled";

export class SlotUnavailableError extends Error {
	readonly reason: SlotRefusal;
	constructor(reason: SlotRefusal) {
		super(`remote image slot unavailable: ${reason}`);
		this.name = "SlotUnavailableError";
		this.reason = reason;
	}
}

export interface SlotGate {
	/** Acquires one slot and returns its release function; throws `SlotUnavailableError` if it cannot. */
	acquire(signal?: AbortSignal): Promise<() => void>;
	/** Slots held and waiters, for tests and diagnostics. */
	stats(): { inFlight: number; queued: number };
}

export function createSlotGate(limits: {
	maxInFlight: number;
	maxQueued: number;
	maxWaitMs: number;
}): SlotGate {
	let inFlight = 0;
	const waiting: Array<() => void> = [];

	const grant = (): (() => void) => {
		inFlight += 1;
		let returned = false;
		return () => {
			if (returned) return;
			returned = true;
			inFlight -= 1;
			waiting.shift()?.();
		};
	};

	return {
		acquire(signal) {
			if (signal?.aborted)
				return Promise.reject(new SlotUnavailableError("cancelled"));
			if (inFlight < limits.maxInFlight) return Promise.resolve(grant());
			if (waiting.length >= limits.maxQueued)
				return Promise.reject(new SlotUnavailableError("queue-full"));

			return new Promise((resolve, reject) => {
				const leave = () => {
					const at = waiting.indexOf(wake);
					if (at !== -1) waiting.splice(at, 1);
					clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
				};
				const wake = () => {
					leave();
					resolve(grant());
				};
				const onAbort = () => {
					leave();
					reject(new SlotUnavailableError("cancelled"));
				};
				const timer = setTimeout(() => {
					leave();
					reject(new SlotUnavailableError("wait-timeout"));
				}, limits.maxWaitMs);
				signal?.addEventListener("abort", onAbort, { once: true });
				waiting.push(wake);
			});
		},
		stats: () => ({ inFlight, queued: waiting.length }),
	};
}
