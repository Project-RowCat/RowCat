/**
 * Motion tokens: platform-independent pure data, kept next to color and radius, so web Motion and
 * React Native read the same rhythm.
 *
 * - Does not import Motion. Importing the Transition or Variants types would tie this package to
 *   the web animation runtime, and Expo would pull in an unused library just to read a color token.
 *   The web boundary (apps/web/src/lib/motion) converts these values to the shape Motion expects.
 * - Durations are in milliseconds. Only Motion for React uses seconds. CSS and Reanimated use ms,
 *   so one consumer's unit would have to be converted back everywhere else.
 */

/**
 * The scale is capped at 280 ms. RowCat is a tool: motion only has to let the eye follow a state
 * change. A longer duration means a staged effect, which the individual screen should decide, not
 * this scale.
 */
export const motionDurationMs = {
	/**
	 * Dialog, popover, menu and select open and close duration. Kept separate from product motion
	 * because it answers a different question: product motion explains what changed, while a primitive
	 * must finish before that explanation starts.
	 *
	 * 100 ms comes from the CSS era (duration-100) and was kept when the values moved to Motion. It is
	 * not folded into fast (120 ms): a value close to another one is not the same decision. Folding
	 * would slow every menu when the feedback rhythm is tuned later.
	 */
	primitive: 100,
	/**
	 * Exit and short feedback. Anything longer is unnecessary to report something that already
	 * happened.
	 */
	fast: 120,
	/** Default. A change the eye should follow, as if something new arrived. */
	normal: 180,
	/** Upper bound for changes that cover a large area. */
	slow: 280,
} as const;

/**
 * Rhythm for continuously running values, such as a countdown that decrements every second or a
 * character count that changes on every keystroke. Kept as a pair outside the scale above, because
 * the two values form one rhythm.
 *
 * fast and normal describe a change that happened once, and the eye needs time to follow it. Values
 * here are ones where the next change is already coming. A 180 ms transition on a number that ticks
 * every second would make it a permanently moving element.
 *
 * Considered adding only continuous: 100 with exit set to fast (120). Rejected: exit would then be
 * slower than enter, so the old value would linger longer than the new one. The pair is kept
 * together so the relationship stays enforced.
 *
 * No spring or bounce: there is nothing physical to imitate, and a bounce that repeats every second
 * is decoration.
 */
export const motionContinuousDurationMs = {
	enter: 100,
	/** Exiting value. Shorter than enter, because it has to clear the spot for the incoming value. */
	exit: 70,
} as const;

/**
 * Cubic bezier control points. The two consumers, CSS cubic-bezier and Motion ease, read them in
 * the same order.
 */
export type CubicBezier = readonly [number, number, number, number];

/**
 * The three easings are split by what happens: in-place change (standard), entering (enter),
 * leaving (exit). Entering starts fast and ends slow; exiting is the reverse, since nothing that is
 * leaving needs to hold the eye.
 */
export type MotionEasingName = "standard" | "enter" | "exit";

export const motionEasing: Record<MotionEasingName, CubicBezier> = {
	standard: [0.2, 0, 0, 1],
	enter: [0, 0, 0.2, 1],
	exit: [0.4, 0, 1, 1],
};

/*
 * No springs yet. Current motion is short and finite, so durations describe it fully. A spring only
 * makes sense for surfaces that follow a hand (drag, sheets, reordering), and none exist yet.
 * Naming a spring first would shape animations to fit the name.
 */

/**
 * Kept in the same file as the durations because both answer one question: how a person perceives
 * the moment a screen changes. When a placeholder appears is a perception question, not a property
 * of the data source. A number written beside a router option would make screens that run on local
 * data (the `Chats` and `Create` screens) copy the same value.
 *
 * Only values live here. What consumes them (the router's defaultPendingMs, delayed indicators
 * inside a screen) is decided by those consumers.
 */
export const loadingDelayMs = {
	/**
	 * 200 ms sits comfortably above the roughly 100 ms that feels instant, and before the point where
	 * something needs to signal progress. Preloaded navigations finish at 0 ms and never reach this
	 * threshold; it only catches a tap made on an empty cache.
	 *
	 * The router default (1000 ms) is not used because it fails the other way: a 600 ms navigation
	 * with no feedback looks like a dropped tap.
	 */
	appear: 200,
	/**
	 * Prevents flicker; it is not meant to make the screen slower. 300 ms is about the shortest time a
	 * placeholder reads as a state, and it stays under twice the 180 ms default duration. Longer
	 * values start to visibly hold back content that has already arrived.
	 */
	minVisible: 300,
} as const;

/**
 * Geometry values live here, alongside timing and curves. Web and app each kept their own copies at
 * first, which was fine while web was the only consumer. With a second platform, the same kind of
 * event (a row appears, a control changes state) landing at different distances or weights would
 * make the products feel different. That only shows when the two screens are compared side by side.
 *
 * - The conversion to each runtime's shape happens at that platform's boundary
 *   (apps/web/src/lib/motion/transitions.ts and apps/mobile/src/lib/motion/transitions.ts). This
 *   file imports no animation runtime.
 * - Units are density-independent pixels (CSS px on web, dp on React Native). Both read the same
 *   number the same way, so no conversion is needed.
 */

/**
 * Four pixels. A page is the largest surface on screen; the card distance (6) would read as large
 * in proportion to its area. Once the move is visible, the transition becomes a performance, and
 * for someone who sees it every time it becomes an obstacle to the movement. The value stops at the
 * point of barely being visible.
 */
export const PAGE_ENTER_Y = 4;

/**
 * Shorter than the card (6). List rows are wide, so the same distance reads larger, and the
 * movement only needs to say that one item appeared.
 */
export const ROW_ENTER_Y = 4;

/**
 * Same as rows. The sentence only needs to say that the answer to the action just taken arrived
 * here. Moving more would make an error message demand attention; the text is what must be read.
 */
export const FEEDBACK_ENTER_Y = 4;

/**
 * 0.8 is the limit of shrinking. Below it the outgoing glyph reads as moving away rather than
 * vanishing, which adds a depth the state change does not imply.
 */
export const ICON_SWAP_SCALE = 0.8;

/**
 * Rotation in degrees, implying the two glyphs share an axis. The incoming glyph uses a negative
 * angle and the outgoing one a positive angle, so they appear to trade places on the same axis.
 * Larger values make the spin read first, turning the transition into an effect. Zero would be a
 * plain cross-fade, which blurs what changed into what.
 */
export const ICON_SWAP_ROTATE = 8;

/**
 * 0.96. Much shallower than ICON_SWAP_SCALE (0.8) because the target is text. Text is more
 * sensitive to scale than icons, and the same value would make a badge look like it pops out toward
 * the viewer.
 */
export const LABEL_SWAP_SCALE = 0.96;

/**
 * Describes how often the number changes, not what it counts. Follower count and seconds remaining
 * both roll in place, but the seconds are already changing again. Rolling both with the same weight
 * would make the countdown a constant moving element and push the one-off change into the
 * background.
 *
 * No third value: the only axis is whether the next change is already coming, so there are two
 * answers.
 */
export type CountRollCadence = "default" | "continuous";

/**
 * Distance a rolling number travels, as a percentage of its own line height. Not px, because the
 * same value is used at several font sizes (badges at 10 px, metrics at 30 px). A fixed px distance
 * would look large only at the small sizes.
 *
 * Half is the upper limit. At 100% the digits fully leave the box, a true odometer, and that motion
 * would outweigh the heart icon beside it. Continuous values move less. The default distance is not
 * scaled down to get there, because that would also weaken the counts that report one-off changes.
 */
export const COUNT_ROLL_SHIFT: Record<CountRollCadence, number> = {
	default: 50,
	continuous: 30,
};
