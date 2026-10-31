import { describe, expect, it } from "vitest";
import {
	NATIVE_RUNTIME_LIVENESS_POLICY,
	nativeRuntimeLivenessVerdict,
} from "./liveness.ts";

const policy = {
	pingAfterMs: 1_000,
	unresponsiveAfterMs: 5_000,
	gapAfterMs: 2_000,
	standAfterMs: 15_000,
};

/** A clock that ticked every 500 ms up to `now`, so no gap unless a test says so. */
const at = (
	now: number,
	clock: {
		lastHeardAt: number;
		lastPingAt?: number | null;
		firstPingAt?: number | null;
		lastTickAt?: number;
	},
) =>
	nativeRuntimeLivenessVerdict(
		now,
		{
			lastHeardAt: clock.lastHeardAt,
			lastPingAt: clock.lastPingAt ?? null,
			firstPingAt: clock.firstPingAt ?? clock.lastPingAt ?? null,
			lastTickAt: clock.lastTickAt ?? now - 500,
		},
		policy,
	);

describe("liveness verdict", () => {
	it("recent word is quiet", () => {
		expect(at(999, { lastHeardAt: 0 })).toBe("quiet");
	});

	it("silence pings once per interval", () => {
		expect(at(1_000, { lastHeardAt: 0 })).toBe("ping");
		expect(at(1_500, { lastHeardAt: 0, lastPingAt: 1_000 })).toBe("quiet");
		expect(at(2_000, { lastHeardAt: 0, lastPingAt: 1_000 })).toBe("ping");
	});

	it("silence past the bound with a hello long unanswered is unresponsive", () => {
		expect(
			at(5_000, { lastHeardAt: 0, firstPingAt: 1_000, lastPingAt: 4_500 }),
		).toBe("unresponsive");
	});

	/**
	 * Wall time moved while Hermes timers did not (backgrounded app, locked screen): nobody asked, so
	 * nothing went unanswered. Silence alone never concludes.
	 */
	it("silence with no hello sent is not unresponsive", () => {
		expect(at(9_000, { lastHeardAt: 0 })).toBe("ping");
	});

	it("a hello too recent to have been answered is not enough", () => {
		expect(
			at(9_000, { lastHeardAt: 0, firstPingAt: 8_500, lastPingAt: 8_500 }),
		).toBe("quiet");
		expect(
			at(9_000, { lastHeardAt: 0, firstPingAt: 6_000, lastPingAt: 8_500 }),
		).toBe("quiet");
		expect(
			at(10_000, { lastHeardAt: 0, firstPingAt: 6_000, lastPingAt: 9_500 }),
		).toBe("unresponsive");
	});

	it("a tick far later than the previous one is a paused clock, not silence", () => {
		expect(
			at(13_000, {
				lastHeardAt: 0,
				firstPingAt: 1_000,
				lastPingAt: 4_500,
				lastTickAt: 4_500,
			}),
		).toBe("resume");
		expect(at(1_999, { lastHeardAt: 0, lastTickAt: 0 })).toBe("ping");
	});

	/**
	 * One turn may legitimately run up to the execution budget (1 s by default). The bound must sit far
	 * past it, or a heavy but interruptible story would be torn down as hung.
	 */
	it("the product bound sits well past one execution budget", () => {
		expect(
			NATIVE_RUNTIME_LIVENESS_POLICY.unresponsiveAfterMs,
		).toBeGreaterThanOrEqual(4 * 1_000);
		expect(NATIVE_RUNTIME_LIVENESS_POLICY.pingAfterMs).toBeLessThan(
			NATIVE_RUNTIME_LIVENESS_POLICY.unresponsiveAfterMs,
		);
		/** The session ticks every `pingAfterMs / 2`; a gap must be several missed ticks, not jitter. */
		expect(NATIVE_RUNTIME_LIVENESS_POLICY.gapAfterMs).toBeGreaterThanOrEqual(
			2 * NATIVE_RUNTIME_LIVENESS_POLICY.pingAfterMs,
		);
		expect(NATIVE_RUNTIME_LIVENESS_POLICY.gapAfterMs).toBeLessThan(
			NATIVE_RUNTIME_LIVENESS_POLICY.unresponsiveAfterMs,
		);
	});
});
