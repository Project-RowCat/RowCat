import type {
	RuntimeEasing,
	RuntimeMotionTarget,
	RuntimeResolvedTransition,
} from "@rowcat/runtime/transition";
import {
	hasRuntimeTransform,
	RUNTIME_EASING_BEZIER,
} from "@rowcat/runtime/transition";
import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import { axisTarget, planNativeMotion } from "./motion.ts";
import { useReducedMotion } from "./reduced-motion.ts";

/**
 * The imperative half: applies the plan to Animated.Value. All rules live in motion.ts (pure). This
 * file contains only the part that drives React Native.
 *
 * Why useNativeDriver is false, deliberately. The native driver would run opacity and transform off
 * the JS thread, which seems to fit these axes. In that mode, however, the JS-side value is not
 * updated while the animation runs. When a new target interrupts a running transition, whether the
 * start is the value currently drawn or the previous target depends on the platform implementation,
 * and this repo cannot verify that as values. Interruption is a required behavior of this slice;
 * performance is not. So the choice is the one that cannot be wrong. With four axes and sub-second
 * durations the cost is small. Flipping it later requires a measured interruption behavior from a
 * device, and must not be done without one.
 *
 * Why a hook per node. Sound (audio-deck) and control (control-deck) are held by their decks: sound
 * because it is not drawn, control because it must run after drawing, so both sit outside and after
 * React. Motion is the drawing itself, so it lives in the drawing layer. Moving it into a deck
 * would leave the animated values with no way to reach the style.
 */

/**
 * Easing to RN's easing function. The source is the single table of control points in
 * @rowcat/runtime,
 * the same as on the web.
 */
const easingFn = (easing: RuntimeEasing) => {
	const [x1, y1, x2, y2] = RUNTIME_EASING_BEZIER[easing];
	return x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1
		? Easing.linear
		: Easing.bezier(x1, y1, x2, y2);
};

export interface NativeMotionStyle {
	readonly opacity: Animated.Value;
	readonly transform:
		| readonly [
				{ translateX: Animated.Value },
				{ translateY: Animated.Value },
				{ scale: Animated.Value },
		  ]
		| undefined;
}

interface MotionValues {
	opacity: Animated.Value;
	translateX: Animated.Value;
	translateY: Animated.Value;
	scale: Animated.Value;
}

/**
 * Produces the animation layer from target and policy. Without a policy it returns null, and the
 * node is drawn from static style alone, identical to before (backward compatible).
 *
 * The transform layer stays once a node has ever written a transform. The commit that clears the
 * last transform axis must animate that axis back to neutral. If the layer were removed, the static
 * style's transform: undefined would snap on screen.
 */
export function useNodeMotion(
	target: RuntimeMotionTarget,
	transition: RuntimeResolvedTransition | null,
): NativeMotionStyle | null {
	const reducedMotion = useReducedMotion();
	const values = useRef<MotionValues | null>(null);
	/**
	 * The target actually applied last. null means nothing has been applied yet (the first
	 * application).
	 */
	const applied = useRef<RuntimeMotionTarget | null>(null);
	const transformEngaged = useRef(false);
	/**
	 * Per-axis running animations, held as a table, not a list. A list would accumulate finished
	 * animations, so a node would keep every animation it made over the whole session. There are only
	 * four axes and at most one animation runs per axis, and the table states exactly that.
	 */
	const running = useRef<
		Partial<Record<keyof MotionValues, Animated.CompositeAnimation>>
	>({});

	if (values.current === null)
		values.current = {
			opacity: new Animated.Value(axisTarget(target, "opacity")),
			translateX: new Animated.Value(axisTarget(target, "translateX")),
			translateY: new Animated.Value(axisTarget(target, "translateY")),
			scale: new Animated.Value(axisTarget(target, "scale")),
		};
	if (hasRuntimeTransform(target)) transformEngaged.current = true;

	const active = transition !== null;

	useEffect(() => {
		const store = values.current as MotionValues;
		const stopAll = (): void => {
			for (const animation of Object.values(running.current)) animation?.stop();
			running.current = {};
		};
		if (!active) {
			/**
			 * The transition was removed: stop whatever is running and set the values to the target. Setting
			 * the values is the point. This layer is not drawn now (the static style holds the spot), but
			 * when a transition reattaches, these values become its first frame. If left stale, the screen
			 * would jump to old values on that commit.
			 */
			stopAll();
			for (const axis of [
				"opacity",
				"translateX",
				"translateY",
				"scale",
			] as const)
				store[axis].setValue(axisTarget(target, axis));
			applied.current = null;
			return;
		}
		const steps = planNativeMotion({
			previous: applied.current,
			next: target,
			transition,
			reducedMotion,
		});
		applied.current = target;
		for (const step of steps) {
			const value = store[step.axis];
			if (step.durationMs === 0) {
				/**
				 * Stop first. Calling setValue alone on an axis that is still running would be overwritten by
				 * the next frame. The path where reduced motion turns on during a transition goes exactly
				 * through here.
				 */
				running.current[step.axis]?.stop();
				delete running.current[step.axis];
				value.stopAnimation();
				value.setValue(step.to);
				continue;
			}
			/**
			 * A running animation is replaced by the new one from the current value. That is why
			 * interruption does not revert, and why this file has no starting point (see the motion.ts
			 * header). Replacing the table entry records that replacement on this side as well.
			 */
			const animation = Animated.timing(value, {
				toValue: step.to,
				duration: step.durationMs,
				easing: easingFn(step.easing),
				useNativeDriver: false,
			});
			running.current[step.axis] = animation;
			animation.start(() => {
				if (running.current[step.axis] === animation)
					delete running.current[step.axis];
			});
		}
	}, [target, transition, reducedMotion, active]);

	/**
	 * Unmount cleanup. When the node disappears, running animations are stopped so that a
	 * late-finishing one does not write to a dead value. A whole-session swap also passes through
	 * here: when the tree store empties, nodes unmount, and this cleanup runs.
	 */
	useEffect(
		() => () => {
			for (const animation of Object.values(running.current)) animation?.stop();
			running.current = {};
		},
		[],
	);

	if (!active) return null;
	const store = values.current as MotionValues;
	return {
		opacity: store.opacity,
		transform: transformEngaged.current
			? ([
					{ translateX: store.translateX },
					{ translateY: store.translateY },
					{ scale: store.scale },
				] as const)
			: undefined,
	};
}
