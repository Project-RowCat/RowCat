/**
 * A transition describes the screen after a state change. It is not a frame generator. Creator code
 * sets state and renders. The style now holds the desired value, as a plain prop patch (set-prop).
 * No frames are produced here. The trusted renderer interpolates to that value in its own realm.
 * That is why the contract has no `animate()`, `useAnimation()`, or `onTransitionEnd`.
 * - Streaming frames to creator code would turn one 200 ms transition into about 60 VM turns, and
 *   each round trip would cross the native bridge.
 * - A completion callback would tie the creator's state machine to host time. An accessibility
 *   setting such as reduce motion would then change the order in which the program runs.
 * - Excluded: arbitrary CSS easing strings, cubic-bezier(...), and springs. Strings bring a
 *   grammar owned by the browser, and spring physics differ between platforms, so the same numbers
 *   give different motion.
 * - Excluded: `delay`. The answer to an interruption would differ for every delayed transition,
 *   and the host would have to hold hidden timers.
 * - Excluded: keyframes, repeats, and sequences. They open the time axis to creators and break
 *   the rule that one target value is enough for the renderer to move to.
 * - Excluded: enter and exit (Presence). A removed node still disappears immediately. Keeping it
 *   alive for an exit animation would desynchronize handler numbers and controller lifetimes from
 *   the tree. Unlike style.ts, this file contains validation functions. The type accepts values
 *   such as a negative or infinite duration, and if they reached a renderer, each platform would
 *   clamp them differently. Same structure as color.ts.
 */

/**
 * The easing vocabulary is closed, with five entries. The names match CSS keywords, but that match
 * is not the contract. The real curves live in `RUNTIME_EASING_BEZIER` below, the single source.
 * Both renderers derive their representations from that table. If the web used the keyword and
 * native used its own default easing, the same work would move with a different curve on each
 * platform. React Native's `Easing.ease` is not CSS's `ease`.
 */
export type RuntimeEasing =
	| "linear"
	| "ease"
	| "ease-in"
	| "ease-out"
	| "ease-in-out";

export const RUNTIME_EASINGS = [
	"linear",
	"ease",
	"ease-in",
	"ease-out",
	"ease-in-out",
] as const;

/**
 * Control points of the cubic Bezier for each easing. This is the only source both renderers use.
 * `linear` is in the table for the same reason. If it were missing, one renderer would express it
 * as a keyword and the other as a Bezier curve, with no place to check that they match.
 */
export const RUNTIME_EASING_BEZIER: Readonly<
	Record<RuntimeEasing, readonly [number, number, number, number]>
> = Object.freeze({
	linear: [0, 0, 1, 1],
	ease: [0.25, 0.1, 0.25, 1],
	"ease-in": [0.42, 0, 1, 1],
	"ease-out": [0, 0, 0.58, 1],
	"ease-in-out": [0.42, 0, 0.58, 1],
});

/**
 * How a node's value changes when it changes. Without the prop there is no transition. Every
 * existing work renders exactly as before, which is why this axis can be added safely. When the
 * prop is present, a missing `duration` defaults to 200 ms and a missing `easing` defaults to
 * `ease`. Only nodes whose `style` is a `RuntimeStyle` accept this prop. `Text`, `Button`,
 * `Progress`, and `Screen` have no box style, so they have no movable axes. Opening those would
 * require widening another contract, such as `RuntimeTextStyle`, which is a separate decision. To
 * move text, wrap it in a `View`.
 */
export interface RuntimeTransition {
	/**
	 * Duration in milliseconds; absent means 200. `0` means no transition, and the host assigns the
	 * value immediately. Negative, NaN, and Infinity are rejected rather than silently clamped, the
	 * same decision `volume` makes.
	 */
	duration?: number;
	easing?: RuntimeEasing;
}

export const RUNTIME_TRANSITION_DEFAULT_DURATION_MS = 200;

export const RUNTIME_TRANSITION_DEFAULT_EASING: RuntimeEasing = "ease";

/**
 * The limit is 10 seconds. It exists for the honesty of the expression, not for performance. A
 * 10-minute transition is effectively a frozen screen, and creators would conclude that their code
 * does not work.
 */
export const RUNTIME_TRANSITION_MAX_DURATION_MS = 10_000;

/**
 * Absolute cap on translation. Beyond this value the number has no meaning in screen coordinates.
 */
export const RUNTIME_TRANSLATE_LIMIT = 100_000;

export const RUNTIME_SCALE_LIMIT = 100;

/**
 * Only these four style axes can be transitioned. `width`, `padding`, and `backgroundColor` are
 * excluded on purpose. Those three force a re-layout, and layout interpolation is an axis where the
 * two platforms measure at different moments and pass through different intermediate states. These
 * four are composited only, so both platforms give the same answer.
 */
export const RUNTIME_TRANSITIONED_STYLE_KEYS = [
	"opacity",
	"translateX",
	"translateY",
	"scale",
] as const;

export type RuntimeTransitionedStyleKey =
	(typeof RUNTIME_TRANSITIONED_STYLE_KEYS)[number];

export interface RuntimeResolvedTransition {
	readonly durationMs: number;
	readonly easing: RuntimeEasing;
}

const isPlainRecord = (
	value: unknown,
): value is Readonly<Record<string, unknown>> => {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

/**
 * Checks one translation value. Both renderers and the VM boundary call this same function. If each
 * wrote its own, one might accept `Infinity`, and that value would blank the screen on that
 * platform only.
 */
export function checkRuntimeTranslate(value: unknown): string | null {
	if (typeof value !== "number" || !Number.isFinite(value))
		return "It must be a finite number.";
	if (Math.abs(value) > RUNTIME_TRANSLATE_LIMIT)
		return `It must be between -${RUNTIME_TRANSLATE_LIMIT} and ${RUNTIME_TRANSLATE_LIMIT}.`;
	return null;
}

export function checkRuntimeScale(value: unknown): string | null {
	if (typeof value !== "number" || !Number.isFinite(value))
		return "It must be a finite number.";
	if (value < 0 || value > RUNTIME_SCALE_LIMIT)
		return `It must be between 0 and ${RUNTIME_SCALE_LIMIT}.`;
	return null;
}

/**
 * Checks one transition and returns either the value with defaults filled in or a reason. It has
 * the same role as `classifyRuntimeAssetValue`: the server, the VM, and both renderers all pass
 * through it, so a value the editor accepted is not rejected at publish time. Unknown keys are
 * rejected. Silently ignoring `{ delay: 100 }` would make creators believe the delay works, and
 * they would find out only by watching the screen, if ever.
 */
export function classifyRuntimeTransition(
	value: unknown,
):
	| { readonly ok: true; readonly transition: RuntimeResolvedTransition }
	| { readonly ok: false; readonly reason: string } {
	if (!isPlainRecord(value))
		return { ok: false, reason: "It must be a plain object." };
	let durationMs = RUNTIME_TRANSITION_DEFAULT_DURATION_MS;
	let easing = RUNTIME_TRANSITION_DEFAULT_EASING;
	for (const key of Object.keys(value)) {
		const entry = value[key];
		if (entry === undefined) continue;
		switch (key) {
			case "duration": {
				if (typeof entry !== "number" || !Number.isFinite(entry))
					return { ok: false, reason: "duration must be a finite number." };
				if (entry < 0)
					return { ok: false, reason: "duration can't be negative." };
				if (entry > RUNTIME_TRANSITION_MAX_DURATION_MS)
					return {
						ok: false,
						reason: `duration can't exceed ${RUNTIME_TRANSITION_MAX_DURATION_MS}ms.`,
					};
				durationMs = entry;
				break;
			}
			case "easing": {
				if (
					typeof entry !== "string" ||
					!(RUNTIME_EASINGS as readonly string[]).includes(entry)
				)
					return {
						ok: false,
						reason: `easing must be one of ${RUNTIME_EASINGS.join(" · ")}.`,
					};
				easing = entry as RuntimeEasing;
				break;
			}
			default:
				return { ok: false, reason: `Unknown key: ${key}` };
		}
	}
	return { ok: true, transition: { durationMs, easing } };
}

/**
 * The target values for the axes that move, now. `null` means the axis is not declared. Not written
 * and written-as-neutral differ in the renderer. The first emits no declaration, while the second
 * states the neutral value explicitly. Without this distinction, a node with a transform could not
 * be told apart from one without.
 */
export interface RuntimeMotionTarget {
	readonly opacity: number | null;
	readonly translateX: number | null;
	readonly translateY: number | null;
	readonly scale: number | null;
}

export const RUNTIME_MOTION_ABSENT: RuntimeMotionTarget = Object.freeze({
	opacity: null,
	translateX: null,
	translateY: null,
	scale: null,
});

/**
 * A missing axis takes its neutral value, not the current one. Removing `translateY: 8` gives a
 * target of `0`, not 'stay where you are'. That lets the common pattern of conditionally enabling
 * an axis return to rest.
 */
export const RUNTIME_MOTION_NEUTRAL: Readonly<
	Record<RuntimeTransitionedStyleKey, number>
> = Object.freeze({ opacity: 1, translateX: 0, translateY: 0, scale: 1 });

export const sameRuntimeMotionTarget = (
	left: RuntimeMotionTarget,
	right: RuntimeMotionTarget,
): boolean =>
	left.opacity === right.opacity &&
	left.translateX === right.translateX &&
	left.translateY === right.translateY &&
	left.scale === right.scale;

export const hasRuntimeTransform = (target: RuntimeMotionTarget): boolean =>
	target.translateX !== null ||
	target.translateY !== null ||
	target.scale !== null;
