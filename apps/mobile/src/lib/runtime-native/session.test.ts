import { ROOT_HOST_NODE_ID } from "@rowcat/runtime-host/patches";
import { describe, expect, it } from "vitest";
import type { NativeRuntimeFromVm } from "./protocol.ts";
import { createNativeRuntimeSession } from "./session.ts";
import { createNativeRuntimeTransport } from "./transport.ts";

/** Sets up only the session without a bridge: sent messages are collected in an array, and incoming ones are injected by hand. */
function harness(clock = { now: 0 }) {
	const transport = createNativeRuntimeTransport("android-webmessage");
	const sent: string[] = [];
	transport.open((json) => sent.push(json));
	transport.receive(JSON.stringify({ type: "ready" }));
	const session = createNativeRuntimeSession({
		transport,
		now: () => clock.now,
		/** The tests read 1, 2, 3. Production's seed is the clock (`session.ts`). */
		generationSeed: 0,
	});
	const from = (message: NativeRuntimeFromVm): void =>
		transport.receive(JSON.stringify(message));
	/** The greeting is wiring of the transport layer, not a conversation of the session. */
	const outgoing = (): { type: string }[] =>
		sent
			.map((json) => JSON.parse(json) as { type: string })
			.filter((message) => message.type !== "hello");
	return { transport, session, from, outgoing, clock };
}

const counterCommit = (generation: number, revision: number) =>
	({
		type: "commit",
		generation,
		batch: {
			revision,
			patches:
				revision === 1
					? [
							{ op: "create", id: 1, kind: "text" },
							{ op: "create", id: 2, kind: "#text" },
							{ op: "set-text", id: 2, value: "Count: 0" },
							{ op: "insert", parent: 1, child: 2, index: 0 },
							{ op: "insert", parent: ROOT_HOST_NODE_ID, child: 1, index: 0 },
						]
					: [{ op: "set-text", id: 2, value: `Count: ${revision - 1}` }],
		},
	}) as NativeRuntimeFromVm;

describe("lifecycle", () => {
	it("start empties the tree and sends the artifact", () => {
		const { session, outgoing } = harness();
		session.start({ entry: "src/main.tsx" });
		expect(outgoing()).toEqual([
			{ type: "start", generation: 1, artifact: { entry: "src/main.tsx" } },
		]);
		expect(session.getState()).toMatchObject({
			status: "starting",
			generation: 1,
		});
	});

	it("commits apply to the tree and the revision advances", () => {
		const { session, from } = harness();
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		from(counterCommit(1, 1));
		expect(session.store.revision).toBe(1);
		expect(session.store.node(2)?.text).toBe("Count: 0");
		expect(session.getState()).toMatchObject({
			status: "running",
			revision: 1,
		});
	});

	it("restarting resets the id space from the beginning", () => {
		const { session, from } = harness();
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		from(counterCommit(1, 1));
		session.start(null);
		expect(session.store.revision).toBe(0);
		expect(session.store.ids()).toEqual([]);
		from({ type: "started", generation: 2, remoteAssets: [] });
		from(counterCommit(2, 1));
		expect(session.store.node(2)?.text).toBe("Count: 0");
	});
});

describe("generation", () => {
	/**
	 * Even when the coordinator is re-created, the number must not go back to one used earlier. The
	 * session inside the WebView keeps living, and if the last batch it emits while being replaced is
	 * applied to the new tree, the renderer halts on a revision mismatch.
	 */
	it("the seed is the clock so rebuilding doesn't overlap", () => {
		const first = createNativeRuntimeSession({
			transport: createNativeRuntimeTransport("ios-webview"),
		});
		const second = createNativeRuntimeSession({
			transport: createNativeRuntimeTransport("ios-webview"),
		});
		first.start(null);
		second.start(null);
		const a = first.getState();
		const b = second.getState();
		expect(a.status).toBe("starting");
		expect(b.status).toBe("starting");
		expect(a.status === "starting" && a.generation).toBeGreaterThan(1);
		expect(a.status === "starting" && b.status === "starting").toBe(true);
	});

	it("an old session's commit doesn't reach the tree", () => {
		const { session, from } = harness();
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		from(counterCommit(1, 1));
		session.start(null);
		/** A's late commit reaches B's empty tree. It is not applied even though the revision matches. */
		from(counterCommit(1, 2));
		expect(session.store.revision).toBe(0);
		expect(session.store.failed).toBe(false);
	});
});

describe("renderer failure", () => {
	it("a skipped revision stops the session and sends stop", () => {
		const { session, from, outgoing } = harness();
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		from(counterCommit(1, 1));
		from(counterCommit(1, 5));
		expect(session.store.failed).toBe(true);
		expect(session.getState()).toMatchObject({
			status: "failed",
			failure: { stage: "renderer" },
		});
		expect(outgoing().at(-1)).toEqual({ type: "stop", generation: 1 });
	});

	it("a failed bundle doesn't change the tree by a cell", () => {
		const { session, from } = harness();
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		from(counterCommit(1, 1));
		from({
			type: "commit",
			generation: 1,
			batch: {
				revision: 2,
				patches: [
					{ op: "set-text", id: 2, value: "Count: 1" },
					{ op: "set-text", id: 99, value: "boom" },
				],
			},
		});
		expect(session.store.revision).toBe(1);
		expect(session.store.node(2)?.text).toBe("Count: 0");
	});
});

describe("events", () => {
	it("go out only from a running session and carry only one number", () => {
		const { session, from, outgoing } = harness();
		session.dispatchEvent(41);
		expect(outgoing()).toEqual([]);
		session.start(null);
		session.dispatchEvent(41);
		/** Not `started` yet, so the press is not sent. */
		expect(outgoing()).toHaveLength(1);
		from({ type: "started", generation: 1, remoteAssets: [] });
		session.dispatchEvent(41);
		expect(outgoing().at(-1)).toEqual({
			type: "event",
			generation: 1,
			handlerId: 41,
		});
	});

	it("latency is between the event and the application of its commit", () => {
		const clock = { now: 0 };
		const { session, from } = harness(clock);
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		from(counterCommit(1, 1));
		/** The first commit belongs to no event. */
		expect(session.latency()).toBeNull();

		clock.now = 1000;
		session.dispatchEvent(41);
		clock.now = 1012;
		from(counterCommit(1, 2));
		expect(session.latency()).toMatchObject({ samples: 1, medianMs: 12 });
	});

	it("when the event throws, that sample is discarded", () => {
		const clock = { now: 0 };
		const { session, from } = harness(clock);
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		from(counterCommit(1, 1));
		clock.now = 100;
		session.dispatchEvent(41);
		from({
			type: "root-error",
			generation: 1,
			error: {
				kind: "creator",
				name: "TypeError",
				message: "boom",
				code: null,
				componentStack: ["App"],
			},
			work: "event",
		});
		clock.now = 500;
		from(counterCommit(1, 2));
		expect(session.latency()).toBeNull();
	});
});

describe("the bridge died", () => {
	it("the session stops and presses don't go out", () => {
		const { session, transport, from, outgoing } = harness();
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		from(counterCommit(1, 1));
		const before = outgoing().length;
		transport.fail("render_process_crashed");
		session.dispatchEvent(41);
		expect(outgoing()).toHaveLength(before);
		expect(session.getState()).toMatchObject({
			status: "failed",
			failure: { stage: "transport", message: "render_process_crashed" },
		});
		/** The tree remains: the last drawn screen stays as it was. */
		expect(session.store.node(2)?.text).toBe("Count: 0");
	});
});

describe("console", () => {
	it("holds only this generation's lines and restarting empties it", () => {
		const { session, from } = harness();
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		from({ type: "console", generation: 1, level: "log", args: ["hi"] });
		from({ type: "console", generation: 2, level: "log", args: ["ghost"] });
		expect(session.console()).toEqual([{ level: "log", args: ["hi"] }]);
		session.start(null);
		expect(session.console()).toEqual([]);
	});
});
