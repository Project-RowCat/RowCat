import { ICON_SWAP_ROTATE, ICON_SWAP_SCALE } from "@rowcat/design";
import type { Transition } from "motion/react";
import { enterTransition, exitTransition } from "./transitions.ts";

/**
 * Rhythm for a glyph that swaps in place inside one control, sibling of count-roll.ts. The axis is
 * what changes: a picture, in place. The control stays mounted and changes its own state, so the
 * rhythm says that the same object became another state.
 *
 * The values are shared by all consumers (send/stop, copy/copied, password show/hide, follow,
 * recovery-code copy, pin, save status). Per-screen scale choices would make the same kind of event
 * arrive with a different weight on each screen.
 *
 * Rotation is 8 degrees on purpose. It only signals that the two glyphs share an axis. Larger, and
 * the rotation reads first; zero, and it is a plain crossfade that hides what changed. Incoming and
 * outgoing rotate in opposite directions, which creates that axis.
 *
 * Durations are not set here. The enter and exit transitions of count-roll.ts are reused, and the
 * token source stays in @rowcat/design (enforced by a static scan in feedback.test.ts).
 *
 * Reduced motion is not handled here. The global MotionConfig reducedMotion="user" snaps scale and
 * rotate to final values but keeps opacity, so the state change is still perceived at the same
 * moment in either setting.
 */

/**
 * Scale and rotation of the glyph. The values come from @rowcat/design (the same place as
 * page-enter.ts). Re-exported, so this file's public shape is unchanged.
 */
export { ICON_SWAP_ROTATE, ICON_SWAP_SCALE };

/**
 * Incoming glyph.
 *
 * initial is not given on the first mount. That decision belongs to the renderer (AnimatePresence
 * initial={false} in animated-icon-swap.tsx), not to this rhythm. Otherwise, when a screen first
 * loads, the send icon would animate in as if the user had pressed it.
 */
export const iconSwapIn = {
	initial: { opacity: 0, scale: ICON_SWAP_SCALE, rotate: -ICON_SWAP_ROTATE },
	animate: { opacity: 1, scale: 1, rotate: 0 },
	transition: enterTransition satisfies Transition,
} as const;

/**
 * Outgoing glyph. It is faster than the incoming one.
 *
 * Both occupy the same grid cell at the same time, so they overlap. The overlap must be short, or
 * the two pictures look like they are standing side by side.
 */
export const iconSwapOut = {
	opacity: 0,
	scale: ICON_SWAP_SCALE,
	rotate: ICON_SWAP_ROTATE,
	transition: exitTransition satisfies Transition,
} as const;

/**
 * Copied-indicator display time. This is a response, not a state.
 *
 * It reverts because if it stayed, the next time the button is seen it would read as 'already
 * copied', and the user could not tell whether they had just copied. Chat message copy and runtime
 * path copy share this value. iconSwapQuietIn depends on this length, so the value lives here, in
 * one place.
 */
export const COPY_FEEDBACK_MS = 1600;

/**
 * Quiet incoming glyph: opacity only.
 *
 * It is used in one place: when the copied indicator reverts after its timer. That change is not a
 * response to the user's press. Giving it the same weight as the incoming glyph would make the
 * success read as happening once more. This is the weight the repo gives to things the user did not
 * start.
 *
 * There is no quiet outgoing counterpart. AnimatePresence exits with the props of the render in
 * which the element was created, so the copied glyph's exit was fixed when it entered. There is no
 * later point at which to say 'exit quietly', so that branch is not created.
 */
export const iconSwapQuietIn = {
	initial: { opacity: 0 },
	animate: { opacity: 1 },
	transition: exitTransition satisfies Transition,
} as const;
