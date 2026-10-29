import { describe, expect, it } from "vitest";
import {
	initialNativeRuntimeState,
	type NativeRuntimeState,
	nativeRuntimeControls,
	nativeRuntimeReducer,
} from "./session-state.ts";

const error = {
	kind: "creator" as const,
	name: "TypeError",
	message: "boom",
	code: null,
	componentStack: ["App"],
};

const run = (generation = 1): NativeRuntimeState => {
	let state = nativeRuntimeReducer(initialNativeRuntimeState, {
		type: "start",
		generation,
	});
	state = nativeRuntimeReducer(state, {
		type: "started",
		generation,
		remoteAssets: [],
	});
	return state;
};

describe("lifecycle", () => {
	it("start → run → stop", () => {
		let state = run();
		expect(state.status).toBe("running");
		state = nativeRuntimeReducer(state, { type: "stop", generation: 1 });
		expect(state.status).toBe("stopping");
		state = nativeRuntimeReducer(state, { type: "stopped", generation: 1 });
		expect(state).toEqual(initialNativeRuntimeState);
	});

	it("a commit advances the revision and clears an earlier render failure", () => {
		let state = run();
		state = nativeRuntimeReducer(state, {
			type: "rootError",
			generation: 1,
			error,
			work: "render",
		});
		expect(state).toMatchObject({ rootError: { work: "render" } });
		state = nativeRuntimeReducer(state, {
			type: "committed",
			generation: 1,
			revision: 2,
		});
		expect(state).toMatchObject({ revision: 2, rootError: null });
	});
});

describe("the first commit arrives before started", () => {
	/**
	 * The harness emits the first batch **inside** `mountRoot`, and `started` goes out after it.
	 * Dropping that commit would show the mounted tree on screen while the state says revision 0.
	 */
	it("inherits a revision that arrived while starting", () => {
		let state = nativeRuntimeReducer(initialNativeRuntimeState, {
			type: "start",
			generation: 1,
		});
		state = nativeRuntimeReducer(state, {
			type: "committed",
			generation: 1,
			revision: 1,
		});
		expect(state).toMatchObject({ status: "starting", revision: 1 });
		state = nativeRuntimeReducer(state, {
			type: "started",
			generation: 1,
			remoteAssets: [],
		});
		expect(state).toMatchObject({ status: "running", revision: 1 });
	});
});

describe("the generation is the gate", () => {
	it("news from an old generation makes no transition", () => {
		const state = run(2);
		for (const action of [
			{ type: "started", generation: 1, remoteAssets: [] } as const,
			{ type: "committed", generation: 1, revision: 9 } as const,
			{ type: "stopped", generation: 1 } as const,
			{
				type: "failed",
				generation: 1,
				failure: { stage: "renderer", message: "x" },
			} as const,
		])
			expect(nativeRuntimeReducer(state, action)).toBe(state);
	});

	it("only transport failures pass across generations", () => {
		const state = run(3);
		const next = nativeRuntimeReducer(state, {
			type: "transportFailed",
			reason: "render_process_crashed",
		});
		expect(next).toEqual({
			status: "failed",
			generation: 3,
			failure: { stage: "transport", message: "render_process_crashed" },
		});
	});

	it("transport failures are reported even with no running session", () => {
		expect(
			nativeRuntimeReducer(initialNativeRuntimeState, {
				type: "transportFailed",
				reason: "unlinked",
			}),
		).toMatchObject({ status: "failed", generation: null });
	});
});

describe("operations", () => {
	it("what stands in each state", () => {
		expect(nativeRuntimeControls(initialNativeRuntimeState)).toEqual({
			start: true,
			restart: false,
			stop: false,
		});
		expect(
			nativeRuntimeControls({ status: "starting", generation: 1, revision: 0 }),
		).toEqual({ start: false, restart: false, stop: true });
		expect(nativeRuntimeControls(run())).toEqual({
			start: false,
			restart: true,
			stop: true,
		});
		expect(
			nativeRuntimeControls({ status: "stopping", generation: 1 }),
		).toEqual({ start: false, restart: false, stop: false });
		expect(
			nativeRuntimeControls({
				status: "failed",
				generation: 1,
				failure: { stage: "transport", message: "x" },
			}),
		).toEqual({ start: false, restart: true, stop: false });
	});
});

/**
 * **The authorization list dies with the session.**
 *
 * The reason it lives in state is this check. If it were in a module global or a coordinator field,
 * someone would have to remember to clear it, and forgetting that one line lets story A's declared
 * address open in story B's session. No symptom shows on screen (the image still renders).
 */
describe("remote asset authorization list", () => {
	const started = (generation: number, remoteAssets: readonly string[]) => {
		let state = nativeRuntimeReducer(initialNativeRuntimeState, {
			type: "start",
			generation,
		});
		state = nativeRuntimeReducer(state, {
			type: "started",
			generation,
			remoteAssets,
		});
		return state;
	};

	it("holds the list `started` gave", () => {
		const state = started(1, ["https://a.example.com/one.png"]);
		expect(state.status === "running" && state.remoteAssets).toEqual([
			"https://a.example.com/one.png",
		]);
	});

	it("the list disappears when a new generation starts", () => {
		const running = started(1, ["https://a.example.com/one.png"]);
		const starting = nativeRuntimeReducer(running, {
			type: "start",
			generation: 2,
		});
		expect(starting.status).toBe("starting");
		expect("remoteAssets" in starting).toBe(false);
	});

	it("the next session's list doesn't inherit the previous one's", () => {
		let state = started(1, ["https://a.example.com/one.png"]);
		state = nativeRuntimeReducer(state, { type: "start", generation: 2 });
		state = nativeRuntimeReducer(state, {
			type: "started",
			generation: 2,
			remoteAssets: ["https://b.example.com/two.png"],
		});
		expect(state.status === "running" && state.remoteAssets).toEqual([
			"https://b.example.com/two.png",
		]);
	});
});
