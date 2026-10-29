import { describe, expect, test } from "vitest";
import type { PlayerErrorInfo } from "./protocol.ts";
import {
	initialRuntimePlayerState,
	type RuntimePlayerState,
	runtimePlayerReducer,
	showsRuntimeSurface,
} from "./runtime-player-state.ts";

/**
 * Tests the playback state machine as plain values, without components. The three things the
 * reducer answers are all silent defects: a late generation's message changing the new screen, a
 * creator failure clearing the screen, and a compatibility failure offering a retry.
 */

const creatorError: PlayerErrorInfo = {
	kind: "creator",
	name: "App",
	message: "boom",
	code: null,
	componentStack: ["App"],
	frames: [],
};

const started = (generation: number): RuntimePlayerState =>
	runtimePlayerReducer(
		runtimePlayerReducer(initialRuntimePlayerState, {
			type: "start",
			generation,
		}),
		{ type: "started", generation },
	);

describe("generation", () => {
	test("news from an old generation changes nothing", () => {
		const running = started(2);
		expect(
			runtimePlayerReducer(running, { type: "started", generation: 1 }),
		).toBe(running);
		expect(
			runtimePlayerReducer(running, {
				type: "root-error",
				generation: 1,
				error: creatorError,
			}),
		).toBe(running);
		expect(
			runtimePlayerReducer(running, {
				type: "failed",
				generation: 1,
				failure: { stage: "worker", message: "died" },
			}),
		).toBe(running);
	});

	test("restart clears the previous error", () => {
		const failed = runtimePlayerReducer(started(1), {
			type: "root-error",
			generation: 1,
			error: creatorError,
		});
		const restarted = runtimePlayerReducer(failed, {
			type: "start",
			generation: 2,
		});
		expect(restarted.status).toBe("starting");
		expect(restarted.creatorError).toBeNull();
		expect(restarted.failure).toBeNull();
	});
});

describe("the creator's failure and ours", () => {
	test("a creator error keeps drawing the screen", () => {
		const state = runtimePlayerReducer(started(1), {
			type: "root-error",
			generation: 1,
			error: creatorError,
		});
		expect(state.status).toBe("creator-error");
		expect(showsRuntimeSurface(state)).toBe(true);
	});

	/**
	 * A failure in the host, worker or renderer means the tree no longer matches the host, so the
	 * screen is not drawn.
	 */
	test("our failure does not draw the screen", () => {
		const state = runtimePlayerReducer(started(1), {
			type: "failed",
			generation: 1,
			failure: {
				stage: "renderer",
				message: "the revisions are not contiguous",
			},
		});
		expect(state.status).toBe("failed");
		expect(showsRuntimeSurface(state)).toBe(false);
	});

	/**
	 * Version mismatch is tracked separately (§95). If the screen offered restart from that state, the
	 * same artifact would be rebuilt in the same app and fail the same way.
	 */
	test("an artifact compatibility failure has its own state", () => {
		const state = runtimePlayerReducer(started(1), {
			type: "failed",
			generation: 1,
			failure: {
				stage: "artifact",
				message: "unsupported runtime api 4",
				code: "runtime_artifact_invalid",
			},
		});
		expect(state.status).toBe("incompatible");
		expect(showsRuntimeSurface(state)).toBe(false);
	});
});

describe("having no save", () => {
	/**
	 * `sync-required` is not treated as a new game (§57). On a freshly paired device, reading it as a
	 * start would show an empty playthrough for an account with months of progress, and its first
	 * commit would overwrite the real save.
	 */
	test("waiting for sync is not a start", () => {
		const state = runtimePlayerReducer(initialRuntimePlayerState, {
			type: "sync-required",
		});
		expect(state.status).toBe("syncing");
		expect(showsRuntimeSurface(state)).toBe(false);
	});

	/** A late signal arriving after the session is already up must not revert the screen. */
	test("a running session does not return to waiting for sync", () => {
		const running = started(1);
		expect(runtimePlayerReducer(running, { type: "sync-required" })).toBe(
			running,
		);
	});
});
