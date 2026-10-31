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

describe("commit acknowledgement (backpressure)", () => {
	/**
	 * The harness waits while too many commits are unacknowledged (`commit-window.ts`). Hermes is the
	 * side that knows a batch reached the tree, so the acknowledgement goes out **after** applying.
	 */
	it("acknowledges each applied commit with its revision", () => {
		const { session, from, outgoing } = harness();
		session.start(null);
		from(counterCommit(1, 1));
		from({ type: "started", generation: 1, remoteAssets: [] });
		from(counterCommit(1, 2));
		expect(
			outgoing().filter((message) => message.type === "commit-ack"),
		).toEqual([
			{ type: "commit-ack", generation: 1, revision: 1 },
			{ type: "commit-ack", generation: 1, revision: 2 },
		]);
	});

	it("doesn't acknowledge a batch that failed or belongs to an old generation", () => {
		const { session, from, outgoing } = harness();
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		from(counterCommit(1, 1));
		session.start(null);
		from(counterCommit(1, 2));
		from(counterCommit(2, 5));
		expect(
			outgoing().filter((message) => message.type === "commit-ack"),
		).toEqual([{ type: "commit-ack", generation: 1, revision: 1 }]);
	});
});

describe("generation requests after the session began to stop", () => {
	const request = (generation: number, requestId: number) =>
		({
			type: "runtime-host-call",
			generation,
			requestId,
			request: { messages: [], instructions: "hi", maxOutputCharacters: 100 },
		}) as NativeRuntimeFromVm;

	/**
	 * A press that reached the VM just before Restart can post its request after Hermes already
	 * asked the harness to stop. The generation number is still the old one, so that check alone let
	 * a paid request start that nobody would read.
	 */
	it("a request arriving while stopping never reaches the adapter", async () => {
		const transport = createNativeRuntimeTransport("android-webmessage");
		const sent: string[] = [];
		transport.open((json) => sent.push(json));
		transport.receive(JSON.stringify({ type: "ready" }));
		let calls = 0;
		const session = createNativeRuntimeSession({
			transport,
			generationSeed: 0,
			onGenerationRequest: async () => {
				calls += 1;
				return { ok: true, text: "paid" };
			},
		});
		session.start(null);
		transport.receive(
			JSON.stringify({ type: "started", generation: 1, remoteAssets: [] }),
		);
		session.stop();
		transport.receive(JSON.stringify(request(1, 7)));
		await Promise.resolve();
		expect(calls).toBe(0);
		const answer = sent
			.map((json) => JSON.parse(json))
			.find((message) => message.type === "runtime-host-result");
		expect(answer).toMatchObject({
			generation: 1,
			requestId: 7,
			result: { ok: false, reason: "cancelled" },
		});
	});

	it("a running session still reaches the adapter", async () => {
		const transport = createNativeRuntimeTransport("android-webmessage");
		transport.open(() => {});
		transport.receive(JSON.stringify({ type: "ready" }));
		let calls = 0;
		const session = createNativeRuntimeSession({
			transport,
			generationSeed: 0,
			onGenerationRequest: async () => {
				calls += 1;
				return { ok: true, text: "ok" };
			},
		});
		session.start(null);
		transport.receive(
			JSON.stringify({ type: "started", generation: 1, remoteAssets: [] }),
		);
		transport.receive(JSON.stringify(request(1, 1)));
		expect(calls).toBe(1);
	});

	it("asking to stop twice sends one stop", () => {
		const { session, from, outgoing } = harness();
		session.start(null);
		from({ type: "started", generation: 1, remoteAssets: [] });
		session.stop();
		session.stop();
		expect(
			outgoing().filter((message) => message.type === "stop"),
		).toHaveLength(1);
	});
});

describe("liveness watchdog", () => {
	/** A timer port the test drives by hand; one interval at a time is what the session needs. */
	function timers() {
		let tick: (() => void) | null = null;
		let live = 0;
		return {
			port: {
				setInterval(callback: () => void) {
					tick = callback;
					live += 1;
					return live;
				},
				clearInterval() {
					tick = null;
				},
			},
			tick: () => tick?.(),
			get armed() {
				return tick !== null;
			},
		};
	}

	/** Ticks every 500 ms (the product interval) up to `until`: a clock that never stopped. */
	function steady(
		clock: { now: number },
		t: { tick(): void },
		until: number,
	): void {
		while (clock.now + 500 <= until) {
			clock.now += 500;
			t.tick();
		}
	}

	function watched(options: { foreground?: () => boolean } = {}) {
		const clock = { now: 0 };
		const first = createNativeRuntimeTransport("ios-webview");
		const sent: string[] = [];
		first.open((json) => sent.push(json));
		first.receive(JSON.stringify({ type: "ready" }));
		const renewed: ReturnType<typeof createNativeRuntimeTransport>[] = [];
		const t = timers();
		const session = createNativeRuntimeSession({
			transport: first,
			now: () => clock.now,
			generationSeed: 0,
			liveness: {
				...t.port,
				...(options.foreground === undefined
					? {}
					: { foreground: options.foreground }),
			},
			renewTransport: () => {
				const next = createNativeRuntimeTransport("ios-webview");
				renewed.push(next);
				return next;
			},
		});
		return { session, first, sent, renewed, clock, timers: t };
	}

	it("is not armed while nothing runs", () => {
		const { timers: t } = watched();
		expect(t.armed).toBe(false);
	});

	it("pings after silence and stays calm when the document answers", () => {
		const { session, first, sent, clock, timers: t } = watched();
		session.start(null);
		first.receive(
			JSON.stringify({ type: "started", generation: 1, remoteAssets: [] }),
		);
		expect(t.armed).toBe(true);
		clock.now = 1_500;
		t.tick();
		expect(sent.map((json) => JSON.parse(json).type)).toContain("hello");
		first.receive(JSON.stringify({ type: "ready" }));
		clock.now = 6_000;
		t.tick();
		expect(session.getState().status).toBe("running");
	});

	/**
	 * A native builtin that never reaches an interrupt poll keeps the harness thread busy far past the
	 * VM budget. Hermes drops that realm: the session fails with the budget code and the next start
	 * goes to a fresh document.
	 */
	it("a silent harness fails the session with the budget code and renews the bridge", () => {
		const { session, first, sent, renewed, clock, timers: t } = watched();
		session.start(null);
		first.receive(
			JSON.stringify({ type: "started", generation: 1, remoteAssets: [] }),
		);
		/** The first tick sees `started` and records it as the last word (at 500). */
		steady(clock, t, 4_000);
		/** Pinged and still silent, but not past the bound yet. */
		expect(sent.map((json) => JSON.parse(json).type)).toContain("hello");
		expect(session.getState().status).toBe("running");
		steady(clock, t, 5_000);
		expect(session.getState().status).toBe("running");
		steady(clock, t, 5_500);
		expect(session.getState()).toMatchObject({
			status: "failed",
			failure: {
				stage: "runtime",
				error: { kind: "host", code: "runtime_execution_budget_exceeded" },
			},
		});
		expect(first.closed).toBe(true);
		expect(renewed).toHaveLength(1);
		expect(session.transport).toBe(renewed[0]);
		expect(t.armed).toBe(false);

		/** Restart reaches the fresh document once it stands. */
		const fresh = renewed[0] as ReturnType<typeof createNativeRuntimeTransport>;
		const freshSent: string[] = [];
		fresh.open((json) => freshSent.push(json));
		fresh.receive(JSON.stringify({ type: "ready" }));
		session.stop();
		session.start(null);
		expect(freshSent.map((json) => JSON.parse(json).type)).toContain("start");
	});

	it("a dead bridge is renewed too, so restart is not a dead end", () => {
		const { session, first, renewed } = watched();
		session.start(null);
		first.fail("content_process_terminated");
		expect(session.getState()).toMatchObject({
			status: "failed",
			failure: { stage: "transport" },
		});
		expect(renewed).toHaveLength(1);
		expect(session.transport).toBe(renewed[0]);
	});

	/**
	 * On a single-process Android WebView the hung renderer is a thread of this app, so the renewed
	 * WebView never loads. Waiting for `ready` must not be forever: past `standAfterMs` of foreground,
	 * ticking time the session fails at the transport stage and mounts nothing new.
	 */
	it("a renewed document that never stands fails at the transport stage", () => {
		const { session, first, renewed, clock, timers: t } = watched();
		session.start(null);
		first.receive(
			JSON.stringify({ type: "started", generation: 1, remoteAssets: [] }),
		);
		steady(clock, t, 6_000);
		expect(session.getState().status).toBe("failed");
		expect(renewed).toHaveLength(1);
		const stuck = renewed[0] as ReturnType<typeof createNativeRuntimeTransport>;
		stuck.open(() => {});
		/** Restart on a document that never says `ready`. */
		session.stop();
		session.start(null);
		expect(session.getState().status).toBe("starting");
		expect(t.armed).toBe(true);
		steady(clock, t, 6_000 + 14_500);
		expect(session.getState().status).toBe("starting");
		steady(clock, t, 6_000 + 15_500);
		expect(session.getState()).toMatchObject({
			status: "failed",
			failure: { stage: "transport", message: "runtime_harness_unready" },
		});
		expect(stuck.closed).toBe(true);
		expect(renewed).toHaveLength(1);
		expect(t.armed).toBe(false);
	});

	it("a document still loading while the app was away is not counted against it", () => {
		let foreground = true;
		const {
			session,
			first,
			renewed,
			clock,
			timers: t,
		} = watched({
			foreground: () => foreground,
		});
		session.start(null);
		first.receive(
			JSON.stringify({ type: "started", generation: 1, remoteAssets: [] }),
		);
		steady(clock, t, 6_000);
		const slow = renewed[0] as ReturnType<typeof createNativeRuntimeTransport>;
		slow.open(() => {});
		session.stop();
		session.start(null);
		steady(clock, t, 16_000);
		foreground = false;
		steady(clock, t, 60_000);
		foreground = true;
		steady(clock, t, 70_000);
		expect(session.getState().status).toBe("starting");
		/** 15 s of foreground waiting would have passed by now had the 44 s away counted. */
		expect(slow.closed).toBe(false);
		slow.receive(JSON.stringify({ type: "ready" }));
		expect(session.getState().status).toBe("starting");
	});

	it("dispose disarms it", () => {
		const { session, first, timers: t } = watched();
		session.start(null);
		first.receive(
			JSON.stringify({ type: "started", generation: 1, remoteAssets: [] }),
		);
		session.dispose();
		expect(t.armed).toBe(false);
	});

	/**
	 * The app went to the background (or the screen locked) for 8 s: Hermes timers stopped, the
	 * WebView was suspended, and nothing was sent or answered. The first tick after resume sees 8 s of
	 * silence, but no `hello` went unanswered while the clock ran — that is a clock gap, not a hung
	 * harness. Before this rule, that tick failed a healthy session with the budget code.
	 */
	it("a gap in its own clock is not silence", () => {
		const { session, first, sent, clock, timers: t } = watched();
		session.start(null);
		first.receive(
			JSON.stringify({ type: "started", generation: 1, remoteAssets: [] }),
		);
		const hellos = () =>
			sent.filter((json) => JSON.parse(json).type === "hello").length;
		/** A harness that answers every `hello` at once, ticked every 500 ms up to `until`. */
		const answering = (until: number) => {
			while (clock.now + 500 <= until) {
				clock.now += 500;
				const before = hellos();
				t.tick();
				if (hellos() > before) first.receive(JSON.stringify({ type: "ready" }));
			}
		};
		answering(10_000);
		expect(session.getState().status).toBe("running");

		clock.now += 8_000;
		const before = hellos();
		t.tick();
		expect(session.getState().status).toBe("running");
		/** The late tick asks right away instead of concluding. */
		expect(hellos()).toBe(before + 1);
		first.receive(JSON.stringify({ type: "ready" }));
		answering(clock.now + 10_000);
		expect(session.getState().status).toBe("running");
	});

	it("after a gap, a harness that stays silent still fails once the bound passes", () => {
		const { session, first, clock, timers: t } = watched();
		session.start(null);
		first.receive(
			JSON.stringify({ type: "started", generation: 1, remoteAssets: [] }),
		);
		clock.now = 500;
		t.tick();
		clock.now = 30_000;
		t.tick();
		expect(session.getState().status).toBe("running");
		steady(clock, t, 34_500);
		expect(session.getState().status).toBe("running");
		steady(clock, t, 35_000);
		expect(session.getState()).toMatchObject({
			status: "failed",
			failure: { error: { code: "runtime_execution_budget_exceeded" } },
		});
	});

	/**
	 * iOS can keep Hermes timers running for a moment after the app leaves the foreground while the
	 * WKWebView content process is already suspended: pings go out and nothing can answer them. Away
	 * from the foreground nothing is judged; the clock starts over on return.
	 */
	it("judges nothing while the app is not in the foreground", () => {
		let active = true;
		const {
			session,
			first,
			clock,
			timers: t,
		} = watched({
			foreground: () => active,
		});
		session.start(null);
		first.receive(
			JSON.stringify({ type: "started", generation: 1, remoteAssets: [] }),
		);
		steady(clock, t, 1_000);
		active = false;
		steady(clock, t, 20_000);
		expect(session.getState().status).toBe("running");
		active = true;
		steady(clock, t, 24_500);
		expect(session.getState().status).toBe("running");
		steady(clock, t, 26_000);
		expect(session.getState().status).toBe("failed");
	});
});

describe("bridge renewal", () => {
	function renewing(firstReady: boolean) {
		const first = createNativeRuntimeTransport("android-webmessage");
		first.open(() => {});
		if (firstReady) first.receive(JSON.stringify({ type: "ready" }));
		const renewed: ReturnType<typeof createNativeRuntimeTransport>[] = [];
		const session = createNativeRuntimeSession({
			transport: first,
			generationSeed: 0,
			liveness: { setInterval: () => 1, clearInterval: () => {} },
			renewTransport: () => {
				const next = createNativeRuntimeTransport("android-webmessage");
				renewed.push(next);
				return next;
			},
		});
		return { session, first, renewed };
	}

	/**
	 * A device that cannot stand the port (`web_message_channel_unsupported`), a missing asset, or an
	 * iOS document that fails to load fails every transport it is mounted with. The screen keys the
	 * WebView on the transport, so renewing there re-created WebViews forever. A bridge that never
	 * stood is unavailable: the session fails at the transport stage and nothing new is mounted.
	 */
	it("a bridge that never stood is not renewed", async () => {
		const { session, first, renewed } = renewing(false);
		let renders = 0;
		let mounted = session.transport;
		session.subscribe(() => {
			renders += 1;
			if (renders > 50) return;
			/** The screen: a new transport mounts a new host, and this device fails it on load. */
			if (session.transport !== mounted) {
				mounted = session.transport;
				const host = mounted;
				queueMicrotask(() =>
					host.fail("web_message_channel_unsupported: WEB_MESSAGE_LISTENER"),
				);
			}
		});
		session.start(null);
		first.fail("web_message_channel_unsupported: WEB_MESSAGE_LISTENER");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(renewed).toHaveLength(0);
		expect(session.transport).toBe(first);
		expect(session.getState()).toMatchObject({
			status: "failed",
			failure: { stage: "transport" },
		});
	});

	it("a live bridge that dies is renewed once, and its successor dying on load ends it", () => {
		const { session, first, renewed } = renewing(true);
		session.start(null);
		first.fail("render_process_gone");
		expect(renewed).toHaveLength(1);
		renewed[0]?.fail("harness_asset_missing");
		expect(renewed).toHaveLength(1);
		expect(session.getState()).toMatchObject({
			status: "failed",
			failure: { stage: "transport", message: "harness_asset_missing" },
		});
	});

	it("a bridge that dies while nothing runs is renewed by the next start, not before", () => {
		const { session, first, renewed } = renewing(true);
		first.fail("content_process_terminated");
		expect(renewed).toHaveLength(0);
		session.start(null);
		expect(renewed).toHaveLength(1);
		const fresh = renewed[0] as ReturnType<typeof createNativeRuntimeTransport>;
		expect(session.transport).toBe(fresh);
		const sent: string[] = [];
		fresh.open((json) => sent.push(json));
		fresh.receive(JSON.stringify({ type: "ready" }));
		expect(sent.map((json) => JSON.parse(json).type)).toContain("start");
		expect(session.getState().status).toBe("starting");
	});

	/** A press may retry a bridge that could not stand — once. Past that the answer is the same. */
	it("restarts stop renewing after consecutive bridges that never stood", () => {
		const { session, first, renewed } = renewing(false);
		session.start(null);
		first.fail("load_failed");
		for (let press = 0; press < 5; press += 1) {
			session.stop();
			session.start(null);
			session.transport.fail("load_failed");
		}
		expect(renewed).toHaveLength(1);
		expect(session.getState()).toMatchObject({
			status: "failed",
			failure: { stage: "transport", message: "load_failed" },
		});
	});
});
