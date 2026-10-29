import {
	type CubicBezier,
	motionContinuousDurationMs,
	motionDurationMs,
	motionEasing,
} from "@rowcat/design";
import {
	Easing,
	LinearTransition,
	ReduceMotion,
	type WithTimingConfig,
} from "react-native-reanimated";

/**
 * Design tokens to Reanimated transitions. This is the native boundary.
 *
 * Counterpart of `apps/web/src/lib/motion/transitions.ts`. `@rowcat/design` holds only milliseconds
 * and bezier control points; converting them per screen would scatter magic durations. This file
 * holds only the conversion and the shared rhythm. Choreography (direction of list entrances,
 * number rolling) lives in the rhythm files, not here.
 *
 * `@rowcat/ui-native`'s `motion/animate.ts` converts the same tokens separately, on purpose: the
 * primitives' rhythm belongs to that package and the product's rhythm to the app, so importing one
 * from the other would widen the UI package's public API. Values cannot diverge because both read
 * the same tokens (`motion-parity.test.ts`).
 *
 * Accessibility policy is set per axis, since there is no global MotionConfig on native. Transform
 * uses `ReduceMotion.System` (jumps to the final value when the device requests it), while opacity
 * uses `ReduceMotion.Never` so state changes stay visible. Screens do not branch on
 * `useReducedMotion()`.
 *
 * Springs are absent because the web has none. Everything is an automatic timing transition; when
 * dragging or reordering arrives, `@rowcat/design/motion.ts` and this file change together.
 */

/** Converts a token's readonly tuple to a Reanimated easing. Values are unchanged. */
const ease = (curve: CubicBezier) => Easing.bezier(...curve);

/** Move, scale and rotate. Jumps to the final value under reduced motion. */
const transform = (duration: number, curve: CubicBezier): WithTimingConfig => ({
	duration,
	easing: ease(curve),
	reduceMotion: ReduceMotion.System,
});

/** Opacity. Still animates under reduced motion. */
const opacity = (duration: number, curve: CubicBezier): WithTimingConfig => ({
	duration,
	easing: ease(curve),
	reduceMotion: ReduceMotion.Never,
});

/** The two axes of one rhythm. Same timing and curve; only the accessibility policy differs. */
export type NativeTransition = {
	readonly transform: WithTimingConfig;
	readonly opacity: WithTimingConfig;
	/** Read by the policy tests, so the values can be checked without rendering. */
	readonly durationMs: number;
	readonly easing: CubicBezier;
};

const pair = (duration: number, curve: CubicBezier): NativeTransition => ({
	transform: transform(duration, curve),
	opacity: opacity(duration, curve),
	durationMs: duration,
	easing: curve,
});

/** In-place state change of an element already on screen. */
export const standardTransition = pair(
	motionDurationMs.normal,
	motionEasing.standard,
);

/** Entrance of a newly attached element. */
export const enterTransition = pair(
	motionDurationMs.normal,
	motionEasing.enter,
);

/** Exit. Shorter than the entrance so the eye is not held on something leaving. */
export const exitTransition = pair(motionDurationMs.fast, motionEasing.exit);

/**
 * Entrance for a continuously ticking value, such as a per-second countdown or a per-keystroke
 * count. Same axes as `enterTransition`, different duration only. The difference: a one-off change
 * has no next change coming, while this value always does.
 */
export const continuousEnterTransition = pair(
	motionContinuousDurationMs.enter,
	motionEasing.enter,
);

/** Exit of a continuously ticking value. Shorter than its entrance, like `exitTransition`. */
export const continuousExitTransition = pair(
	motionContinuousDurationMs.exit,
	motionEasing.exit,
);

/**
 * The same element moves because the layout changed, such as list reordering or an active indicator
 * sliding. Values match `standardTransition`, but the name is separate because the axis differs:
 * this one is about position changes, so only this constant gets tuned when reordering grows, and
 * it avoids slowing unrelated shared constants. The web `layoutTransition` says the same.
 */
export const layoutTransition = pair(
	motionDurationMs.normal,
	motionEasing.standard,
);

/**
 * Motion of remaining rows settling into place, expressed as a Reanimated layout transition.
 * `ReduceMotion.System` matters: this is pure movement with no opacity, so reduced motion jumps to
 * the final position, and the row simply sits there.
 */
export const rowLayout = LinearTransition.duration(layoutTransition.durationMs)
	.easing(ease(layoutTransition.easing))
	.reduceMotion(ReduceMotion.System);
