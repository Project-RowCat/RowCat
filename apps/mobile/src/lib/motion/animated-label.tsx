import { LABEL_SWAP_SCALE } from "@rowcat/design";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native";
import Animated, {
	interpolate,
	useAnimatedStyle,
	useSharedValue,
	withSequence,
	withTiming,
} from "react-native-reanimated";
import { enterTransition, exitTransition } from "./transitions.ts";

/**
 * In-place word swap rhythm: the same values and order as web's `label-swap.ts`.
 *
 * ```text
 * 0 … 120ms    outgoing word   opacity 1 → 0 · scale 1 → 0.96 · exit
 * 120ms        the occupied width changes here, when both words are transparent
 * 120 … 300ms  incoming word   opacity 0 → 1 · scale 0.96 → 1 · enter
 * ```
 *
 * No rotation or vertical motion: rotation would suggest the two glyphs share an axis (see
 * `animated-icon-swap.tsx`), and tilted text just reads worse. The scale is shallow (0.96, not the
 * icon's 0.8) because the target is text; 0.8 would make the badge look like it pops forward.
 *
 * - The words never overlap: the incoming word appears only after the outgoing one is fully gone.
 * - The sequence runs entirely on the UI thread through one shared value (`withSequence`).
 *   Chaining it with `runOnJS` and a React state update put JS scheduling in the middle of the
 *   transition, which on device stalled the badge at an empty box for about 400ms.
 * - Geometry follows the same order, and the margin moves, not the width. A width animation fails
 *   because text laid out in a narrow box is not re-laid-out when the box widens, which clips the
 *   word. So the box always takes its natural width, and only the occupied space changes, in one
 *   step at the split:
 *
 * ```text
 * fade < SPLIT   marginEnd = outgoing width − incoming width    occupied space = the outgoing width
 * fade ≥ SPLIT   marginEnd = 0                                  the moment web hands over the presence
 * ```
 *
 * A shrinking word gets a positive margin, holding its space; a growing word gets a negative one,
 * so it does not claim space early and overflows transparently. The whole decision is in the
 * worklet, so the split needs no `runOnJS` or `setState`.
 * - One frame of accepted error: the incoming width is known only after layout (`onLayout`), so
 *   during the first frame the two widths match and the margin is 0, and the neighbour moves about
 *   16ms early. Animating the width instead would remove that but clip the text, which is the worse
 *   trade.
 * - The width is measured once per word change and written to a ref and a shared value, so it
 *   adds no renders.
 *
 * ## First mount is quiet
 *
 * A badge drawn for the first time has no previous word. Rolling it in would imply a change that
 * never happened (`animated-count.tsx` makes the same call).
 *
 * ## State still lives here, but only display state
 *
 * `track` holds the word to draw now and the node last committed. The source of truth is still the
 * caller's `value`; this state only decides what to place in the outgoing slot. The moment of the
 * swap is now owned by the shared value.
 */

/**
 * The split between the two phases, as a fraction of the total duration taken by the outgoing one.
 * Milliseconds are not written here so the value has a single source; if a token changes, this
 * ratio follows.
 */
const SPLIT =
	exitTransition.durationMs /
	(exitTransition.durationMs + enterTransition.durationMs);

export function AnimatedLabel({
	value,
	children,
}: {
	/**
	 * Which word is showing, derived from a value the app already holds (`visibility`, `connected`).
	 * The moment this changes is the moment the swap happens.
	 */
	value: string;
	/**
	 * The node that draws the word. **This file knows nothing about the badge's `variant`, color or
	 * `role`.** Those are per-screen decisions; only the rhythm is shared (same boundary as
	 * `feedback.tsx`).
	 */
	children: ReactNode;
}) {
	/**
	 * The node from the last commit, written only in an effect so that discarded renders do not push
	 * it forward. Writing it during render would overwrite the previous node with the current one
	 * under StrictMode's double render.
	 */
	const committed = useRef<ReactNode>(children);

	/**
	 * The word's width from the last commit. The outgoing layer needs it so it is not squeezed by the
	 * new width. Undefined until measured; the outgoing layer then fills the parent's width, as
	 * before.
	 */
	const width = useRef<number | undefined>(undefined);

	const [track, setTrack] = useState<{
		value: string;
		leaving: { value: string; node: ReactNode; width?: number } | null;
	}>({ value, leaving: null });

	/**
	 * Adjusted during render. Deferring to an effect would seat the new word one frame before the
	 * transition starts, so the swap would be visible twice.
	 */
	if (track.value !== value)
		setTrack({
			value,
			leaving: {
				value: track.value,
				node: committed.current,
				width: width.current,
			},
		});

	useEffect(() => {
		committed.current = children;
	});

	/** Opacity still flows under reduced motion; scale jumps straight to its final value (`transitions.ts`). */
	const fade = useSharedValue(1);
	const shrink = useSharedValue(1);
	/** Width the current word occupies; written each time layout finishes. */
	const arriving = useSharedValue(0);
	/** Width of the outgoing word; written once when a transition starts. */
	const leaving = useSharedValue(0);

	/**
	 * Does not cause a render. The value is read once when the next transition starts and otherwise
	 * only feeds the margin calculation.
	 */
	const measure = (event: LayoutChangeEvent) => {
		const measured = event.nativeEvent.layout.width;
		width.current = measured;
		arriving.value = measured;
	};

	/**
	 * **The `useLayoutEffect` is what makes the order work.** The incoming layer's `onLayout` is sent
	 * by the native side after commit, so it arrives after this effect. `fade` goes to 0 first, and
	 * the new width that arrives later is applied to the margin right away. With a plain `useEffect`
	 * the two would reorder and the margin would settle a frame late.
	 */
	useLayoutEffect(() => {
		/**
		 * **Does nothing on first mount**, because there is no outgoing word; that fact is the whole
		 * check. There is no separate `first` ref, since stating the same fact twice lets one copy
		 * eventually disagree with the other.
		 */
		if (!track.leaving) return;
		/** Freeze the outgoing width first; the clocks start after that. */
		leaving.value = track.leaving.width ?? arriving.value;
		/**
		 * The two axes each run their own sequence. They cannot be merged because reduced motion answers
		 * differently for each (`transitions.ts`): merged, the word would either swap with no blink under
		 * that setting, or ignore the setting.
		 *
		 * Each axis sets its start value first and then runs the animation. A transition in progress is
		 * dropped and the new pair starts from that point; swap requests are not queued.
		 */
		fade.value = 0;
		fade.value = withSequence(
			withTiming(SPLIT, exitTransition.opacity),
			withTiming(1, enterTransition.opacity),
		);
		shrink.value = 0;
		shrink.value = withSequence(
			withTiming(SPLIT, exitTransition.transform),
			withTiming(1, enterTransition.transform),
		);
	}, [track, fade, shrink, leaving, arriving]);

	/**
	 * Occupied space. **Not interpolated:** it changes once, at the split, which is the same event as
	 * web handing over the presence. It is a margin rather than a width for the reason in the header:
	 * narrowing the width would clip the text inside.
	 */
	const spaceStyle = useAnimatedStyle(() => ({
		marginEnd: fade.value < SPLIT ? leaving.value - arriving.value : 0,
	}));

	const leavingStyle = useAnimatedStyle(() => ({
		opacity: interpolate(fade.value, [0, SPLIT], [1, 0], "clamp"),
		transform: [
			{
				scale: interpolate(
					shrink.value,
					[0, SPLIT],
					[1, LABEL_SWAP_SCALE],
					"clamp",
				),
			},
		],
	}));

	const arrivingStyle = useAnimatedStyle(() => ({
		opacity: interpolate(fade.value, [SPLIT, 1], [0, 1], "clamp"),
		transform: [
			{
				scale: interpolate(
					shrink.value,
					[SPLIT, 1],
					[LABEL_SWAP_SCALE, 1],
					"clamp",
				),
			},
		],
	}));

	return (
		<Animated.View style={[label.box, spaceStyle]}>
			{track.leaving ? (
				<Animated.View
					/**
					 * The outgoing word is **outside** flow: only the incoming word may set the box width. It
					 * takes no touches and carries `aria-hidden` on both platforms; setting only one would make
					 * the word read twice on the other.
					 */
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					pointerEvents="none"
					style={[label.leaving, { width: track.leaving.width }, leavingStyle]}
				>
					{track.leaving.node}
				</Animated.View>
			) : null}
			<Animated.View onLayout={measure} style={arrivingStyle}>
				{children}
			</Animated.View>
		</Animated.View>
	);
}

const label = StyleSheet.create({
	/** Only the incoming word takes part in flow. */
	box: { alignItems: "flex-start" },
	/**
	 * Not `absoluteFill`, which stretches to fill the box.
	 *
	 * Fixing coordinates alone is not enough: **the parent still sets the width** (Yoga gives
	 * out-of-flow children the parent's width to measure against). So the measured width is applied
	 * too; without it, `Private` would be squeezed to `Pri…` by the width of `Public`.
	 */
	leaving: { left: 0, position: "absolute", top: 0 },
});
