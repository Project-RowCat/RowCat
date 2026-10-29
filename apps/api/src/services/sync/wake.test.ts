import { SYNC_WAKE_EVENT } from "@rowcat/contracts";
import { describe, expect, test } from "vitest";
import {
	createSyncWakeBroker,
	MAX_SUBSCRIBERS_PER_OWNER,
	openSyncWakeStream,
	SYNC_WAKE_HEADERS,
} from "./wake.ts";

/**
 * Wake broker and SSE stream, the part that runs without a database: owner isolation, the
 * subscribe/durable-read race, and cleanup (subscriptions, timers). Transaction ordering (announce
 * only after commit, never on rollback) is a property of SQL and is covered against real Postgres
 * in `routes/me/sync.test.ts`; a mock would only prove the mock.
 */

const decoder = new TextDecoder();

/** Reads one frame, or `null` if none arrives (short cap so tests do not hang). */
async function readFrame(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	timeoutMs = 1_000,
): Promise<string | null> {
	const timeout = new Promise<null>((resolve) =>
		setTimeout(() => resolve(null), timeoutMs),
	);
	const next = reader
		.read()
		.then(({ done, value }) => (done || !value ? null : decoder.decode(value)));
	return Promise.race([next, timeout]);
}

const cursorOf = (frame: string | null): number | null => {
	if (!frame) return null;
	const match = /^data: (.*)$/m.exec(frame);
	if (!match) return null;
	return (JSON.parse(match[1]) as { cursor: number }).cursor;
};

describe("broker", () => {
	test("split by owner — Alice's commit doesn't reach Bob", () => {
		const broker = createSyncWakeBroker();
		const alice: number[] = [];
		const bob: number[] = [];
		broker.subscribe("alice", (cursor) => alice.push(cursor));
		broker.subscribe("bob", (cursor) => bob.push(cursor));

		broker.publish("alice", 11);
		broker.publish("bob", 4);

		expect(alice).toEqual([11]);
		expect(bob).toEqual([4]);
	});

	test("over the per-member cap, the oldest subscription is pushed out and closed", () => {
		const broker = createSyncWakeBroker();
		const evicted: number[] = [];
		for (let index = 0; index < MAX_SUBSCRIBERS_PER_OWNER + 2; index++)
			broker.subscribe(
				"alice",
				() => {},
				() => evicted.push(index),
			);
		expect(broker.subscriberCount("alice")).toBe(MAX_SUBSCRIBERS_PER_OWNER);
		expect(evicted).toEqual([0, 1]);
		// Other members' books are untouched.
		expect(broker.subscriberCount("bob")).toBe(0);
	});

	test("several devices of the same owner all receive it", () => {
		const broker = createSyncWakeBroker();
		const seen: string[] = [];
		broker.subscribe("alice", () => seen.push("phone"));
		broker.subscribe("alice", () => seen.push("laptop"));
		broker.publish("alice", 7);
		expect(seen).toEqual(["phone", "laptop"]);
	});

	test("unsubscribing stops delivery and the ledger returns to 0", () => {
		const broker = createSyncWakeBroker();
		const seen: number[] = [];
		const release = broker.subscribe("alice", (cursor) => seen.push(cursor));
		expect(broker.subscriberCount("alice")).toBe(1);

		release();
		// Unsubscribe is idempotent; abort and cancel both running is a normal path.
		release();
		broker.publish("alice", 12);

		expect(seen).toEqual([]);
		expect(broker.subscriberCount("alice")).toBe(0);
		expect(broker.subscriberCount()).toBe(0);
	});

	// If publish threw, an already-committed push would be reported as failed.
	test("one listener throwing doesn't block another device's notification", () => {
		const broker = createSyncWakeBroker();
		const seen: number[] = [];
		broker.subscribe("alice", () => {
			throw new Error("dead stream");
		});
		broker.subscribe("alice", (cursor) => seen.push(cursor));

		expect(() => broker.publish("alice", 9)).not.toThrow();
		expect(seen).toEqual([9]);
	});

	test("a listener unsubscribing itself during iteration is safe", () => {
		const broker = createSyncWakeBroker();
		const seen: number[] = [];
		const release = broker.subscribe("alice", (cursor) => {
			seen.push(cursor);
			release();
		});
		broker.subscribe("alice", (cursor) => seen.push(cursor + 100));

		broker.publish("alice", 1);
		broker.publish("alice", 2);

		expect(seen).toEqual([1, 101, 102]);
	});
});

describe("stream", () => {
	test("the initial frame carries the durable cursor as is", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		const stream = await openSyncWakeStream({
			owner: "alice",
			signal: abort.signal,
			broker,
			readCursor: async () => 42,
		});
		const reader = stream.getReader();

		const frame = await readFrame(reader);
		expect(frame).toBe(`event: ${SYNC_WAKE_EVENT}\ndata: {"cursor":42}\n\n`);
		abort.abort();
	});

	/**
	 * Opens the race window for real: another device commits while the durable read runs. A naive
	 * read-then-subscribe would lose this publish and the client would know only 10; subscribing first
	 * catches 11 and the cursors merge to the larger.
	 */
	test("doesn't lose commits between subscribing and the durable read", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		const stream = await openSyncWakeStream({
			owner: "alice",
			signal: abort.signal,
			broker,
			readCursor: async () => {
				// Another device committed during the read.
				broker.publish("alice", 11);
				return 10;
			},
		});
		const reader = stream.getReader();

		expect(cursorOf(await readFrame(reader))).toBe(11);
		abort.abort();
	});

	test("commits after connecting come as frames", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		const stream = await openSyncWakeStream({
			owner: "alice",
			signal: abort.signal,
			broker,
			readCursor: async () => 3,
		});
		const reader = stream.getReader();

		expect(cursorOf(await readFrame(reader))).toBe(3);
		broker.publish("alice", 4);
		expect(cursorOf(await readFrame(reader))).toBe(4);
		abort.abort();
	});

	// A slow subscriber needs only the latest cursor (the pull fetches everything after its own);
	// avoiding an unbounded queue is the backpressure answer.
	test("backlogged cursors merge into the largest one", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		const stream = await openSyncWakeStream({
			owner: "alice",
			signal: abort.signal,
			broker,
			readCursor: async () => 100,
		});
		const reader = stream.getReader();
		expect(cursorOf(await readFrame(reader))).toBe(100);

		// Four commits landed while nothing was reading.
		broker.publish("alice", 101);
		broker.publish("alice", 102);
		broker.publish("alice", 103);
		broker.publish("alice", 104);

		expect(cursorOf(await readFrame(reader))).toBe(104);
		// No intermediate cursors remain; the next frame is a heartbeat.
		abort.abort();
	});

	test("ignores cursors that go backwards", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		const stream = await openSyncWakeStream({
			owner: "alice",
			signal: abort.signal,
			broker,
			readCursor: async () => 50,
			heartbeatMs: 20,
		});
		const reader = stream.getReader();
		expect(cursorOf(await readFrame(reader))).toBe(50);

		broker.publish("alice", 49);
		// 49 does not become a frame; a heartbeat comes next.
		expect(await readFrame(reader)).toBe(": ping\n\n");
		abort.abort();
	});

	/**
	 * The session was checked only at open, so a stream outlived a revoke, a password reset or account
	 * deletion. It is asked again at each heartbeat now.
	 */
	test("ends at the next heartbeat once the session no longer stands", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		let signedIn = true;
		const stream = await openSyncWakeStream({
			owner: "alice",
			signal: abort.signal,
			broker,
			readCursor: async () => 0,
			heartbeatMs: 10,
			stillSignedIn: async () => signedIn,
		});
		const reader = stream.getReader();
		await readFrame(reader);
		expect(await readFrame(reader)).toBe(": ping\n\n");

		signedIn = false;
		expect((await reader.read()).done).toBe(true);
		expect(broker.subscriberCount("alice")).toBe(0);
	});

	test("a failed session check keeps the stream: our outage is not the session ending", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		const stream = await openSyncWakeStream({
			owner: "alice",
			signal: abort.signal,
			broker,
			readCursor: async () => 0,
			heartbeatMs: 10,
			stillSignedIn: async () => {
				throw new Error("db down");
			},
		});
		const reader = stream.getReader();
		await readFrame(reader);
		expect(await readFrame(reader)).toBe(": ping\n\n");
		abort.abort();
	});

	test("a stream ends after its lifetime, and the client reconnects", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		const stream = await openSyncWakeStream({
			owner: "alice",
			signal: abort.signal,
			broker,
			readCursor: async () => 0,
			heartbeatMs: 1_000,
			maxLifetimeMs: 20,
		});
		const reader = stream.getReader();
		await readFrame(reader);
		expect((await reader.read()).done).toBe(true);
		expect(broker.subscriberCount("alice")).toBe(0);
	});

	test("the heartbeat is a comment, not an event", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		const stream = await openSyncWakeStream({
			owner: "alice",
			signal: abort.signal,
			broker,
			readCursor: async () => 0,
			heartbeatMs: 10,
		});
		const reader = stream.getReader();
		await readFrame(reader);

		const beat = await readFrame(reader);
		expect(beat).toBe(": ping\n\n");
		// Must be a shape client parsers drop: no `data:` or `event:`.
		expect(beat).not.toContain("data:");
		abort.abort();
	});

	test("when the connection drops the subscription goes — no dead listeners remain", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		await openSyncWakeStream({
			owner: "alice",
			signal: abort.signal,
			broker,
			readCursor: async () => 0,
		});
		expect(broker.subscriberCount("alice")).toBe(1);

		abort.abort();
		expect(broker.subscriberCount("alice")).toBe(0);
	});

	test("connecting and disconnecting repeatedly doesn't leak the ledger", async () => {
		const broker = createSyncWakeBroker();
		for (let i = 0; i < 20; i++) {
			const abort = new AbortController();
			await openSyncWakeStream({
				owner: "alice",
				signal: abort.signal,
				broker,
				readCursor: async () => i,
			});
			abort.abort();
		}
		expect(broker.subscriberCount()).toBe(0);
	});

	test("opening with an already-aborted signal closes immediately", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		abort.abort();
		const stream = await openSyncWakeStream({
			owner: "alice",
			signal: abort.signal,
			broker,
			readCursor: async () => 5,
		});
		const reader = stream.getReader();

		expect(await readFrame(reader)).toBe(null);
		expect(broker.subscriberCount()).toBe(0);
	});

	// A failed durable read must not open the stream; 200 followed by an empty stream would look like
	// "connected but nothing arrives".
	test("a durable read failure throws before opening the stream and leaves no subscription", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		await expect(
			openSyncWakeStream({
				owner: "alice",
				signal: abort.signal,
				broker,
				readCursor: async () => {
					throw new Error("db down");
				},
			}),
		).rejects.toThrow("db down");
		expect(broker.subscriberCount()).toBe(0);
	});

	test("cancelling the stream also cleans up the subscription", async () => {
		const broker = createSyncWakeBroker();
		const abort = new AbortController();
		const stream = await openSyncWakeStream({
			owner: "alice",
			signal: abort.signal,
			broker,
			readCursor: async () => 1,
		});
		await stream.cancel();
		expect(broker.subscriberCount()).toBe(0);
	});
});

describe("response headers", () => {
	test("SSE, not cached, not buffered by proxies", () => {
		expect(SYNC_WAKE_HEADERS["Content-Type"]).toBe(
			"text/event-stream; charset=utf-8",
		);
		expect(SYNC_WAKE_HEADERS["Cache-Control"]).toContain("no-store");
		expect(SYNC_WAKE_HEADERS["X-Accel-Buffering"]).toBe("no");
	});
});
