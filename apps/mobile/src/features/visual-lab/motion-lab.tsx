import { space } from "@rowcat/design";
import { VISUAL_LAB_MOTION } from "@rowcat/design/visual-lab";
import { Badge, Button, Text } from "@rowcat/ui-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { AnimatedLabel } from "../../lib/motion/animated-label.tsx";
import { FeedbackLine } from "../../lib/motion/feedback.tsx";

/**
 * Motion QA lab: deterministically rebuilds broken transitions and the lifetime of exits.
 *
 * ## Why product screens cannot measure this
 *
 * The consumers of `AnimatedLabel` and `FeedbackLine` are all behind sign-in (the published-work
 * visibility badge, sign-in method linking, provider connections, my reports, and six account
 * sections). Without a session those screens do not open, so these two cases were recorded twice as
 * "not measured" in the ledger. Waiting for account state to line up by chance is not a plan.
 *
 * Even with an account there is one more problem. An interrupted transition is defined by an
 * interval (the next value arrives before the previous transition ends), and pressing with a finger
 * twice does not control that interval. Here a timer does.
 *
 * ## Draws the product primitives, not copies
 *
 * What is mounted here is the files in `lib/motion/`. A lab copy would prove the copy rather than
 * the product, and the copy would quietly go stale (`visual-lab-boundaries.test.ts` pins this by
 * name).
 *
 * ## What the screen is for
 *
 * ```text
 * word       does a word that never appeared during the interrupted transition pop out?
 * feedback   when does the outgoing sentence yield its place: when does the sibling below rise?
 * ```
 *
 * Both cases place a sibling beside or below. Without it the geometry does not appear on screen,
 * and only opacity would be visible.
 *
 * ## Not reachable in release
 *
 * The route (`app/visual-lab.tsx`) returns to the first screen in release builds. This file sits
 * behind that route, so it has no guard of its own; guards written in two places eventually
 * disagree.
 */
export function MotionLab() {
	const { labels } = VISUAL_LAB_MOTION;
	const [label, setLabel] = useState<string>(labels.a);
	const [feedback, setFeedback] = useState(false);

	/**
	 * Scheduled timers, all cleared on unmount. Left alive, they would call `setState` after the lab
	 * is left, producing warnings that fill the log while frames are being read.
	 */
	const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
	useEffect(
		() => () => {
			for (const timer of timers.current) clearTimeout(timer);
			timers.current = [];
		},
		[],
	);

	/**
	 * Sets the previous value first, then the next value after the given delay. The first value is set
	 * here rather than in an effect: scheduling both in one timer would make the interval between them
	 * depend on scheduler timing.
	 */
	const interrupt = (next: string, delay: number) => {
		setLabel(labels.b);
		timers.current.push(setTimeout(() => setLabel(next), delay));
	};

	return (
		<View style={motion.root}>
			<Text variant="caption" tone="muted-foreground">
				AnimatedLabel
			</Text>
			{/**
			 * A fixed word beside it: when the word's width changes, this text moves. That movement is what
			 * the word-geometry measurement reads.
			 */}
			<View style={motion.inline}>
				<AnimatedLabel value={label}>
					<Badge label={label} variant="secondary" />
				</AnimatedLabel>
				<Text variant="caption" tone="muted-foreground">
					{VISUAL_LAB_MOTION.feedbackSibling}
				</Text>
			</View>
			<View style={motion.row}>
				<Button
					label={labels.a}
					variant="outline"
					size="sm"
					onPress={() => setLabel(labels.a)}
				/>
				<Button
					label={labels.b}
					variant="outline"
					size="sm"
					onPress={() => setLabel(labels.b)}
				/>
				<Button
					label={labels.c}
					variant="outline"
					size="sm"
					onPress={() => setLabel(labels.c)}
				/>
			</View>
			<View style={motion.row}>
				<Button
					label="rapid B→A"
					variant="outline"
					size="sm"
					onPress={() => interrupt(labels.a, VISUAL_LAB_MOTION.interruptMs)}
				/>
				<Button
					label="rapid B→C"
					variant="outline"
					size="sm"
					onPress={() => interrupt(labels.c, VISUAL_LAB_MOTION.interruptMs)}
				/>
				<Button
					label="late B→C"
					variant="outline"
					size="sm"
					onPress={() => interrupt(labels.c, VISUAL_LAB_MOTION.lateInterruptMs)}
				/>
			</View>

			<Text variant="caption" tone="muted-foreground">
				FeedbackLine
			</Text>
			{/**
			 * The sentence and the **sibling below** share one vertical flow. An exit's lifetime is observable
			 * only by when this sibling rises; opacity alone looks the same on both platforms.
			 */}
			<View style={motion.stack}>
				{feedback ? (
					<FeedbackLine>
						<Text variant="body" tone="destructive">
							{VISUAL_LAB_MOTION.feedback}
						</Text>
					</FeedbackLine>
				) : null}
				<Text variant="body">{VISUAL_LAB_MOTION.feedbackSibling}</Text>
			</View>
			<View style={motion.row}>
				<Button
					label="show"
					variant="outline"
					size="sm"
					onPress={() => setFeedback(true)}
				/>
				<Button
					label="hide"
					variant="outline"
					size="sm"
					onPress={() => setFeedback(false)}
				/>
			</View>
		</View>
	);
}

const motion = StyleSheet.create({
	root: { gap: space.sm },
	row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
	/** The word and the glyph beside it share a baseline; a width change shows on this line. */
	inline: { alignItems: "center", flexDirection: "row", gap: space.sm },
	/** Sentence and sibling below: no gap, so the handover of space shows as it is. */
	stack: { gap: 0 },
});
