import { describe, expect, it } from "vitest";
import { answerHostCall, parseRuntimeMessage } from "./protocol.ts";

const json = (value: unknown): string => JSON.stringify(value);

describe("doesn't trust strings the WebView gave", () => {
	it("accepts only what has the right shape", () => {
		expect(parseRuntimeMessage("{oops")).toBeNull();
		expect(parseRuntimeMessage(json({ type: "nope" }))).toBeNull();
		expect(parseRuntimeMessage(json({ type: "poc-step" }))).toBeNull();
		expect(parseRuntimeMessage(json({ type: "ready" }))).toEqual({
			type: "ready",
		});
	});

	it("rejects runtime messages without a generation", () => {
		expect(parseRuntimeMessage(json({ type: "started" }))).toBeNull();
		expect(
			parseRuntimeMessage(json({ type: "started", generation: 0 })),
		).toBeNull();
		expect(
			parseRuntimeMessage(json({ type: "started", generation: 1.5 })),
		).toBeNull();
		/** A harness without the list folds to an **empty list**: that means "no address is authorized". */
		expect(
			parseRuntimeMessage(json({ type: "started", generation: 2 })),
		).toEqual({ type: "started", generation: 2, remoteAssets: [] });
		expect(
			parseRuntimeMessage(
				json({
					type: "started",
					generation: 3,
					remoteAssets: ["https://cdn.example.com/a.png", 7],
				}),
			),
		).toEqual({
			type: "started",
			generation: 3,
			remoteAssets: ["https://cdn.example.com/a.png"],
		});
	});

	it("checks the bundle's shape", () => {
		expect(
			parseRuntimeMessage(json({ type: "commit", generation: 1, batch: {} })),
		).toBeNull();
		expect(
			parseRuntimeMessage(
				json({
					type: "commit",
					generation: 1,
					batch: { revision: 1, patches: "nope" },
				}),
			),
		).toBeNull();
		expect(
			parseRuntimeMessage(
				json({
					type: "commit",
					generation: 1,
					batch: {
						revision: 1,
						patches: [{ op: "create", id: 1, kind: "view" }],
					},
				}),
			),
		).toMatchObject({ type: "commit", generation: 1 });
	});

	it("there are only three console levels", () => {
		expect(
			parseRuntimeMessage(
				json({ type: "console", generation: 1, level: "table", args: [] }),
			),
		).toBeNull();
		expect(
			parseRuntimeMessage(
				json({ type: "console", generation: 1, level: "warn", args: ["x"] }),
			),
		).toMatchObject({ level: "warn" });
	});

	it("checks the error projection's shape", () => {
		const error = {
			kind: "creator",
			name: "TypeError",
			message: "boom",
			code: null,
			componentStack: ["App"],
		};
		expect(
			parseRuntimeMessage(
				json({ type: "root-error", generation: 1, error, work: "render" }),
			),
		).toMatchObject({ type: "root-error", work: "render" });
		/** An unknown work kind is not accepted. */
		expect(
			parseRuntimeMessage(
				json({ type: "root-error", generation: 1, error, work: "layout" }),
			),
		).toBeNull();
		/** If `componentStack` is not a list of strings, the screen throws while drawing it. */
		expect(
			parseRuntimeMessage(
				json({
					type: "root-error",
					generation: 1,
					error: { ...error, componentStack: [1] },
					work: "render",
				}),
			),
		).toBeNull();
	});

	it("there are only four failure stages", () => {
		expect(
			parseRuntimeMessage(
				json({
					type: "failed",
					generation: 1,
					failure: { stage: "compile", diagnostics: [] },
				}),
			),
		).toBeNull();
		expect(
			parseRuntimeMessage(
				json({
					type: "failed",
					generation: 1,
					failure: { stage: "renderer", message: "revision" },
				}),
			),
		).toMatchObject({ type: "failed" });
	});
});

describe("PoC capability", () => {
	it("the native side answers two capabilities and doesn't answer slow", () => {
		expect(
			answerHostCall({
				type: "host-call",
				id: 1,
				capability: "test.echo",
				payload: [1],
			}),
		).toEqual({ type: "host-result", id: 1, ok: true, value: [1] });
		expect(
			answerHostCall({
				type: "host-call",
				id: 2,
				capability: "test.fail",
				payload: null,
			}),
		).toMatchObject({ ok: false });
		expect(
			answerHostCall({
				type: "host-call",
				id: 3,
				capability: "test.slow",
				payload: null,
			}),
		).toBeNull();
		/** A prototype property name is not a capability either. */
		expect(
			answerHostCall({
				type: "host-call",
				id: 4,
				capability: "constructor",
				payload: null,
			}),
		).toBeNull();
	});
});
