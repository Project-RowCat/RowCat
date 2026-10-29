import { ICON_SWAP_ROTATE, ICON_SWAP_SCALE } from "@rowcat/design";
import { type ReactNode, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { withTiming } from "react-native-reanimated";
import { enterTransition, exitTransition } from "./transitions.ts";

/**
 * One glyph inside a control swaps for another. Same values as web's `AnimatedIconSwap`.
 *
 * ```text
 * enter   opacity 0 → 1 · scale 0.8 → 1 · rotate -8 → 0 · normal · enter
 * exit    opacity → 0 · scale → 0.8 · rotate → +8 · fast · exit
 * ```
 *
 * This is direct feedback, not a presence. The control stays mounted and changes its own state, so
 * the rhythm says one thing: the same object became another state, not one button replaced another.
 *
 * - No second source of truth. The swap happens when `stateKey` changes, and that value is
 *   derived from facts the app already holds (`generating ? "stop" : "send"`). There is no
 *   completion callback: swapping is a render concern, and clipboard writes or stop requests do not
 *   wait for the transition.
 * - The box does not change size. The swapping glyphs are absolutely positioned, and a hidden
 *   copy of the content sets the size. Both glyphs in flow would double the box while they overlap;
 *   both out of flow would collapse it to zero and hide the icon; measuring once would depend on
 *   frames that may be zero off-screen. The copy is `opacity: 0` and hidden from the accessibility
 *   tree. This is what lets the component sit inside virtualized conversation rows: only opacity
 *   and transforms move, and neither affects measured height.
 * - No motion on first mount. `entering` runs on mount, and this box mounts with its screen, so
 *   the first glyph would animate in by itself when the screen arrives. The first render therefore
 *   skips the entrance (web's `AnimatePresence initial={false}` does the same).
 * - Assistive tech sees only the decorative glyph. While swapping, two glyphs exist together, so
 *   any named image would give the control two names at once. The control's accessible name comes
 *   from the outer element and changes with the state in the same render, independent of motion.
 */

const swapIn = () => {
	"worklet";
	return {
		initialValues: {
			opacity: 0,
			transform: [
				{ scale: ICON_SWAP_SCALE },
				{ rotate: `${-ICON_SWAP_ROTATE}deg` },
			],
		},
		animations: {
			opacity: withTiming(1, enterTransition.opacity),
			transform: [
				{ scale: withTiming(1, enterTransition.transform) },
				{ rotate: withTiming("0deg", enterTransition.transform) },
			],
		},
	};
};

/**
 * A quietly entering glyph: **opacity only.**
 *
 * It has one use: the "copied" indicator reverting after a timer. That change is not a reply to
 * something the user pressed, so giving it the same weight as the press would read as a second
 * success.
 */
const quietIn = () => {
	"worklet";
	return {
		initialValues: { opacity: 0 },
		animations: { opacity: withTiming(1, exitTransition.opacity) },
	};
};

/**
 * Outgoing glyph: faster than the incoming one. Both occupy the same spot, so they overlap briefly;
 * the overlap has to be short or the two pictures look side by side.
 */
const swapOut = () => {
	"worklet";
	return {
		initialValues: {
			opacity: 1,
			transform: [{ scale: 1 }, { rotate: "0deg" }],
		},
		animations: {
			opacity: withTiming(0, exitTransition.opacity),
			transform: [
				{ scale: withTiming(ICON_SWAP_SCALE, exitTransition.transform) },
				{
					rotate: withTiming(
						`${ICON_SWAP_ROTATE}deg`,
						exitTransition.transform,
					),
				},
			],
		},
	};
};

export function AnimatedIconSwap({
	stateKey,
	quiet = false,
	children,
}: {
	/**
	 * Which glyph is showing. Derived from a value the app already holds; the moment it changes is the
	 * moment the swap happens.
	 */
	stateKey: string;
	/**
	 * Whether this change is **not** a reply to a press. Only the "copied" indicator reverting after a
	 * timer sets it.
	 */
	quiet?: boolean;
	children: ReactNode;
}) {
	/**
	 * **No entrance on the first render.** Reanimated's `entering` runs on mount, and this box mounts
	 * with its screen, so the first glyph would be affected; an icon floating in by itself on arrival
	 * would look like an action the user never took.
	 *
	 * The ref is read during render on purpose. An effect would change the value after the first
	 * frame's decision has passed; state would re-render this box. Computing it twice gives the same
	 * answer (true only on the first render), so StrictMode does not diverge.
	 */
	const first = useRef(true);
	const entering = first.current ? undefined : quiet ? quietIn : swapIn;
	first.current = false;

	return (
		<View
			/**
			 * `aria-hidden` on both platforms: iOS reads the first prop, Android the second. Setting only
			 * one leaks both glyph names on the other platform.
			 */
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={swap.box}
		>
			{/** The copy that sets the size. Invisible and does not receive touches. */}
			<View pointerEvents="none" style={swap.sizer}>
				{children}
			</View>
			<Animated.View
				key={stateKey}
				style={swap.layer}
				entering={entering}
				exiting={swapOut}
			>
				{children}
			</Animated.View>
		</View>
	);
}

const swap = StyleSheet.create({
	box: { alignItems: "center", justifyContent: "center" },
	sizer: { opacity: 0 },
	layer: {
		alignItems: "center",
		justifyContent: "center",
		...StyleSheet.absoluteFill,
	},
});
