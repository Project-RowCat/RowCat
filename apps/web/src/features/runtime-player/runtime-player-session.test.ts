import { describe, expect, it, vi } from "vitest";
import type { RuntimePreviewGenerationAdapter } from "#/features/runtime-preview/runtime-preview-generation.ts";
import { createPreviewGenerationRouter } from "#/features/runtime-preview/runtime-preview-generation-router.ts";
import { RUNTIME_UNRESPONSIVE_CODE } from "#/lib/runtime-watchdog/liveness.ts";
import {
	LIFECYCLE_EVENT_SILENCES_AUDIO,
	runtimePlayerAnswersGeneration,
	runtimePlayerUnresponsiveFailure,
} from "./runtime-player-session.ts";

/**
 * The playback hook's session rules as values. The hook itself needs React and a worker, which this
 * app's tests do not run (vitest.config.ts), so what it decides is written here and the hook reads it.
 */

describe("who may still start a generation", () => {
	/**
	 * The retiring session keeps its worker until the save flush ends, and its sessionRef stays set
	 * until release. A request it posts in that window used to reach the adapter: a paid request with
	 * a fresh AbortController nothing aborted, answering a promise the worker had already rejected.
	 */
	it("a session whose transition has begun is no longer answered", () => {
		expect(runtimePlayerAnswersGeneration({ session: 3, visible: 3 }, 3)).toBe(
			true,
		);
		expect(runtimePlayerAnswersGeneration({ session: 3, visible: 4 }, 3)).toBe(
			false,
		);
		expect(
			runtimePlayerAnswersGeneration({ session: null, visible: 3 }, 3),
		).toBe(false);
		expect(runtimePlayerAnswersGeneration({ session: 4, visible: 4 }, 3)).toBe(
			false,
		);
	});

	it("a request posted after Reset play never reaches the adapter", async () => {
		const owner = { session: 1 as number | null, visible: 1 };
		const adapter = vi.fn<RuntimePreviewGenerationAdapter>(async () => ({
			ok: true as const,
			text: "paid",
		}));
		const send = vi.fn();
		const router = createPreviewGenerationRouter({
			adapter: () => adapter,
			currentGeneration: () =>
				runtimePlayerAnswersGeneration(owner, 1) ? 1 : -1,
			send,
		});
		/** The lifecycle emits `transition` before it stops and releases the old owner. */
		owner.visible = 2;
		router.handle({
			generation: 1,
			requestId: 7,
			request: { messages: [], instructions: "", maxOutputCharacters: 10 },
		});
		await Promise.resolve();
		expect(adapter).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});
});

describe("which lifecycle events end the previous session's sound", () => {
	/**
	 * Every event that means "the session behind the visible tree is over, or no new one will start"
	 * silences; `started` and `idle` do not (the first is the new session's own sound, the second
	 * comes after the surface is already gone). A Record, so a new event type breaks compilation here
	 * until someone decides.
	 */
	it("transition and every way a transition can end without a session", () => {
		expect(LIFECYCLE_EVENT_SILENCES_AUDIO).toEqual({
			transition: true,
			"sync-required": true,
			"load-failed": true,
			blocked: true,
			"start-failed": true,
			started: false,
			idle: false,
		});
	});
});

describe("an unresponsive worker's failure", () => {
	it("is a runtime failure with the budget code", () => {
		const failure = runtimePlayerUnresponsiveFailure();
		expect(failure.stage).toBe("runtime");
		if (failure.stage !== "runtime") return;
		expect(failure.error.code).toBe(RUNTIME_UNRESPONSIVE_CODE);
		expect(failure.error.kind).toBe("host");
		expect(failure.error.componentStack).toEqual([]);
	});
});
