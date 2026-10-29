import {
	checkRuntimeScale,
	checkRuntimeTranslate,
	classifyRuntimeTransition,
	RUNTIME_MOTION_ABSENT,
	RUNTIME_MOTION_NEUTRAL,
	type RuntimeEasing,
	type RuntimeMotionTarget,
	type RuntimeResolvedTransition,
	type RuntimeTransitionedStyleKey,
} from "@rowcat/runtime/transition";
import type { RuntimeHostValue } from "@rowcat/runtime-host/patches";
import { NATIVE_RENDERER_ERROR_CODE, rendererError } from "./errors.ts";
import { isRecord } from "./styles.ts";

/**
 * The pure half of the transition: which axes move, to where, and for how long.
 *
 * motion.ts (targets, policy, plan) is verified as values, since React Native is not available
 * here. motion.tsx applies the plan to Animated.Value. The plan has no starting point. The starting
 * point is always the value currently drawn, because Animated.Value knows it and an interrupted
 * animation continues from there.
 *
 * Same as the web: which axes animate, the neutral values, transform order, easing control points,
 * no movement on first application, zero duration is immediate, a policy-only change does not
 * replay, and reduced motion is immediate. Different: the interpolation itself (CSS transitions in
 * the browser versus React Native's Animated).
 */

/** The four transitioned axes, in the contract's order. */
const AXES = [
	"opacity",
	"translateX",
	"translateY",
	"scale",
] as const satisfies readonly RuntimeTransitionedStyleKey[];

const contract = (message: string) =>
	rendererError(NATIVE_RENDERER_ERROR_CODE.contract, message);

/**
 * Extracts only the moving axes from a box style; absent axes are null. Unknown keys are not
 * inspected here, because boxStyleOf already rejects them by name. This answers only the four
 * values and their ranges.
 */
export function motionTargetOf(value: RuntimeHostValue): RuntimeMotionTarget {
	if (value === null) return RUNTIME_MOTION_ABSENT;
	if (!isRecord(value)) throw contract("style: expected an object");
	const read = (key: RuntimeTransitionedStyleKey): number | null => {
		if (!Object.hasOwn(value, key)) return null;
		const entry = value[key] as RuntimeHostValue;
		if (key === "opacity") {
			if (typeof entry !== "number" || !Number.isFinite(entry))
				throw contract("style.opacity: expected a finite number");
			/** Clamped to 0-1, the same rule as opacityValue in boxStyleOf. */
			return Math.min(1, Math.max(0, entry));
		}
		const why =
			key === "scale" ? checkRuntimeScale(entry) : checkRuntimeTranslate(entry);
		if (why !== null) throw contract(`style.${key}: ${why}`);
		return entry as number;
	};
	return {
		opacity: read("opacity"),
		translateX: read("translateX"),
		translateY: read("translateY"),
		scale: read("scale"),
	};
}

/** The actual target of an axis. An axis that is not specified is neutral, not unchanged. */
export const axisTarget = (
	target: RuntimeMotionTarget,
	axis: RuntimeTransitionedStyleKey,
): number => target[axis] ?? RUNTIME_MOTION_NEUTRAL[axis];

/**
 * Converts a host value into a judged transition. A value outside the contract is a contract error.
 *
 * The VM already rejected it with the same function, but this realm is the final authority: a
 * corrupted batch arrives here.
 */
export function transitionOf(
	value: RuntimeHostValue,
): RuntimeResolvedTransition {
	const verdict = classifyRuntimeTransition(value);
	if (!verdict.ok) throw contract(`transition: ${verdict.reason}`);
	return verdict.transition;
}

/** Where an axis is moved to, and for how long. A durationMs of 0 is an immediate assignment. */
export interface NativeMotionStep {
	readonly axis: RuntimeTransitionedStyleKey;
	readonly to: number;
	readonly durationMs: number;
	readonly easing: RuntimeEasing;
}

export interface NativeMotionPlanInput {
	/**
	 * The target most recently applied for real. null means this is the node's first application, and
	 * then all four axes are assigned immediately. Having a transition does not produce an arrival
	 * animation.
	 */
	readonly previous: RuntimeMotionTarget | null;
	readonly next: RuntimeMotionTarget;
	readonly transition: RuntimeResolvedTransition | null;
	/** Whether the device has reduce-motion enabled. The trusted host supplies this answer. */
	readonly reducedMotion: boolean;
}

/**
 * The steps to apply now: only the changed axes.
 *
 * An axis that did not change is absent from the plan (the answer to sections 17 and 18). A commit
 * that changes only the policy (duration 200 to 400) leaves the plan empty, so a running animation
 * sees nothing, and the new policy applies from the next target change.
 *
 * All four immediate conditions (first application, no policy, duration 0, reduced motion) give the
 * same answer. Folding them into one place is what keeps the two platforms equal.
 */
export function planNativeMotion(
	input: NativeMotionPlanInput,
): readonly NativeMotionStep[] {
	const { previous, next, transition, reducedMotion } = input;
	const first = previous === null;
	const durationMs =
		first || transition === null || reducedMotion ? 0 : transition.durationMs;
	const easing = transition?.easing ?? "ease";
	const steps: NativeMotionStep[] = [];
	for (const axis of AXES) {
		const to = axisTarget(next, axis);
		if (!first && axisTarget(previous, axis) === to) continue;
		steps.push({ axis, to, durationMs, easing });
	}
	return steps;
}
