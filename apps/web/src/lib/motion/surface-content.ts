import type { Transition } from "motion/react";
import { enterTransition, exitTransition } from "./transitions.ts";

/**
 * Content of a surface whose geometry has already changed. It arrives and leaves with opacity only.
 *
 * Sibling of list-motion.ts and feedback.ts. Those two use a few pixels of movement to say
 * 'appeared here', but the target here is a surface whose area is already placed: a bottom panel
 * opens, a quick-open result empties, an editor's name tag becomes another file's. That surface's
 * geometry changes instantly (see the height-animation item in docs/motion/ARCHITECTURE.md), and
 * the content arrives inside it with opacity only. Any movement would make letters move inside an
 * already placed box, reading as two events.
 *
 * Values are shared because the first consumers are six spots in the runtime studio: bottom panel
 * content, the Problems list versus its empty state, the empty sentence after filtering, the
 * quick-open empty sentence, the editor's empty state, and the name tag. If each spot wrote {
 * opacity: 0 } with its own time, the same event would arrive at different weights. The auto-sync
 * sentence in sync-section.tsx already hand-writes the same shape.
 *
 * No component is made, for the same reason as feedback.ts: a render would decide role, placement
 * and tag, which each of the six spots decides for itself.
 *
 * Durations are not set here: the same two transitions as the other rhythms, with the token source
 * in @rowcat/design.
 *
 * No reduced-motion handling. With no transforms there is nothing for MotionConfig to strip.
 * Opacity still flows in that setting, and the moment of the state change is the same either way.
 */

/**
 * Initial state for entering content. Whether the first render skips it is decided by the component
 * that draws it (under AnimatePresence initial={false}, or in a conditionally mounted slot). Only
 * the values live here.
 */
export const contentEnter = {
	initial: { opacity: 0 },
	animate: { opacity: 1 },
	transition: enterTransition satisfies Transition,
} as const;

/**
 * Leaving content, faster than entering. It is used only where mutually exclusive contents share
 * one slot, paired with mode="wait" (the Problems list versus the empty state).
 *
 * Where a sibling inherits the slot below, there is no exit. The moment that sentence goes away,
 * users need to see what fills the slot next, and an exit would delay that by 120 ms (see 'a
 * sentence that decides position only enters' in docs/motion/ARCHITECTURE.md).
 */
export const contentExit = {
	opacity: 0,
	transition: exitTransition satisfies Transition,
} as const;
