import { describe, expect, it } from "vitest";
import type { NativeRuntimeFromVm } from "./protocol.ts";
import { createNativeRuntimeSession } from "./session.ts";
import { stopNativeSession } from "./session-stop.ts";
import { createNativeRuntimeTransport } from "./transport.ts";

/** Sets up only the session, without a bridge. Same as the harness in `session.test.ts`. */
function harness() {
	const transport = createNativeRuntimeTransport("android-webmessage");
	const sent: string[] = [];
	transport.open((json) => sent.push(json));
	transport.receive(JSON.stringify({ type: "ready" }));
	const session = createNativeRuntimeSession({
		transport,
		generationSeed: 0,
	});
	const from = (message: NativeRuntimeFromVm): void =>
		transport.receive(JSON.stringify(message));
	return { transport, session, from, sent };
}

/** A delay port that does not finish until released. The value, not time, sets the limit. */
function grace() {
	let release: (() => void) | null = null;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { delay: () => promise, release: () => release?.() };
}

const drain = async (): Promise<void> => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("waits for the stop", () => {
	it("doesn't finish before stopped arrives, and finishes after it does", async () => {
		const { session, from } = harness();
		const g = grace();
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		let done = false;
		void stopNativeSession(session, { graceMs: 1, delay: g.delay }).then(() => {
			done = true;
		});
		await drain();
		expect(session.getState().status).toBe("stopping");
		expect(done).toBe(false);
		from({ type: "stopped", generation: 1, cleanups: 0 });
		await drain();
		expect(done).toBe(true);
		expect(session.getState().status).toBe("idle");
	});

	it("finishes right away if the session died", async () => {
		const { session, from } = harness();
		session.start(null);
		from({
			type: "failed",
			generation: 1,
			failure: {
				stage: "runtime",
				error: {
					kind: "host",
					name: "E",
					message: "boom",
					code: null,
					componentStack: [],
				},
			},
		});
		await stopNativeSession(session, { graceMs: 1, delay: grace().delay });
		expect(session.getState().status).toBe("idle");
	});

	it("finishes right away if nothing was stood up", async () => {
		const { session } = harness();
		await stopNativeSession(session, { graceMs: 1, delay: grace().delay });
		expect(session.getState().status).toBe("idle");
	});

	/** The screen was left and the bridge closed. No answer can come, so there is nothing to wait for. */
	it("doesn't wait if the bridge closed", async () => {
		const { session, from } = harness();
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		session.dispose();
		await stopNativeSession(session, { graceMs: 1, delay: grace().delay });
	});

	it("without an answer the cap ends it", async () => {
		const { session, from } = harness();
		const g = grace();
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		let done = false;
		void stopNativeSession(session, { graceMs: 1, delay: g.delay }).then(() => {
			done = true;
		});
		await drain();
		expect(done).toBe(false);
		g.release();
		await drain();
		expect(done).toBe(true);
	});
});
