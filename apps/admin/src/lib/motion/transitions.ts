import {
	type CubicBezier,
	motionDurationMs,
	motionEasing,
} from "@rowcat/design";
import type { Transition } from "motion/react";

/**
 * Design tokens → Motion transitions, so `duration: 0.18` is not hand-written per screen.
 *
 * `apps/web` has the same file, deliberately: the apps do not import each other. Drift is harmless
 * because no values live here — the rhythm comes from `@rowcat/design` and this only converts ms to
 * s and copies tuples. It is not lifted into `@rowcat/ui-web` because that package does not depend
 * on Motion, and adding it would burden every consumer of tokens and buttons.
 */

/** Motion for React is the only consumer that uses seconds. */
export const seconds = (ms: number) => ms / 1000;

/** Copies the token's readonly tuple into the mutable tuple Motion accepts. */
const ease = (curve: CubicBezier) =>
	[...curve] as [number, number, number, number];

export const enterTransition: Transition = {
	duration: seconds(motionDurationMs.normal),
	ease: ease(motionEasing.enter),
};

/**
 * The same thing moving because layout changed (here only the sidebar indicator). Same values as
 * `standardTransition` but a different axis — "position changes" vs "state changes in place" — so
 * this is the one to tune if relayout grows.
 */
export const layoutTransition: Transition = {
	duration: seconds(motionDurationMs.normal),
	ease: ease(motionEasing.standard),
};
