import {
	type CubicBezier,
	motionContinuousDurationMs,
	motionDurationMs,
	motionEasing,
} from "@rowcat/design";
import type { Transition } from "motion/react";

/**
 * Web boundary: converts design tokens (milliseconds and Bezier control points, platform
 * independent) into the shape Motion accepts.
 *
 * If this conversion were scattered across screens, duration: 0.18 would be hand-written in each
 * file, and changing a token would leave no way to find what did not follow. Only the conversion
 * and the shared rhythms live here. What moves and how (a heart's keyframes, a card's entry
 * direction) belongs to the feature. Gathering choreography here would turn this file into an
 * animation DSL and hide the fact that features use Motion.
 */

/** Motion for React takes durations in seconds, not milliseconds. */
export const seconds = (ms: number) => ms / 1000;

/**
 * Converts the readonly tuple from the token package into the mutable tuple Motion accepts. Values
 * are unchanged.
 */
const ease = (curve: CubicBezier) =>
	[...curve] as [number, number, number, number];

export const standardTransition: Transition = {
	duration: seconds(motionDurationMs.normal),
	ease: ease(motionEasing.standard),
};

export const enterTransition: Transition = {
	duration: seconds(motionDurationMs.normal),
	ease: ease(motionEasing.enter),
};

/** Exit. Shorter than enter, since a leaving element does not need to hold attention. */
export const exitTransition: Transition = {
	duration: seconds(motionDurationMs.fast),
	ease: ease(motionEasing.exit),
};

/**
 * For values that keep changing as they come in: a per-second countdown, a character count that
 * updates on each keystroke. Same axis and easing as enterTransition, and only the duration
 * differs. The reason: a normal enter explains a change that has no next change, while here the
 * next change is already coming. The rationale is in the motionContinuousDurationMs header in
 * @rowcat/design.
 */
export const continuousEnterTransition: Transition = {
	duration: seconds(motionContinuousDurationMs.enter),
	ease: ease(motionEasing.enter),
};

export const continuousExitTransition: Transition = {
	duration: seconds(motionContinuousDurationMs.exit),
	ease: ease(motionEasing.exit),
};

/**
 * Same value as standardTransition, but it has its own name because the axis is different.
 * standardTransition is a change in place (color, opacity); this is a change of position. If
 * re-layout grows later (a whole grid flowing), this is the only constant to adjust. Sharing one
 * constant would also slow the heart's pulse.
 *
 * Not a spring on purpose. Everything moving here is automatic re-layout (sort change, row removal,
 * sibling selection) and nothing is dragged. A spring on motion with nothing to imitate makes
 * deceleration harder to predict (see motion.ts in @rowcat/design).
 */
export const layoutTransition: Transition = {
	duration: seconds(motionDurationMs.normal),
	ease: ease(motionEasing.standard),
};

/**
 * CSS rhythm for the theme toggle glyph (sun and moon). This is the only value in this file that is
 * not for Motion.
 *
 * It is CSS because the dark class, not React, decides which icon shows. The correct icon has to be
 * right from the first paint, which requires the swap to be CSS (see the header of
 * mode-toggle.tsx). Being CSS is not a reason to write milliseconds into the class, so the values
 * come from here. It has the same shape as checkboxIndicatorRhythm in @rowcat/ui-web and the same
 * scale: this too is the immediate answer to the user's press (motionDurationMs.primitive), not an
 * explanation of a state.
 *
 * A single CSS transition has one duration, so it cannot express the enter and exit asymmetry of
 * icon-swap (180 and 120). With two glyphs crossing in the same string, that asymmetry does not
 * hold here anyway. The transition properties stay in the class layer so that motion-reduce: can
 * override them.
 */
export const themeGlyphRhythm = {
	transitionDuration: `${motionDurationMs.primitive}ms`,
	transitionTimingFunction: `cubic-bezier(${motionEasing.standard.join(", ")})`,
} as const;
