import {
	COUNT_ROLL_SHIFT,
	type CountRollCadence,
	type CountRollDirection,
	countRollCells,
	countRollDirection,
	countRollHasTime,
} from "@rowcat/design";
import { Text, type TextVariant } from "@rowcat/ui-native";
import { type ComponentProps, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { withTiming } from "react-native-reanimated";
import {
	continuousEnterTransition,
	continuousExitTransition,
	enterTransition,
	exitTransition,
	type NativeTransition,
} from "./transitions.ts";

/**
 * A number whose changed digits roll; the same rule and values as web's `AnimatedCount`.
 *
 * Digit placement, direction and distance come from `@rowcat/design`, which web calls too. This
 * file only draws; re-deriving the rule here would roll the same number in different directions on
 * two screens.
 *
 * - Formatting belongs to the caller. It receives the glyphs to draw, not a `number`, because
 *   each consumer formats differently (metric, `n/max`, `m:ss`). Separators and `:` never roll.
 * - A number that mounts does not roll: there is no previous value, so rolling would imply a
 *   change that never happened.
 * - No intermediate digits are invented. A cell only knows the previous and current glyph. Screen
 *   readers get the current number as one hidden text node; the digit cells are hidden.
 * - It is not a live region. The change is usually the result of an action the user just took,
 *   and the button already announces it.
 */

const CADENCE: Record<
	CountRollCadence,
	{ in: NativeTransition; out: NativeTransition }
> = {
	default: { in: enterTransition, out: exitTransition },
	continuous: { in: continuousEnterTransition, out: continuousExitTransition },
};

/**
 * Incoming glyph: rises from below when the number grows, drops from above when it shrinks. The
 * distance is in `%` because this component is used at several font sizes; a fixed dp would read
 * too large only on the small ones.
 */
function rollIn(direction: CountRollDirection, cadence: CountRollCadence) {
	const shift: `${number}%` = `${direction * COUNT_ROLL_SHIFT[cadence]}%`;
	const rhythm = CADENCE[cadence].in;
	return () => {
		"worklet";
		return {
			initialValues: { opacity: 0, transform: [{ translateY: shift }] },
			animations: {
				opacity: withTiming(1, rhythm.opacity),
				transform: [{ translateY: withTiming("0%", rhythm.transform) }],
			},
		};
	};
}

/**
 * Outgoing glyph: faster than the incoming one and flowing in the **same direction**. Both glyphs
 * share one cell at the same time, so opposite directions would cross each other; flowing together
 * reads as one glyph handing its place to the next.
 */
function rollOut(direction: CountRollDirection, cadence: CountRollCadence) {
	const shift: `${number}%` = `${-direction * COUNT_ROLL_SHIFT[cadence]}%`;
	const rhythm = CADENCE[cadence].out;
	return () => {
		"worklet";
		return {
			initialValues: {
				opacity: 1,
				transform: [{ translateY: "0%" as `${number}%` }],
			},
			animations: {
				opacity: withTiming(0, rhythm.opacity),
				transform: [{ translateY: withTiming(shift, rhythm.transform) }],
			},
		};
	};
}

/**
 * The two worklets of one branch. They are not merged into one type because their shapes differ:
 * the enter worklet ends at `opacity` 1 and the exit worklet ends at 0.
 */
type Roll = {
	enter: ReturnType<typeof rollIn>;
	exit: ReturnType<typeof rollOut>;
};

/**
 * The four branches (rhythm × direction) are built once, when the module loads. Building them per
 * render made Reanimated serialize two new worklets to the UI thread on every change. The output
 * looks identical, and the cost only mattered on per-keystroke counters.
 *
 * Measured on this app, that cost was not the cause of keystroke lag (a search field without a
 * counter ran at the same frame interval on the same device; see the runtime QA in
 * `docs/motion/ARCHITECTURE.md`). The table is kept because it loses nothing: four branches, and
 * neither the values nor the choreography changed.
 */
const ROLL: Record<CountRollCadence, Record<"1" | "-1", Roll>> = {
	default: {
		"1": { enter: rollIn(1, "default"), exit: rollOut(1, "default") },
		"-1": { enter: rollIn(-1, "default"), exit: rollOut(-1, "default") },
	},
	continuous: {
		"1": { enter: rollIn(1, "continuous"), exit: rollOut(1, "continuous") },
		"-1": { enter: rollIn(-1, "continuous"), exit: rollOut(-1, "continuous") },
	},
};

export function AnimatedCount({
	value,
	cadence = "default",
	variant = "body",
	tone = "foreground",
	weight,
	readable = true,
}: {
	/** The glyphs to draw, as-is. The caller has already added any digit grouping. */
	value: string;
	/**
	 * How often this number changes. Most callers describe a one-off change, so the default is
	 * `"default"`; only values that change every second or every keystroke pass `"continuous"`.
	 */
	cadence?: CountRollCadence;
	/** Text hierarchy. Placement is set by the wrapper (web's `className` plays this role). */
	variant?: TextVariant;
	/** Text color, using `Text`'s vocabulary; this file does not pick colors. */
	tone?: ComponentProps<typeof Text>["tone"];
	/**
	 * Font weight. It sits on the same axis as `variant` and `tone`: the caller's value goes straight
	 * to `Text`.
	 *
	 * Web has no such prop: there the rolling number is inline and inherits `font-black` from the
	 * wrapping `<dd>`, while native text styles do not pass through `View`. Without it, a creator's
	 * metric total would render thinner than the per-work rows beneath it.
	 */
	weight?: ComponentProps<typeof Text>["weight"];
	/**
	 * Whether this number must be read by assistive tech on its own.
	 *
	 * Defaults to true: a standalone number has to be announced. Set false only when the wrapping
	 * control already names the number in its `accessibilityLabel`; announcing it again would read it
	 * twice.
	 */
	readable?: boolean;
}) {
	/**
	 * State here is the **previously drawn value**, not the total. The total still belongs to the
	 * query cache; this component only notices after the fact that the value changed. Optimistic
	 * updates and their rollbacks both arrive as "the value changed", so a reverse change rolls
	 * backward without a separate animation.
	 */
	const [shown, setShown] = useState({
		value,
		previous: value,
		/** When the value last changed. Mounting is not a change, so it starts at "long ago". */
		changedAt: Number.NEGATIVE_INFINITY,
	});
	if (shown.value !== value) {
		/**
		 * Bursts of changes are not rolled. This matches web's judgment (`countRollHasTime`): when the
		 * next value arrives sooner than a digit can finish, the cell would keep remounting transparent.
		 * The clock is only read in the render where the value has already changed.
		 */
		const now = Date.now();
		const hasTime = countRollHasTime(now - shown.changedAt, cadence);
		setShown({
			value,
			previous: hasTime ? shown.value : value,
			changedAt: now,
		});
	}

	const direction = countRollDirection(shown.previous, shown.value);
	const cells = countRollCells(shown.previous, shown.value);
	/** The identity must stay the same across renders so Reanimated recognizes the same worklet (see `ROLL`). */
	const { enter, exit: leave } = ROLL[cadence][direction === 1 ? "1" : "-1"];

	return (
		<View
			accessibilityElementsHidden={!readable}
			importantForAccessibility={readable ? "auto" : "no-hide-descendants"}
			style={count.row}
		>
			<View
				/**
				 * The digit cells are absent from the accessibility tree. Each is its own box, so assistive
				 * tech would read them one by one; the hidden text below is read instead.
				 */
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={count.row}
			>
				{cells.map((cell) => (
					/**
					 * Each cell clips its own glyph. Clipping once on the outside would change the box width
					 * whenever the digit count changes, and the clip edge would move mid-roll.
					 */
					<View key={cell.key} style={count.cell}>
						{/**
						 * The outgoing glyph is outside flow, so only the incoming glyph sets the
						 * width; with both in flow, the cell would double. A newly added digit
						 * (the `1` in `9 → 10`) has no outgoing glyph.
						 */}
						{cell.changed && cell.previous !== "" ? (
							<Animated.View
								key={`out:${cell.previous}`}
								style={count.leaving}
								entering={leave}
							>
								<Text
									variant={variant}
									tone={tone}
									weight={weight}
									style={count.figure}
								>
									{cell.previous}
								</Text>
							</Animated.View>
						) : null}
						<Animated.View
							key={`in:${cell.character}`}
							entering={cell.changed ? enter : undefined}
						>
							<Text
								variant={variant}
								tone={tone}
								weight={weight}
								style={count.figure}
							>
								{cell.character}
							</Text>
						</Animated.View>
					</View>
				))}
			</View>
			{/** What screen readers announce; it takes no space on screen. */}
			{readable ? (
				<Text
					variant={variant}
					tone={tone}
					weight={weight}
					style={count.reader}
				>
					{shown.value}
				</Text>
			) : null}
		</View>
	);
}

const count = StyleSheet.create({
	row: { alignItems: "center", flexDirection: "row" },
	cell: { overflow: "hidden" },
	leaving: { ...StyleSheet.absoluteFill, alignItems: "center" },
	/**
	 * Every digit needs the same width so overlapping glyphs stay aligned; this is web's
	 * `tabular-nums`. It sets letter spacing rather than size, so it is independent of hierarchy.
	 */
	figure: { fontVariant: ["tabular-nums"] },
	/**
	 * Invisible on screen but kept in the accessibility tree. Neither `display: none` nor `width: 0`,
	 * because either would also remove it from assistive tech.
	 */
	reader: { height: 0, opacity: 0, width: 0 },
});
