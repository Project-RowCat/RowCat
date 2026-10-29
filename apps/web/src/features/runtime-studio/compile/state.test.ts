import type { RuntimeAnalyzeResult } from "@rowcat/runtime-compiler";
import { describe, expect, it } from "vitest";
import {
	initialRuntimeCompileState,
	RUNTIME_COMPILE_STATUS,
	type RuntimeCompileState,
	runtimeCompileReducer,
} from "./state.ts";

/**
 * The race behavior of the compile state machine is what this file exists to check.
 *
 * A compile that starts first but finishes last must not overwrite the newer result. Requests take
 * varying times, so this race really happens. The symptom vanishes on the next keystroke, so it is
 * never reproduced by hand.
 */

const result = (count: number): RuntimeAnalyzeResult => ({
	diagnostics: Array.from({ length: count }, (_, index) => ({
		code: `runtime_test_${index}`,
		severity: "error" as const,
		message: `problem ${index}`,
		source: "policy" as const,
	})),
	modules: ["src/main.tsx"],
});

const run = (
	actions: Parameters<typeof runtimeCompileReducer>[1][],
): RuntimeCompileState =>
	actions.reduce(runtimeCompileReducer, initialRuntimeCompileState);

describe("races", () => {
	it("an earlier compile that finishes late does not overwrite the latest result", () => {
		const state = run([
			{ type: "start", requestId: 1 },
			{ type: "start", requestId: 2 },
			{ type: "settle", requestId: 2, result: result(0) },
			/** Request 1 finishes late now, and its result must be discarded. */
			{ type: "settle", requestId: 1, result: result(5) },
		]);
		expect(state.settled).toBe(2);
		expect(state.diagnostics).toEqual([]);
		expect(state.status).toBe(RUNTIME_COMPILE_STATUS.ready);
	});

	it("a late failure does not overwrite the latest result either", () => {
		const state = run([
			{ type: "start", requestId: 1 },
			{ type: "start", requestId: 2 },
			{ type: "settle", requestId: 2, result: result(0) },
			{
				type: "fail",
				requestId: 1,
				diagnostic: {
					code: "runtime_api_version_unsupported",
					severity: "error",
					message: "failure",
					source: "runtime",
				},
			},
		]);
		expect(state.status).toBe(RUNTIME_COMPILE_STATUS.ready);
	});

	it("finishing in order draws the latest", () => {
		const state = run([
			{ type: "start", requestId: 1 },
			{ type: "settle", requestId: 1, result: result(3) },
			{ type: "start", requestId: 2 },
			{ type: "settle", requestId: 2, result: result(1) },
		]);
		expect(state.diagnostics).toHaveLength(1);
	});

	it("start numbers only move forward", () => {
		const state = run([
			{ type: "start", requestId: 2 },
			{ type: "start", requestId: 1 },
		]);
		expect(state.requested).toBe(2);
	});

	it("does not accept results of a request never started", () => {
		const state = run([
			{ type: "start", requestId: 1 },
			{ type: "settle", requestId: 9, result: result(4) },
		]);
		expect(state.status).toBe(RUNTIME_COMPILE_STATUS.checking);
		expect(state.diagnostics).toEqual([]);
	});
});

describe("state", () => {
	it("no diagnostics means no problems", () => {
		const state = run([
			{ type: "start", requestId: 1 },
			{ type: "settle", requestId: 1, result: result(0) },
		]);
		expect(state.status).toBe(RUNTIME_COMPILE_STATUS.ready);
	});

	it("diagnostics remain as problems", () => {
		const state = run([
			{ type: "start", requestId: 1 },
			{ type: "settle", requestId: 1, result: result(2) },
		]);
		expect(state.status).toBe(RUNTIME_COMPILE_STATUS.problems);
		expect(state.diagnostics).toHaveLength(2);
	});

	/**
	 * A draft switch must not carry over the previous project's diagnostics. Otherwise the new draft's
	 * screen would draw another project's file names.
	 */
	it("reset clears the previous project", () => {
		const state = run([
			{ type: "start", requestId: 1 },
			{ type: "settle", requestId: 1, result: result(3) },
			{ type: "reset" },
		]);
		expect(state).toEqual(initialRuntimeCompileState);
	});
});

/**
 * Screen copy does not belong in this file. The reducer only knows the runtime analysis. The `No
 * problems` creators see can be true only after Monaco's diagnostics are merged in, so that judgment and
 * its wording live in `runtime-compile-view.test.ts`.
 */
