import { LABEL_SWAP_SCALE } from "@rowcat/design";
import type { Transition } from "motion/react";
import { enterTransition, exitTransition } from "./transitions.ts";

/**
 * Rhythm for a word that swaps in place. Sibling of icon-swap.ts and count-roll.ts; the axis is
 * what changes (number, picture, word). The trigger is direct feedback: the same badge changes its
 * own content, so the sentence it conveys is that the same badge reached another state, not that
 * one badge left and another appeared.
 *
 * There are five consumers, including the published-work exposure badge, the login and AI-provider
 * connection badges, the report-status badge and the follow-button label. Per- screen scale choices
 * would make the same event arrive with different weights.
 *
 * No component is made here. The boundary is the same as feedback.ts: a render would decide the
 * variant, color, role and placement, which each screen must decide itself (the eligibility badge
 * is default or secondary, the exposure badge is one of three). icon-swap.ts does have components,
 * because its two glyphs must overlap in one grid cell. That overlap is not used here.
 *
 * The words have different lengths, so overlapping them would stretch the box to the longer width
 * and back, and badge text cannot be hidden from assistive tech. Callers wrap the swap in
 * AnimatePresence mode="wait", so the incoming word mounts only after the outgoing one has left.
 *
 * Durations are not set here: the same two transitions as icon-swap.ts and count-roll.ts, with the
 * token source in @rowcat/design.
 */

/**
 * How much the swapping word shrinks. The value comes from @rowcat/design (same place as
 * page-enter.ts). Re-exported, so this file's public shape is unchanged.
 */
export { LABEL_SWAP_SCALE };

/**
 * Incoming word.
 *
 * No rotation. In icon-swap.ts the 8 degrees tell the eye that two pictures share an axis. Tilted
 * letters only get harder to read and explain nothing.
 *
 * No vertical movement either. This indicator was already in place, so movement would read as newly
 * attached. The attach-and-detach rhythm belongs to feedback.ts.
 */
export const labelSwapIn = {
	initial: { opacity: 0, scale: LABEL_SWAP_SCALE },
	animate: { opacity: 1, scale: 1 },
	transition: enterTransition satisfies Transition,
} as const;

/**
 * Outgoing word. It is faster than the incoming one.
 *
 * Readers need to know what arrived, not watch the word that leaves. Because this rhythm pairs with
 * mode="wait", the duration is also how long the new word waits, which is a second reason to keep
 * it short.
 */
export const labelSwapOut = {
	opacity: 0,
	scale: LABEL_SWAP_SCALE,
	transition: exitTransition satisfies Transition,
} as const;
