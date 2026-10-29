import {
	type CubicBezier,
	motionDurationMs,
	motionEasing,
} from "@rowcat/design";

/**
 * Rhythm values for primitive open and close. This file holds values and tables only.
 *
 * It is the native counterpart of packages/ui-web/src/lib/primitive-motion.ts. Only the runtime
 * that consumes the values differs: Motion on the web, Reanimated here. Without a shared file, the
 * dialog, alert dialog, dropdown, sheet and drawer would each repeat the same six lines, and
 * changing one value would mean editing five places, one of which would inevitably be missed.
 *
 * This file imports neither Reanimated nor React Native, so the values can be checked without
 * rendering (motion/rhythm.test.ts). animate.ts converts them to the runtime's shape.
 *
 * Time values are not invented here. Their only source is @rowcat/design; the web reads the same
 * tokens.
 */

/**
 * How the reduced-motion setting applies to this axis, written as plain strings in Reanimated's
 * vocabulary. The enum is not imported, because this file must not know the runtime. The values
 * equal the ReduceMotion string values, so they carry through when converted.
 * - system: when the device's reduce-motion setting is on, the value jumps straight to its final
 *   state. Used for transforms (move, scale, rotate).
 * - never: runs regardless of the setting. Used for opacity.
 *
 * Splitting the two axes this way is the app's whole accessibility motion policy.
 */
export type ReduceMotionPolicy = "system" | "never";

/** One axis's rhythm. animate.ts converts it to a Reanimated WithTimingConfig. */
export type NativeRhythm = {
	readonly duration: number;
	readonly easing: CubicBezier;
	readonly reduceMotion: ReduceMotionPolicy;
};

/**
 * A rhythm pair: both axes share the same duration and curve.
 *
 * Only the reduced-motion answer differs between them (see ReduceMotionPolicy). Creating both
 * values in one place keeps the axes from drifting apart. If they drift, motion lingers after the
 * transform ends, or the reverse. That shows up as an intermittent afterimage that is hard to
 * reproduce.
 */
export type NativeRhythmPair = {
	/** Movement, scale and rotation. Under reduced motion it jumps straight to the final value. */
	readonly transform: NativeRhythm;
	/**
	 * Opacity. Keeps running under reduced motion too, because the fact that the state changed must
	 * still be readable.
	 */
	readonly opacity: NativeRhythm;
};

export function nativeRhythm(
	duration: number,
	easing: CubicBezier,
): NativeRhythmPair {
	return {
		transform: { duration, easing, reduceMotion: "system" },
		opacity: { duration, easing, reduceMotion: "never" },
	};
}

/**
 * Primitive rhythm, on a different scale from product motion.
 *
 * The reasoning is in the motionDurationMs.primitive comment in @rowcat/design. Easing uses the
 * product's standard curve. This surface both enters and exits, and it is anchored to a trigger and
 * flips in place. Separate open and close curves would make the return path after a quick double
 * press differ from the outgoing path.
 */
export const primitiveRhythm = nativeRhythm(
	motionDurationMs.primitive,
	motionEasing.standard,
);

/**
 * Left-edge drawer rhythm. This is not the primitive scale, and the difference is intended.
 *
 * Web's same surface is Dialog placement="left", which moves 16px on the primitive scale (100ms).
 * This drawer enters from off-screen by its own width (about 280dp, roughly 17 times the web's
 * distance). At the same 100ms the panel would fly in and read as "something popped out" rather
 * than "it came from the left". So only the scale is borrowed (enter at normal, exit at fast). The
 * values still come from the token.
 *
 * The difference is listed as intended in docs/motion/ARCHITECTURE.md. Without that record, a
 * future maintainer would read it as a miss and fold it into 100ms.
 */
export const drawerEnterRhythm = nativeRhythm(
	motionDurationMs.normal,
	motionEasing.enter,
);

export const drawerExitRhythm = nativeRhythm(
	motionDurationMs.fast,
	motionEasing.exit,
);

/** Scale on enter for popups. Same value as web. */
export const POPUP_SCALE = 0.95;

/**
 * Scale on enter for menu check indicators. Same as web's data-starting-style:scale-80. It is
 * deeper than the popup's 0.95 because it answers a press directly.
 */
export const MENU_INDICATOR_SCALE = 0.8;

/**
 * Reference travel distance (dp) for a dialog anchored to the bottom edge.
 *
 * It is larger than the travel for centered dialogs, because on a surface that spans the screen
 * height a small move reads as a shake.
 *
 * The left drawer does not use this value. It sits against the left edge and enters from off-screen
 * by its own width, which the device determines (navigation-drawer.tsx). Bottom-anchored dialogs
 * fill the screen width but do not rise by their full height, which would be a sheet gesture. They
 * arrive quietly, as on the web.
 */
export const DIALOG_EDGE_SHIFT = 16;
