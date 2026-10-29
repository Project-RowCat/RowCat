import { describe, expect, it, vi } from "vitest";
import type { NativeRuntimeTransportEvent } from "./transport.ts";
import { createNativeRuntimeTransport } from "./transport.ts";

const ready = JSON.stringify({ type: "ready" });

/** The greeting is this layer's wiring, not a conversation of the session, so the queue checks leave it out. */
const types = (sent: readonly string[]): string[] =>
	sent.map((json) => JSON.parse(json).type).filter((type) => type !== "hello");

describe("queue", () => {
	it("doesn't discard messages from before the harness stood", () => {
		const sent: string[] = [];
		const transport = createNativeRuntimeTransport("android-webmessage");
		transport.send({ type: "start", generation: 1, artifact: { a: 1 } });
		transport.open((json) => sent.push(json));
		/** Even once the channel opens, nothing goes out until the document is up; the message would silently vanish. */
		expect(types(sent)).toEqual([]);
		transport.receive(ready);
		expect(types(sent)).toEqual(["start"]);
	});

	it("after ready they go out right away", () => {
		const sent: string[] = [];
		const transport = createNativeRuntimeTransport("ios-webview");
		transport.open((json) => sent.push(json));
		transport.receive(ready);
		transport.send({ type: "event", generation: 1, handlerId: 41 });
		expect(types(sent)).toEqual(["event"]);
	});

	it("keeps the order", () => {
		const sent: string[] = [];
		const transport = createNativeRuntimeTransport("ios-webview");
		transport.send({ type: "start", generation: 1, artifact: null });
		transport.send({ type: "event", generation: 1, handlerId: 1 });
		transport.send({ type: "stop", generation: 1 });
		transport.open((json) => sent.push(json));
		transport.receive(ready);
		expect(types(sent)).toEqual(["start", "event", "stop"]);
	});
});

describe("ready", () => {
	/**
	 * The document's greeting happens **once**, on load. When the bridge is rebuilt and the document
	 * stays (Fast Refresh or a session swap), that one greeting has already passed. Without asking,
	 * the new bridge would never become ready, and everything sent would sit in the queue while the
	 * screen stalls.
	 */
	it("open asks whether it's alive", () => {
		const sent: string[] = [];
		const transport = createNativeRuntimeTransport("ios-webview");
		transport.send({ type: "stop", generation: 1 });
		transport.open((json) => sent.push(json));
		/** The greeting skips the queue; opening the queue is that message's job. */
		expect(sent.map((json) => JSON.parse(json).type)).toEqual(["hello"]);
		transport.receive(ready);
		expect(sent.map((json) => JSON.parse(json).type)).toEqual([
			"hello",
			"stop",
		]);
	});

	it("a bridge already ready isn't asked again", () => {
		const sent: string[] = [];
		const transport = createNativeRuntimeTransport("ios-webview");
		transport.receive(ready);
		transport.open((json) => sent.push(json));
		expect(sent).toEqual([]);
	});

	it("a second ready makes no transition", () => {
		const events: NativeRuntimeTransportEvent[] = [];
		const transport = createNativeRuntimeTransport("android-webmessage");
		transport.subscribe((event) => events.push(event));
		transport.receive(ready);
		transport.receive(ready);
		expect(events).toHaveLength(1);
		expect(transport.ready).toBe(true);
	});
});

describe("failure", () => {
	it("after a transport failure nothing goes back and forth", () => {
		const sent: string[] = [];
		const events: NativeRuntimeTransportEvent[] = [];
		const transport = createNativeRuntimeTransport("android-webmessage");
		transport.open((json) => sent.push(json));
		transport.receive(ready);
		transport.subscribe((event) => events.push(event));
		transport.fail("render_process_crashed");
		transport.send({ type: "event", generation: 1, handlerId: 1 });
		transport.receive(JSON.stringify({ type: "started", generation: 1 }));
		expect(types(sent)).toEqual([]);
		expect(events).toEqual([
			{ type: "transport-failed", reason: "render_process_crashed" },
		]);
		expect(transport.closed).toBe(true);
	});

	it("misshapen strings are discarded quietly", () => {
		const listener = vi.fn();
		const transport = createNativeRuntimeTransport("ios-webview");
		transport.subscribe(listener);
		transport.receive("not json");
		transport.receive(JSON.stringify({ type: "started" }));
		expect(listener).not.toHaveBeenCalled();
	});
});
