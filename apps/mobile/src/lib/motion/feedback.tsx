import { FEEDBACK_ENTER_Y } from "@rowcat/design";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { withTiming } from "react-native-reanimated";
import { enterTransition, exitTransition } from "./transitions.ts";

/**
 * Rhythm for a one-line message that appears and disappears right next to an action. Same values as
 * web's `feedback.ts`.
 *
 * ```text
 * enter   opacity 0 → 1 · translateY 4 → 0 · normal · enter
 * exit    opacity → 0 · **no movement** · fast · exit
 * ```
 *
 * The target is an identity-free **sentence**: a failure, cancellation or hint that appears as the
 * answer to something the user just pressed and vanishes on the next press. Lines that carry an
 * identity (conversations, drafts, sessions, passkeys) use `list-motion.tsx`; the axis that
 * separates them is what moves.
 *
 * - No movement on exit. A moving exit would mix direction with the siblings flowing to fill its
 *   space, and it is faster than entry: the arrival has to be read, the disappearing line does not.
 * - This wrapper owns only the rhythm. Web passes three values and the caller wraps the element
 *   in `AnimatePresence`. Native has no presence, so mount condition is the presence: Reanimated's
 *   `exiting` keeps the node mounted until it finishes.
 * - No component such as `<FeedbackLine error={…} />`. That would make this file decide color,
 *   type size, `accessibilityRole` and placement, which belong to each screen (cancellation is
 *   quiet gray rather than an error; failure is `destructive` with `role="alert"`). Only the rhythm
 *   is shared, which is the same boundary web draws.
 * - Do not use it for a line that positions other content. If the leaving element sets the
 *   position of something beneath it, the presence finishes late and the content jumps (the content
 *   below moves up **after** the exit ends). The test is whether a sibling below inherits its
 *   position from this line; if it does, fix the order instead of this rhythm.
 */

const feedbackEnter = () => {
	"worklet";
	return {
		initialValues: {
			opacity: 0,
			transform: [{ translateY: FEEDBACK_ENTER_Y }],
		},
		animations: {
			opacity: withTiming(1, enterTransition.opacity),
			transform: [{ translateY: withTiming(0, enterTransition.transform) }],
		},
	};
};

const feedbackExit = () => {
	"worklet";
	return {
		initialValues: { opacity: 1 },
		animations: { opacity: withTiming(0, exitTransition.opacity) },
	};
};

/**
 * Wraps a message that appears and disappears. **The caller decides whether it is mounted.**
 *
 * It takes no `visible` argument on purpose. Such an argument would make this wrapper know what
 * shows the sentence, and then it would collect conditions. The caller already has the answer as
 * `error ? <FeedbackLine>…</FeedbackLine> : null`.
 */
export function FeedbackLine({
	children,
	style,
}: {
	children: ReactNode;
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<Animated.View
			style={style}
			entering={feedbackEnter}
			exiting={feedbackExit}
		>
			{children}
		</Animated.View>
	);
}
