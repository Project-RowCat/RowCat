import { describe, expect, test } from "vitest";
import { createSlotGate, SlotUnavailableError } from "./slots.ts";

/**
 * Process slots: the ceiling on concurrently buffered remote fetches.
 *
 * As a memory ceiling, "refuse on overflow" is not enough: when a normal scene change brings many
 * images at once, those requests must wait briefly rather than be refused, a waiting request that
 * leaves must drop out of the queue, and a finished request must always return its slot.
 */

const gate = (over: Partial<Parameters<typeof createSlotGate>[0]> = {}) =>
	createSlotGate({ maxInFlight: 2, maxQueued: 2, maxWaitMs: 200, ...over });

const reasonOf = async (pending: Promise<unknown>) => {
	try {
		await pending;
	} catch (error) {
		if (error instanceof SlotUnavailableError) return error.reason;
		throw error;
	}
	return "granted";
};

describe("slots", () => {
	test("hands out immediately up to the cap", async () => {
		const slots = gate();
		await slots.acquire();
		await slots.acquire();
		expect(slots.stats()).toEqual({ inFlight: 2, queued: 0 });
	});

	test("over it, waits, and takes the slot when one finishes", async () => {
		const slots = gate();
		const first = await slots.acquire();
		await slots.acquire();
		const third = slots.acquire();
		expect(slots.stats()).toEqual({ inFlight: 2, queued: 1 });
		first();
		await expect(third).resolves.toBeTypeOf("function");
		expect(slots.stats()).toEqual({ inFlight: 2, queued: 0 });
	});

	test("rejects immediately when the queue is full", async () => {
		const slots = gate({ maxQueued: 1 });
		await slots.acquire();
		await slots.acquire();
		void slots.acquire().catch(() => {});
		expect(await reasonOf(slots.acquire())).toBe("queue-full");
	});

	test("waiting has a deadline too", async () => {
		const slots = gate({ maxWaitMs: 30 });
		await slots.acquire();
		await slots.acquire();
		expect(await reasonOf(slots.acquire())).toBe("wait-timeout");
		expect(slots.stats().queued).toBe(0);
	});

	/** Cancellation returns the slot: a departed request left in the queue would take the next slot and leak it forever. */
	test("a waiting request that leaves drops out of the queue, and the next one gets the slot", async () => {
		const slots = gate();
		const first = await slots.acquire();
		await slots.acquire();
		const leaving = new AbortController();
		const gone = slots.acquire(leaving.signal);
		const next = slots.acquire();
		leaving.abort();
		expect(await reasonOf(gone)).toBe("cancelled");
		first();
		await expect(next).resolves.toBeTypeOf("function");
		expect(slots.stats()).toEqual({ inFlight: 2, queued: 0 });
	});

	test("a request that already left does not even queue", async () => {
		const slots = gate();
		const gone = new AbortController();
		gone.abort();
		expect(await reasonOf(slots.acquire(gone.signal))).toBe("cancelled");
		expect(slots.stats()).toEqual({ inFlight: 0, queued: 0 });
	});

	/** `finally` and cancellation can overlap; returning twice would silently raise the cap. */
	test("giving back takes effect only once", async () => {
		const slots = gate();
		const release = await slots.acquire();
		release();
		release();
		expect(slots.stats()).toEqual({ inFlight: 0, queued: 0 });
		await slots.acquire();
		await slots.acquire();
		expect(slots.stats().inFlight).toBe(2);
	});
});
