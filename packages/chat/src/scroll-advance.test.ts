import { describe, expect, it } from "vitest";
import {
	initialScrollAdvanceState,
	SCROLL_ADVANCE_GESTURE_GAP_MS,
	type ScrollAdvanceAction,
	type ScrollAdvanceState,
	scrollAdvanceAction,
	trackScrollAdvance,
} from "./scroll-advance.ts";

/**
 * Scroll-trigger tests. The judgment here opens a paid action, so these tests lock down two things:
 * how many requests one gesture sends, and what that gesture starts.
 */

const ADVANCE: ScrollAdvanceAction = { kind: "advance" };

const base = {
	downward: true,
	atBottom: true,
	action: ADVANCE,
	generating: false,
};

const message = (
	id: string,
	role: "user" | "assistant",
	tail: { truncated?: boolean; incomplete?: boolean } = {},
) => ({ id, role, ...tail });

describe("scrollAdvanceAction", () => {
	it("after a complete response it is the next scene", () => {
		expect(
			scrollAdvanceAction({
				messages: [message("u1", "user"), message("a1", "assistant")],
				canContinue: true,
			}),
		).toEqual({ kind: "advance" });
	});

	/**
	 * Writing a new scene after an unfinished sentence would leave that sentence unfinished forever,
	 * so the same gesture continues the same message first.
	 */
	it("after a response with an open tail it continues the same bubble", () => {
		for (const tail of [{ truncated: true }, { incomplete: true }])
			expect(
				scrollAdvanceAction({
					messages: [message("u1", "user"), message("a1", "assistant", tail)],
					canContinue: true,
				}),
			).toEqual({ kind: "continue", messageId: "a1" });
	});

	it("in a session without appending, an open-tailed response does not move to the next scene", () => {
		expect(
			scrollAdvanceAction({
				messages: [message("a1", "assistant", { truncated: true })],
				canContinue: false,
			}),
		).toBeNull();
	});

	it("starts nothing when the last turn is mine or nothing is stored", () => {
		expect(
			scrollAdvanceAction({
				messages: [message("a1", "assistant"), message("u1", "user")],
				canContinue: true,
			}),
		).toBeNull();
		expect(scrollAdvanceAction({ messages: [], canContinue: true })).toBeNull();
	});
});

describe("trackScrollAdvance", () => {
	it("the first downward scroll at the bottom triggers that action", () => {
		const { trigger } = trackScrollAdvance(initialScrollAdvanceState, {
			...base,
			now: 1_000,
		});
		expect(trigger).toEqual(ADVANCE);
	});

	it("consecutive momentum events trigger once", () => {
		let state: ScrollAdvanceState = initialScrollAdvanceState;
		let triggers = 0;
		for (let index = 0; index < 20; index++) {
			const result = trackScrollAdvance(state, {
				...base,
				now: 1_000 + index * 16,
			});
			state = result.state;
			if (result.trigger) triggers++;
		}
		expect(triggers).toBe(1);
	});

	it("a scroll after a sufficient pause is a new gesture", () => {
		let state = trackScrollAdvance(initialScrollAdvanceState, {
			...base,
			now: 1_000,
		}).state;
		const paused = trackScrollAdvance(state, {
			...base,
			now: 1_000 + SCROLL_ADVANCE_GESTURE_GAP_MS,
		});
		expect(paused.trigger).toEqual(ADVANCE);
		state = paused.state;
		// Events closer together than the gap are still the same gesture.
		expect(
			trackScrollAdvance(state, {
				...base,
				now: 1_000 + SCROLL_ADVANCE_GESTURE_GAP_MS + 100,
			}).trigger,
		).toBeNull();
	});

	/** Momentum from a downward scroll that reaches the bottom does not start the next scene. */
	it("a gesture coming down toward the bottom is not a trigger on reaching it", () => {
		let state = trackScrollAdvance(initialScrollAdvanceState, {
			...base,
			atBottom: false,
			now: 1_000,
		}).state;
		const arrived = trackScrollAdvance(state, {
			...base,
			now: 1_016,
		});
		expect(arrived.trigger).toBeNull();
		state = arrived.state;
		expect(
			trackScrollAdvance(state, {
				...base,
				now: 1_016 + SCROLL_ADVANCE_GESTURE_GAP_MS,
			}).trigger,
		).toEqual(ADVANCE);
	});

	it("a gesture during generation is just activity, and the momentum right after does not trigger", () => {
		let state: ScrollAdvanceState = initialScrollAdvanceState;
		for (let index = 0; index < 10; index++)
			state = trackScrollAdvance(state, {
				...base,
				generating: true,
				now: 1_000 + index * 16,
			}).state;
		const result = trackScrollAdvance(state, {
			...base,
			now: 1_000 + 10 * 16,
		});
		expect(result.trigger).toBeNull();
	});

	it("missing any condition does not trigger, but activity still counts", () => {
		for (const override of [
			{ downward: false },
			{ atBottom: false },
			{ action: null },
			{ generating: true },
		]) {
			const result = trackScrollAdvance(initialScrollAdvanceState, {
				...base,
				...override,
				now: 1_000,
			});
			expect(result.trigger).toBeNull();
			// Activity is always recorded. If it were not, a new gesture could form in the middle of
			// momentum.
			expect(result.state.lastGestureAt).toBe(1_000);
		}
	});
});
