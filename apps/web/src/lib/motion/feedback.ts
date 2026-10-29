import { FEEDBACK_ENTER_Y } from "@rowcat/design";
import type { Transition } from "motion/react";
import { enterTransition, exitTransition } from "./transitions.ts";

/**
 * A rhythm for one line placed right beside an action: only three values. Same kind as
 * list-motion.ts, with the axis being what moves. That file handles identity-bearing rows
 * (conversations, drafts, comments). This one handles sentences without identity: failures,
 * cancellations, and notices that appear as the answer to something the user just pressed and
 * disappear when pressed again.
 * - Shared values: consumers grew past twenty. If each picked its own y offset, the same kind of
 *   event (my action failed) would land at a different distance on each screen.
 * - No FeedbackLine component: it would decide role='alert', color, size, and placement, and
 *   those differ per screen (cancellation is quiet gray; failure is destructive with role='alert').
 *   The shared piece is the rhythm, not the render.
 * - Target is a sentence with no link or button, so there is nothing to press while it exits and
 *   no press guard is needed. If a button or link is added, use rowExit plus useExitGuard()
 *   instead. Blurring that judgment here lets an already-removed action be pressed in a tab without
 *   frames.
 * - Not for sentences that position other content. When a leaving element positions something
 *   else, presence makes the shift arrive late and larger. So each site is the last flow child of
 *   its container. The test is 'last flow child', not 'last JSX node': a portal-owned dialog placed
 *   after does not take flow and pushes nothing.
 * - Case that hit this: an active-session sentence sat above the log-out-other-devices button.
 *   The button rose only after the sentence faded, and it stayed stuck in a tab without frames. The
 *   fix was order, not animation (sessions-section.tsx; account-layout.test.ts enforces the order).
 *   Giving that button block presence would only delay the shift, not remove it.
 */

/**
 * The vertical enter distance in px. The value comes from @rowcat/design; page-enter.ts has the
 * basis for it at the same spot. Re-exported, so this file's public shape is unchanged.
 */
export { FEEDBACK_ENTER_Y };

/**
 * Entering sentence. Unlike the list, initial also plays on the first render. A sentence like this
 * is created only after the screen has arrived, and the server never supplies a value for it, so
 * there is no first-render case to suppress.
 */
export const feedbackEnter = {
	initial: { opacity: 0, y: FEEDBACK_ENTER_Y },
	animate: { opacity: 1, y: 0 },
	transition: enterTransition satisfies Transition,
} as const;

/**
 * Leaving sentence, with no movement. Movement on the exit would mix direction with the items
 * flowing to fill its place (same reason as rowExit). It is also faster than entering: the arrival
 * must be read, but there is no reason to watch a sentence leave.
 */
export const feedbackExit = {
	opacity: 0,
	transition: exitTransition satisfies Transition,
} as const;
