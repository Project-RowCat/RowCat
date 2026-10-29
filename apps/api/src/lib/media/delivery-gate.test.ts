import { describe, expect, it } from "vitest";
import {
	ByteGateUnavailableError,
	createByteGate,
	MEDIA_DELIVERY_LIMITS,
	releasingBody,
} from "./delivery-gate.ts";

/**
 * Caps buffered bytes for managed media delivery. Failure here shows up as either the process
 * falling over on memory (limit leaks) or audio sometimes not playing (large requests starve).
 */

const gate = (over: Partial<Parameters<typeof createByteGate>[0]> = {}) =>
	createByteGate({
		capacityBytes: 100,
		maxQueued: 4,
		maxWaitMs: 200,
		...over,
	});

const reason = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ByteGateUnavailableError) return error.reason;
		throw error;
	}
	return "granted";
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createByteGate — the weight is bytes", () => {
	it("within the cap, several come in together", async () => {
		const g = gate();
		const a = await g.acquire(40);
		const b = await g.acquire(60);
		expect(g.stats()).toEqual({ inFlightBytes: 100, inFlight: 2, queued: 0 });
		a();
		b();
		expect(g.stats()).toEqual({ inFlightBytes: 0, inFlight: 0, queued: 0 });
	});

	it("over it, waits, and comes in when room frees up", async () => {
		const g = gate();
		const a = await g.acquire(80);
		let granted = false;
		const pending = g.acquire(30).then((release) => {
			granted = true;
			return release;
		});
		await tick();
		expect(granted).toBe(false);
		expect(g.stats().queued).toBe(1);
		a();
		(await pending)();
		expect(granted).toBe(true);
		expect(g.stats()).toEqual({ inFlightBytes: 0, inFlight: 0, queued: 0 });
	});

	/** If small requests overtake, free space stays small and a large track never gets in. */
	it("the queue is FIFO — a small request behind a large one does not overtake it", async () => {
		const g = gate();
		const first = await g.acquire(60);
		const order: string[] = [];
		const big = g.acquire(80).then((r) => {
			order.push("big");
			return r;
		});
		const small = g.acquire(10).then((r) => {
			order.push("small");
			return r;
		});
		await tick();
		/** 10 would fit right now but a larger request is ahead of it, so it waits. */
		expect(order).toEqual([]);
		first();
		(await big)();
		(await small)();
		expect(order).toEqual(["big", "small"]);
	});

	/** Refusing an over-capacity response forever would make that media unreadable here. */
	it("a response larger than the cap comes in alone", async () => {
		const g = gate();
		const huge = await g.acquire(10_000);
		expect(g.stats().inFlightBytes).toBe(100);
		expect(await reason(g.acquire(1, AbortSignal.timeout(20)))).toBe(
			"cancelled",
		);
		huge();
		(await g.acquire(10_000))();
	});

	it("an empty resource still counts one slot", async () => {
		const g = gate();
		const r = await g.acquire(0);
		expect(g.stats()).toEqual({ inFlightBytes: 1, inFlight: 1, queued: 0 });
		r();
	});

	it("rejects at once when the queue is full", async () => {
		const g = gate({ maxQueued: 1 });
		const a = await g.acquire(100);
		const queued = g.acquire(1);
		expect(await reason(g.acquire(1))).toBe("queue-full");
		a();
		(await queued)();
	});

	it("waiting has a deadline too", async () => {
		const g = gate({ maxWaitMs: 20 });
		const a = await g.acquire(100);
		expect(await reason(g.acquire(1))).toBe("wait-timeout");
		expect(g.stats().queued).toBe(0);
		a();
	});

	/** If the head leaves and the rest keep waiting, the queue stalls in front of free space. */
	it("when the front leaves, the next comes in", async () => {
		const g = gate();
		const a = await g.acquire(60);
		const leaving = new AbortController();
		const big = g.acquire(80, leaving.signal);
		const small = g.acquire(30);
		await tick();
		leaving.abort();
		expect(await reason(big)).toBe("cancelled");
		(await small)();
		a();
		expect(g.stats()).toEqual({ inFlightBytes: 0, inFlight: 0, queued: 0 });
	});

	it("giving back twice counts once", async () => {
		const g = gate();
		const r = await g.acquire(50);
		r();
		r();
		expect(g.stats().inFlightBytes).toBe(0);
	});
});

describe("releasingBody — the slot returns after every byte has gone out", () => {
	const read = async (stream: ReadableStream<Uint8Array>) => {
		const chunks: Uint8Array[] = [];
		const reader = stream.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
		}
		return Buffer.concat(chunks);
	};

	it("gives back only after reading to the end — the bytes are unchanged", async () => {
		let released = 0;
		const bytes = Buffer.from(Array.from({ length: 10 }, (_, i) => i));
		const stream = releasingBody(bytes, () => (released += 1), {
			chunkBytes: 3,
		});
		const reader = stream.getReader();
		await reader.read();
		expect(released).toBe(0);
		reader.releaseLock();
		expect(await read(stream)).toEqual(bytes.subarray(3));
		expect(released).toBe(1);
	});

	it("gives back when the receiver leaves", async () => {
		let released = 0;
		const stream = releasingBody(Buffer.alloc(10), () => (released += 1), {
			chunkBytes: 3,
		});
		const reader = stream.getReader();
		await reader.read();
		await reader.cancel();
		expect(released).toBe(1);
	});

	/**
	 * When an adapter hands the body to a closed socket neither end nor cancel arrives; only the
	 * request `signal` can release, and it must work with the stream never read.
	 */
	it("gives back when the request aborts, even unread — only once", async () => {
		let released = 0;
		const controller = new AbortController();
		const stream = releasingBody(Buffer.alloc(10), () => (released += 1), {
			signal: controller.signal,
			chunkBytes: 3,
		});
		expect(released).toBe(0);
		controller.abort();
		expect(released).toBe(1);
		await stream.cancel();
		expect(released).toBe(1);
	});

	/**
	 * A reader that stops reading (a zero TCP window) never ends, cancels or disconnects. The stream
	 * stops being pulled, and that silence is what ends it: the slot returns and the route destroys the
	 * response.
	 */
	it("gives back and asks to end the response when the reader stops pulling", async () => {
		let released = 0;
		let stalled = 0;
		const stream = releasingBody(Buffer.alloc(10), () => (released += 1), {
			chunkBytes: 3,
			stallMs: 20,
			onStall: () => (stalled += 1),
		});
		const reader = stream.getReader();
		await reader.read();
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(released).toBe(1);
		expect(stalled).toBe(1);
		await reader.cancel();
		expect(released).toBe(1);
	});

	it("a reader that keeps pulling is never cut, however slow its pace overall", async () => {
		let stalled = 0;
		const stream = releasingBody(Buffer.alloc(12), () => {}, {
			chunkBytes: 3,
			stallMs: 40,
			onStall: () => (stalled += 1),
		});
		const reader = stream.getReader();
		for (let i = 0; i < 4; i += 1) {
			await reader.read();
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(stalled).toBe(0);
		await reader.cancel();
	});

	it("gives back right away for an already-aborted request", () => {
		let released = 0;
		const controller = new AbortController();
		controller.abort();
		releasingBody(Buffer.alloc(10), () => (released += 1), {
			signal: controller.signal,
		});
		expect(released).toBe(1);
	});
});

describe("MEDIA_DELIVERY_LIMITS", () => {
	it("several of the largest stored media (10 MiB sounds) go in together", () => {
		expect(MEDIA_DELIVERY_LIMITS.capacityBytes).toBeGreaterThanOrEqual(
			8 * 10 * 1024 * 1024,
		);
	});
});
