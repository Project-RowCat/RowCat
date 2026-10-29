/**
 * Interaction latency. **Measured on one clock realm only.**
 *
 * ```text
 * t0  Hermes: just before the event message is put on the bridge
 *       │  bridge → WebView → QuickJS handler → state update → reconcile → patch bundle → bridge
 *       ▼
 * t1  Hermes: after that bundle has been **applied** to the host tree store
 * ```
 *
 * The WebView's `performance.now()` and Hermes's `Date.now()` have different origins. Subtracting
 * values from the two clocks yields the difference between two origins, not a latency. So both ends
 * are Hermes, and what is measured is everything that actually happens in between (two bridge
 * crossings, the VM turn, the scheduler, reconciliation, and application).
 *
 * ## It differs from the PoC round trip
 *
 * `hostRoundTripUs` in `runRuntimeVmPoc` is the round trip of one capability call measured **inside
 * the VM**. That number is not used as this gate's answer: the interval it measures differs, and so
 * does the clock realm.
 *
 * ## Warmup is discarded
 *
 * The first interactions carry JIT, layout and first-commit costs together. If they were mixed into
 * the distribution, the "first few" would decide the median. The number discarded is an argument;
 * this function does not choose it.
 */

export interface InteractionLatencySummary {
	/** The number of samples after warmup is removed. */
	samples: number;
	medianMs: number;
	p95Ms: number;
	p99Ms: number;
	minMs: number;
	maxMs: number;
}

/**
 * Nearest-rank percentile. No interpolation.
 *
 * Interpolation would produce a value that was never observed, and that value could flip the
 * verdict near a threshold such as 32ms. Only observed values can be the answer.
 */
function percentile(sorted: readonly number[], ratio: number): number {
	if (sorted.length === 0) return Number.NaN;
	const rank = Math.ceil(ratio * sorted.length);
	const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
	return sorted[index] as number;
}

export function summarizeInteractionLatency(
	samples: readonly number[],
	warmup: number,
): InteractionLatencySummary | null {
	const measured = samples.slice(Math.max(0, warmup));
	if (measured.length === 0) return null;
	const sorted = [...measured].sort((a, b) => a - b);
	return {
		samples: sorted.length,
		medianMs: percentile(sorted, 0.5),
		p95Ms: percentile(sorted, 0.95),
		p99Ms: percentile(sorted, 0.99),
		minMs: sorted[0] as number,
		maxMs: sorted[sorted.length - 1] as number,
	};
}

/**
 * Where the latency of one event is recorded.
 *
 * **Commits that do not pair are not counted.** Commits the render or effects produce on their own
 * (a creator's `setState` chain) belong to no event. Counting them would mix near-zero values into
 * the distribution and drag the median below the real figure. So **only the first commit while an
 * event is waiting** is paired with it.
 */
export interface InteractionRecorder {
	/** Just before the event enters the bridge. If an event is already waiting, that one is discarded. */
	begin(now: number): void;
	/** After the bundle is applied. If no event is waiting, nothing is counted. */
	commit(now: number): void;
	/** The session ended; the waiting pair is discarded. */
	abandon(): void;
	readonly samples: readonly number[];
	reset(): void;
}

export function createInteractionRecorder(): InteractionRecorder {
	let pending: number | null = null;
	let samples: number[] = [];
	return {
		begin(now) {
			pending = now;
		},
		commit(now) {
			if (pending === null) return;
			samples.push(now - pending);
			pending = null;
		},
		abandon() {
			pending = null;
		},
		get samples() {
			return samples;
		},
		reset() {
			pending = null;
			samples = [];
		},
	};
}
