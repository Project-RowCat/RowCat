/**
 * Native control metrics: the axis the shared design tokens deliberately do not carry.
 *
 * These values carry two axes at once: the visible box size and the touch target the finger must
 * hit. The web has no target axis, since a mouse points at one pixel. One number for both would be
 * wrong for one of them.
 *
 * Spacing, type, radius, icon size and border width are not here. They are genuinely shared and
 * come from @rowcat/design. Copying them here would create two copies.
 *
 * Visible box heights match the web. The target is widened by targetSlop(). Do not put hitSlop on
 * rows that touch their neighbors (list rows, menu items, tabs). In React Native overlapping
 * targets go to the sibling drawn later, so the finger lands on the row above while the row below
 * opens. That fails silently and leaves no trace. Those rows already span the full width, so only
 * the vertical axis matches the web.
 */

/**
 * Smallest touch target a finger does not miss. iOS HIG gives 44pt and Material gives 48dp as the
 * minimum. This is the floor for the target, not the height of a control. The two were once the
 * same value, and that was the error.
 */
export const touchTarget = 44;

/**
 * Visible control heights, matching web's h-8, h-9 and h-10.
 * - sm 32 (web h-8): controls that sit in a row, such as chips, secondary buttons, menu items and
 *   select items.
 * - md 36 (web h-9): the default for buttons, inputs and the select trigger.
 * - lg 40 (web h-10): standalone, emphasized actions.
 */
export const controlHeight = {
	sm: 32,
	md: 36,
	lg: 40,
} as const;

export type ControlSize = keyof typeof controlHeight;

/**
 * Converts a visible height into a hitSlop that widens the target to 44.
 *
 * Rounds because differences can be odd: 44 - 36 = 8 gives 4, and 44 - 34 = 10 gives 5. Returns 0
 * at or above 44, because a negative hitSlop would shrink the target.
 *
 * This is a function on purpose. If each call site wrote (44 - 36) / 2, one of them would keep an
 * old height and the mismatch would not show on screen.
 */
export const targetSlop = (visible: number): number =>
	Math.max(0, Math.round((touchTarget - visible) / 2));

/**
 * App header height, equal to the web's same band (measured 56).
 *
 * Not derived from control height. It was once controlHeight.md + space.sm, which produced 52 only
 * by coincidence. When controls moved to 36 the header would have dropped to 44, 12pt shorter than
 * the web. The band itself decides this value, not the buttons inside it.
 *
 * The safe-area inset is added on top of this value. The status bar is not part of the header.
 */
export const appBarHeight = 56;
