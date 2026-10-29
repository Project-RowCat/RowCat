import { PAGE_ENTER_Y } from "@rowcat/design";

/**
 * Page-entrance policy: the values and one decision.
 *
 * This is kept apart from page-transition.tsx because this file knows neither Motion nor React. It
 * holds how far to move and whether moving is allowed now, both checkable without rendering.
 * Combining them would force a DOM to be mounted just to check these rules.
 */

/**
 * Vertical offset for entering. It used to live here, and while the web was the only consumer that
 * was correct. Native now reads the same rhythm, so two platforms each writing the value would
 * bring the same arrival at different distances. The re-export is the point: the public shape is
 * unchanged, so callers and tests still read it from here.
 */
export { PAGE_ENTER_Y };

export const pageEnterInitial = { opacity: 0, y: PAGE_ENTER_Y } as const;

export const pageEnterAnimate = { opacity: 1, y: 0 } as const;

/**
 * Decides the starting state for this mount. false tells Motion that start equals end, so the
 * element rests at its final value with no animation.
 *
 * During hydration it picks false. Server HTML is already in its final state. A start value on top
 * of it breaks two things: the first client render differs from the server markup (hydration
 * mismatch, and React does not revert the styles), and the body stays invisible in the meantime,
 * which is forever if JavaScript never arrives.
 *
 * Entrance only means something when the screen changes. The first screen has no previous screen to
 * continue from.
 */
export function pageEnterInitialFor(
	hydrating: boolean,
): typeof pageEnterInitial | false {
	return hydrating ? false : pageEnterInitial;
}
