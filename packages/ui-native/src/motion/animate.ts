import { useEffect, useState } from "react";
import {
	Easing,
	interpolate,
	ReduceMotion,
	runOnJS,
	type SharedValue,
	useAnimatedStyle,
	useSharedValue,
	type WithTimingConfig,
	withTiming,
} from "react-native-reanimated";
import {
	DIALOG_EDGE_SHIFT,
	drawerEnterRhythm,
	drawerExitRhythm,
	MENU_INDICATOR_SCALE,
	type NativeRhythm,
	type NativeRhythmPair,
	POPUP_SCALE,
	primitiveRhythm,
} from "./rhythm.ts";

/**
 * The single runtime boundary for motion in this package: rhythm values become Reanimated config.
 *
 * apps/web/src/lib/motion/transitions.ts does the equivalent job on the web. Here, bezier control
 * points become Easing.bezier and the accessibility policy becomes ReduceMotion. If each component
 * made this conversion itself, duration literals would scatter across files, and a token change
 * would miss some of them.
 *
 * Reanimated is an exception to this package's rule against dependencies that need a native
 * rebuild. The only earlier exception was react-native-svg. The exception stays listed here rather
 * than removed. boundaries.test.ts limits it to the motion/ folder. Primitives used to appear and
 * disappear with no motion at all. RN core's Animated cannot express layout continuity or entering
 * and exiting presence, so product motion would have needed a second runtime anyway.
 *
 * There are no springs. The web has none, and all current motion is automatic transitions (open,
 * close, reposition) with nothing following a finger. boundaries.test.ts asserts that withSpring
 * and springify are absent.
 */

export function timingOf(rhythm: NativeRhythm): WithTimingConfig {
	return {
		duration: rhythm.duration,
		easing: Easing.bezier(...rhythm.easing),
		reduceMotion:
			rhythm.reduceMotion === "never"
				? ReduceMotion.Never
				: ReduceMotion.System,
	};
}

/**
 * Converts a rhythm pair into a Reanimated config pair. Defined at module level so it is not
 * recreated on every render.
 */
const timingPair = (pair: NativeRhythmPair) => ({
	transform: timingOf(pair.transform),
	opacity: timingOf(pair.opacity),
});

const PRIMITIVE = {
	enter: timingPair(primitiveRhythm),
	exit: timingPair(primitiveRhythm),
};

const DRAWER = {
	enter: timingPair(drawerEnterRhythm),
	exit: timingPair(drawerExitRhythm),
};

type PresenceRhythm = typeof PRIMITIVE;

/**
 * Maps the open state onto two progress axes and a mount lifetime.
 *
 * Why the mount is held here: @rn-primitives/* unmounts portal content as soon as open becomes
 * false. To show the closing motion, the mount has to be held past that point. The held value is
 * `mounted`. Primitives receive `mounted`, and callers keep passing their own `open`.
 *
 * Product state does not wait for this transition. onOpenChange fires on the frame of the press.
 * Only the moment the closed surface leaves the screen is delayed (see "motion describes state" in
 * docs/motion/ARCHITECTURE.md).
 *
 * Why two axes: with reduced motion on, travel snaps to its final value while fade still runs. With
 * a single axis, the surface would either appear with no fade, leaving it unclear what opened, or
 * the reduced-motion setting would be ignored entirely. The unmount callback is attached to fade,
 * because fade always has real duration under any setting.
 */
export type PrimitivePresence = {
	/** Whether to render now. Becomes false once the closing motion has finished. */
	mounted: boolean;
	/** Opacity progress, from 0 to 1. Keeps running under reduced motion. */
	fade: SharedValue<number>;
	/** Transform progress, from 0 to 1. Under reduced motion it jumps straight to the final value. */
	travel: SharedValue<number>;
};

function usePresence(open: boolean, rhythm: PresenceRhythm): PrimitivePresence {
	const [mounted, setMounted] = useState(open);
	const fade = useSharedValue(open ? 1 : 0);
	const travel = useSharedValue(open ? 1 : 0);

	useEffect(() => {
		if (open) setMounted(true);
	}, [open]);

	useEffect(() => {
		if (!mounted) return;
		const target = open ? 1 : 0;
		const timing = open ? rhythm.enter : rhythm.exit;
		travel.value = withTiming(target, timing.transform);
		fade.value = withTiming(target, timing.opacity, (finished) => {
			"worklet";
			if (finished && !open) runOnJS(setMounted)(false);
		});
	}, [fade, mounted, open, rhythm, travel]);

	return { mounted, fade, travel };
}

/** Used by dialogs, alert dialogs, dropdowns and sheets. All of them share the primitive scale. */
export function usePrimitivePresence(open: boolean): PrimitivePresence {
	return usePresence(open, PRIMITIVE);
}

/** Left-edge drawer. It uses its own scale; drawerEnterRhythm in rhythm.ts explains why. */
export function useDrawerPresence(open: boolean): PrimitivePresence {
	return usePresence(open, DRAWER);
}

/**
 * Dialog backdrop: only opacity moves. The backdrop covers the whole screen, so movement would be
 * noise. Same decision as web's backdropMotion.
 */
export function useBackdropStyle(presence: PrimitivePresence) {
	const { fade } = presence;
	return useAnimatedStyle(() => ({ opacity: fade.value }));
}

/**
 * Centered and bottom-anchored panels move the same way as on the web, in a different coordinate
 * system.
 *
 * The web's dialogMotion carries a -50% translate correction, a leftover from CSS centering with
 * left-1/2. Flexbox centers on its own, so that correction does not exist here. Browser
 * implementation traces are not copied over.
 *
 * Bottom-anchored panels also arrive with scale and opacity. They do not slide up by the full
 * screen height, which is sheet behavior. They settle quietly, like the same window on the web (the
 * header of dialog-placement.ts draws that line). Their travel is longer than a centered dialog's,
 * because on a full-width edge panel a move of only 8dp reads as a shake.
 */
export function useDialogPanelStyle(
	presence: PrimitivePresence,
	bottom: boolean,
) {
	const { fade, travel } = presence;
	const shift = bottom ? DIALOG_EDGE_SHIFT : 0;
	return useAnimatedStyle(() => ({
		opacity: fade.value,
		transform: [
			{ translateY: interpolate(travel.value, [0, 1], [shift, 0]) },
			{ scale: interpolate(travel.value, [0, 1], [POPUP_SCALE, 1]) },
		],
	}));
}

/**
 * Left-edge drawer: no scale.
 *
 * On a surface attached to the screen edge at full height, scale reads as "it got bigger". What the
 * surface needs to communicate is that it came from the left, which is also the web's judgment for
 * this case.
 *
 * The travel distance equals its own width for the same reason. It has to enter from off-screen, so
 * the movement reads as a return point.
 */
export function useDrawerPanelStyle(
	presence: PrimitivePresence,
	width: number,
) {
	const { fade, travel } = presence;
	return useAnimatedStyle(() => ({
		opacity: fade.value,
		transform: [{ translateX: interpolate(travel.value, [0, 1], [-width, 0]) }],
	}));
}

/**
 * Anchored menu: enters only. The missing exit is an intended platform difference.
 *
 * @rn-primitives/dropdown-menu's Root is uncontrolled. It does not accept open and keeps its own
 * state, so nothing can hold the menu while it closes. Even if something did, the primitive clears
 * the trigger's coordinates on close and Content returns null. There is no structural place to draw
 * an exiting surface. The web menu retreats 8px as it closes.
 *
 * There is no direction either. The primitive flips the menu up or down on its own to avoid
 * collisions but does not report the result. The only direction known is the one requested.
 * Animating from it would enter from the wrong side whenever the menu flipped. A guessed direction
 * is worse than none.
 *
 * What remains is opacity and a scale-in, on the same rhythm as the other primitives. The
 * difference is listed under intended differences in docs/motion/ARCHITECTURE.md.
 */
export const popupEnter = () => {
	"worklet";
	return {
		initialValues: { opacity: 0, transform: [{ scale: POPUP_SCALE }] },
		animations: {
			opacity: withTiming(1, PRIMITIVE.enter.opacity),
			transform: [{ scale: withTiming(1, PRIMITIVE.enter.transform) }],
		},
	};
};

/**
 * Check indicators in menus, entering only.
 *
 * The values match web's DropdownMenuCheckboxItem and RadioItem indicators: opacity 0.8 to 1, on
 * the primitive rhythm. There is no exit, for the same reason as the anchored menu: ItemIndicator
 * returns null the moment the check clears, leaving nothing to hold.
 *
 * Checked rows at open do not enter. Entering runs on every mount, so without a guard each check
 * would pop in when the menu opens and look like a fresh change. Web avoids this because Base UI
 * mounts without a starting state. Here the menu content uses LayoutAnimationConfig skipEntering to
 * get the same result (menu.tsx).
 */
export const menuIndicatorEnter = () => {
	"worklet";
	return {
		initialValues: {
			opacity: 0,
			transform: [{ scale: MENU_INDICATOR_SCALE }],
		},
		animations: {
			opacity: withTiming(1, PRIMITIVE.enter.opacity),
			transform: [{ scale: withTiming(1, PRIMITIVE.enter.transform) }],
		},
	};
};
