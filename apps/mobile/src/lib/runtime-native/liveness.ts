/**
 * Is the harness thread still answering? A pure verdict the session's watchdog asks once per tick.
 *
 * ```text
 * quiet          heard recently enough — nothing to do
 * ping           silent past `pingAfterMs` — send `hello`, the document answers `ready`
 * unresponsive   silent past `unresponsiveAfterMs` — the WebView is torn down and the session fails
 * ```
 *
 * ## Why the VM budget is not enough
 *
 * The execution budget interrupts creator code at the engine's poll points (bytecode and regex). A
 * single native builtin call never reaches one: a quadratic `indexOf` over long strings ran for
 * minutes inside one turn and came back `ok`. Nothing inside the WebView can preempt that turn, so
 * the only owner left is the one outside it — Hermes, which can drop the whole realm. The web
 * player answers the same thing by terminating its worker.
 *
 * ## What counts as an answer
 *
 * Any string from the document. The scheduler yields to the event loop between slices, so a busy but
 * healthy VM still answers a `hello` within one turn; only a thread stuck in one native call stays
 * silent. Pinging only after silence keeps a chatty session from paying one injection per tick on
 * iOS.
 *
 * ## The bound
 *
 * One turn may run up to the execution budget (1 s by default), and the bridge, a cold WebView and a
 * slow device add to it. Five seconds of silence is far past anything a turn the budget can still
 * interrupt produces, and short enough that the person is not left looking at a frozen story.
 *
 * ## Silence is only evidence while this clock runs
 *
 * The verdict reads wall time, and wall time keeps moving while Hermes timers do not: a backgrounded
 * app or a locked screen pauses them (and suspends the WebView with them), and a stalled JS thread
 * delays them. The first tick after such a pause sees seconds of "silence" in which nothing was asked
 * and nothing could have answered. Read as silence, that tick failed every healthy session whose
 * player stepped away for more than a few seconds — and dropped the realm, its state and its sound.
 *
 * So two facts are required before `unresponsive`, not one:
 *
 * ```text
 * silent past the bound                      now − lastHeardAt ≥ unresponsiveAfterMs
 * a hello went unanswered while ticking      now − firstPingAt ≥ unresponsiveAfterMs − pingAfterMs
 * ```
 *
 * The second is the same span steady ticking produces (the first ping goes out `pingAfterMs` into
 * the silence), so an uninterrupted clock fails a hung harness exactly when it did before. And a tick
 * that arrives later than `gapAfterMs` after the previous one is not judged at all: it is `resume`,
 * the clock starts over from that tick and asks at once. The error this leaves is in one direction
 * only: if Hermes's own timers keep stalling (a tick every 2 s or more, or a stall often enough that no
 * 5 s of steady ticking accumulates) a hung harness is not judged at all — a creator cannot cause
 * that, since a hung harness sends nothing to stall Hermes with. A healthy session is never dropped.
 */

export interface NativeRuntimeLivenessPolicy {
	pingAfterMs: number;
	unresponsiveAfterMs: number;
	/**
	 * A tick later than this after the previous one means the clock itself stopped. It sits well past
	 * the tick interval (`pingAfterMs / 2`) so ordinary timer jitter is not read as a pause.
	 */
	gapAfterMs: number;
	/**
	 * How long a started session's document may take to stand (`ready`) while the app is in the
	 * foreground and the clock runs. A cold WebView parsing the harness takes a second or two; one that
	 * never stands is a realm that cannot be had — on a single-process Android WebView (7.x) the hung
	 * renderer is a thread of this app, and destroying the WebView does not stop it, so the renewed
	 * one never loads. Past this the session fails at the transport stage instead of waiting in
	 * `starting` forever with nothing judged.
	 */
	standAfterMs: number;
}

export const NATIVE_RUNTIME_LIVENESS_POLICY: NativeRuntimeLivenessPolicy = {
	pingAfterMs: 1_000,
	unresponsiveAfterMs: 5_000,
	gapAfterMs: 2_000,
	standAfterMs: 15_000,
};

export interface NativeRuntimeLivenessClock {
	/** When the document was last heard from. */
	lastHeardAt: number;
	/** When the last `hello` went out; `null` if none since the last answer. */
	lastPingAt: number | null;
	/** When the first `hello` since the last answer went out; `null` if none. */
	firstPingAt: number | null;
	/** When the previous tick ran (or the watchdog was armed). */
	lastTickAt: number;
}

/**
 * `resume`: the clock paused; start over from now and ask at once. The others as in the header.
 */
export type NativeRuntimeLivenessVerdict =
	| "quiet"
	| "ping"
	| "resume"
	| "unresponsive";

export function nativeRuntimeLivenessVerdict(
	now: number,
	clock: NativeRuntimeLivenessClock,
	policy: NativeRuntimeLivenessPolicy = NATIVE_RUNTIME_LIVENESS_POLICY,
): NativeRuntimeLivenessVerdict {
	if (now - clock.lastTickAt >= policy.gapAfterMs) return "resume";
	const silent = now - clock.lastHeardAt;
	if (silent < policy.pingAfterMs) return "quiet";
	if (
		silent >= policy.unresponsiveAfterMs &&
		clock.firstPingAt !== null &&
		now - clock.firstPingAt >= policy.unresponsiveAfterMs - policy.pingAfterMs
	)
		return "unresponsive";
	if (clock.lastPingAt !== null && now - clock.lastPingAt < policy.pingAfterMs)
		return "quiet";
	return "ping";
}
