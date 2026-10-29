import { describe, expect, it } from "vitest";
import type { PreviewFailure } from "./protocol.ts";
import {
	initialRuntimePreviewState,
	type RuntimePreviewAction,
	type RuntimePreviewState,
	runtimePreviewControls,
	runtimePreviewReducer,
	runtimePreviewResetPlan,
} from "./runtime-preview-state.ts";

const reduce = (
	actions: RuntimePreviewAction[],
	from: RuntimePreviewState = initialRuntimePreviewState,
): RuntimePreviewState => actions.reduce(runtimePreviewReducer, from);

const SIG = '[["src/main.tsx","a"]]';
const failure: PreviewFailure = {
	stage: "runtime",
	error: {
		kind: "host",
		name: "x",
		message: "m",
		code: null,
		componentStack: [],
		frames: [],
	},
};

describe("normal path", () => {
	it("idle → compiling → starting → running", () => {
		const state = reduce([
			{ type: "run", generation: 1, signature: SIG },
			{ type: "starting", generation: 1 },
			{ type: "started", generation: 1, signature: SIG },
		]);
		expect(state).toEqual({
			status: "running",
			generation: 1,
			signature: SIG,
			stale: false,
			revision: 0,
			rootError: null,
		});
	});

	it("running → stopping → idle", () => {
		const running = reduce([
			{ type: "run", generation: 1, signature: SIG },
			{ type: "starting", generation: 1 },
			{ type: "started", generation: 1, signature: SIG },
		]);
		const stopping = runtimePreviewReducer(running, {
			type: "stop",
			generation: 1,
		});
		expect(stopping.status).toBe("stopping");
		expect(
			runtimePreviewReducer(stopping, { type: "stopped", generation: 1 }),
		).toEqual(initialRuntimePreviewState);
	});

	it("changing the source makes it stale, reverting makes it fresh; the status stays running", () => {
		const running = reduce([
			{ type: "run", generation: 1, signature: SIG },
			{ type: "starting", generation: 1 },
			{ type: "started", generation: 1, signature: SIG },
		]);
		const stale = runtimePreviewReducer(running, {
			type: "sourceChanged",
			signature: "other",
		});
		expect(stale).toMatchObject({
			status: "running",
			stale: true,
			generation: 1,
		});
		expect(
			runtimePreviewReducer(stale, { type: "sourceChanged", signature: SIG }),
		).toMatchObject({ stale: false });
		/** Staleness only exists while a session is running. An idle preview cannot be stale. */
		expect(
			runtimePreviewReducer(initialRuntimePreviewState, {
				type: "sourceChanged",
				signature: "x",
			}),
		).toBe(initialRuntimePreviewState);
	});

	/**
	 * An edit made while compiling or starting produces no transition, because no session is running
	 * yet. The edit is not lost: `started` carries the editor signal at that moment, so the session
	 * starts stale from its first frame. No effect has to wait and compare.
	 */
	it("if the source changes while compiling, the session starts stale", () => {
		const state = reduce([
			{ type: "run", generation: 1, signature: SIG },
			{ type: "sourceChanged", signature: "B" },
			{ type: "starting", generation: 1 },
			{ type: "started", generation: 1, signature: "B" },
		]);
		expect(state).toEqual({
			status: "running",
			generation: 1,
			signature: SIG,
			stale: true,
			revision: 0,
			rootError: null,
		});
		/** The signal captured at run time is kept as is. Reverting the source to it clears staleness. */
		expect(
			runtimePreviewReducer(state, { type: "sourceChanged", signature: SIG }),
		).toMatchObject({ stale: false });
	});

	it("editing while starting and reverting to the run-time code starts the session fresh", () => {
		const state = reduce([
			{ type: "run", generation: 1, signature: SIG },
			{ type: "sourceChanged", signature: "B" },
			{ type: "sourceChanged", signature: SIG },
			{ type: "starting", generation: 1 },
			{ type: "started", generation: 1, signature: SIG },
		]);
		expect(state).toMatchObject({ status: "running", stale: false });
	});

	it("restarting after going stale is a new generation's compiling", () => {
		const state = reduce([
			{ type: "run", generation: 1, signature: SIG },
			{ type: "starting", generation: 1 },
			{ type: "started", generation: 1, signature: SIG },
			{ type: "sourceChanged", signature: "v2" },
			{ type: "run", generation: 2, signature: "v2" },
		]);
		expect(state).toEqual({
			status: "compiling",
			generation: 2,
			signature: "v2",
		});
	});

	it("a commit clears the previous render failure", () => {
		const state = reduce([
			{ type: "run", generation: 1, signature: SIG },
			{ type: "starting", generation: 1 },
			{ type: "started", generation: 1, signature: SIG },
			{
				type: "rootError",
				generation: 1,
				error: failure.stage === "runtime" ? failure.error : (null as never),
				work: "render",
			},
		]);
		expect(state).toMatchObject({ rootError: { work: "render" } });
		expect(
			runtimePreviewReducer(state, {
				type: "committed",
				generation: 1,
				revision: 3,
			}),
		).toMatchObject({ rootError: null, revision: 3 });
	});
});

describe("failure", () => {
	it.each([
		["compiling", [{ type: "run", generation: 1, signature: SIG }]],
		[
			"starting",
			[
				{ type: "run", generation: 1, signature: SIG },
				{ type: "starting", generation: 1 },
			],
		],
		[
			"running",
			[
				{ type: "run", generation: 1, signature: SIG },
				{ type: "starting", generation: 1 },
				{ type: "started", generation: 1, signature: SIG },
			],
		],
	] as [
		string,
		RuntimePreviewAction[],
	][])("goes from %s to failed", (_label, actions) => {
		const state = reduce([
			...actions,
			{ type: "failed", generation: 1, failure },
		]);
		expect(state).toEqual({ status: "failed", generation: 1, failure });
	});

	it("stop after a failure goes straight to idle; there is no worker session to wait for", () => {
		const failed = reduce([
			{ type: "run", generation: 1, signature: SIG },
			{ type: "failed", generation: 1, failure },
		]);
		expect(
			runtimePreviewReducer(failed, { type: "stop", generation: 1 }),
		).toEqual(initialRuntimePreviewState);
	});
});

describe("generation", () => {
	it("an old generation's message makes no transition", () => {
		const compiling = reduce([{ type: "run", generation: 2, signature: SIG }]);
		for (const action of [
			{ type: "starting", generation: 1 },
			{ type: "started", generation: 1, signature: SIG },
			{ type: "failed", generation: 1, failure },
			{ type: "stopped", generation: 1 },
			{ type: "committed", generation: 1, revision: 1 },
		] as RuntimePreviewAction[])
			expect(runtimePreviewReducer(compiling, action)).toBe(compiling);
	});

	it("an old generation's late started does not turn the new generation's compiling into running", () => {
		const state = reduce([
			{ type: "run", generation: 1, signature: SIG },
			{ type: "starting", generation: 1 },
			{ type: "run", generation: 2, signature: "v2" },
			{ type: "started", generation: 1, signature: "v2" },
		]);
		expect(state).toEqual({
			status: "compiling",
			generation: 2,
			signature: "v2",
		});
	});

	it("an old generation's stopped does not return the new generation to idle", () => {
		const state = reduce([
			{ type: "run", generation: 1, signature: SIG },
			{ type: "starting", generation: 1 },
			{ type: "started", generation: 1, signature: SIG },
			{ type: "run", generation: 2, signature: "v2" },
			{ type: "stopped", generation: 1 },
		]);
		expect(state.status).toBe("compiling");
	});
});

describe("operations", () => {
	it("each state has a fixed set of operations", () => {
		const running = reduce([
			{ type: "run", generation: 1, signature: SIG },
			{ type: "starting", generation: 1 },
			{ type: "started", generation: 1, signature: SIG },
		]);
		expect(runtimePreviewControls(initialRuntimePreviewState)).toEqual({
			run: true,
			restart: false,
			stop: false,
		});
		expect(runtimePreviewControls(running)).toEqual({
			run: false,
			restart: true,
			stop: true,
		});
		expect(
			runtimePreviewControls(
				reduce([{ type: "run", generation: 1, signature: SIG }]),
			),
		).toEqual({ run: false, restart: false, stop: true });
		expect(
			runtimePreviewControls({ status: "failed", generation: 1, failure }),
		).toEqual({ run: false, restart: true, stop: false });
		expect(
			runtimePreviewControls({ status: "stopping", generation: 1 }),
		).toEqual({
			run: false,
			restart: false,
			stop: false,
		});
	});
});

describe("Reset play is a different operation from Restart", () => {
	const running = runtimePreviewReducer(
		runtimePreviewReducer(
			runtimePreviewReducer(initialRuntimePreviewState, {
				type: "run",
				generation: 1,
				signature: "sig",
			}),
			{ type: "starting", generation: 1 },
		),
		{ type: "started", generation: 1, signature: "sig" },
	);

	it("with a running session it clears and restarts, as one operation", () => {
		expect(runtimePreviewResetPlan(running)).toBe("restart-fresh");
		expect(
			runtimePreviewResetPlan(
				runtimePreviewReducer(initialRuntimePreviewState, {
					type: "run",
					generation: 2,
					signature: "sig",
				}),
			),
		).toBe("restart-fresh");
	});

	it("when stopped it only clears the snapshot; the next run starts over", () => {
		expect(runtimePreviewResetPlan(initialRuntimePreviewState)).toBe(
			"clear-only",
		);
		expect(
			runtimePreviewResetPlan(
				runtimePreviewReducer(running, {
					type: "failed",
					generation: 1,
					failure: { stage: "worker", message: "died" },
				}),
			),
		).toBe("clear-only");
	});

	/**
	 * Restart does not go through this check. If it did, the two buttons would silently become the
	 * same, and the difference is not visible on screen.
	 */
	it("Restart always carries saved state over", () => {
		expect(runtimePreviewControls(running).restart).toBe(true);
		expect(runtimePreviewControls(running).run).toBe(false);
	});
});
