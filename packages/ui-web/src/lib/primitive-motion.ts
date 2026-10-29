import {
	type CubicBezier,
	motionDurationMs,
	motionEasing,
} from "@rowcat/design";
import type { TargetAndTransition, Transition } from "motion/react";

/**
 * Open and close motion for primitives (dialog, popover, dropdown, context menu). Values and tables
 * only.
 * - Moved from tw-animate-css utility classes to Motion. Shared here so components do not each
 *   repeat the same six lines. The old repeated classes had drifted: the submenu lacked the
 *   inline-start and inline-end directions.
 * - Select is not in this table. Base UI turns off its opening transition itself, and only the
 *   closing side moves, via CSS reading token variables (see the CSS-driven section below and the
 *   header of components/select.tsx).
 * - No React or JSX here, so the direction table can be checked without rendering, and the
 *   package's exports need not widen. Each component creates its moving element in one line inside
 *   its render prop.
 * - No accessibility policy here. Reduced motion is decided once, by the app's MotionConfig
 *   reducedMotion="user". If this package started watching matchMedia, two systems would answer the
 *   same question and diverge first during server rendering.
 */

/**
 * Base UI's side type is not imported, so this file does not need @base-ui/react. The only thing
 * kept here is 'which side the popup sits on maps to where it enters from.' The values match, so
 * call sites accept the type structurally.
 */
export type PopupSide =
	| "top"
	| "bottom"
	| "left"
	| "right"
	| "inline-start"
	| "inline-end";

/**
 * 8px matches the old slide-in-from-*-2 (0.5rem). The movement only says 'this came from there.' A
 * larger shift makes the popup fly. The surface sits right beside its trigger, so there is no
 * distance to fly.
 */
const POPUP_SHIFT_PX = 8;

/** Entry scale. Matches the old zoom-in-95 class. */
const POPUP_SCALE = 0.95;

/**
 * Primitive rhythm, a different scale from product motion. The basis is documented on
 * @rowcat/design's motionDurationMs.primitive. Easing is the product's `standard`: the surface both
 * enters and exits and is tied to its trigger, so it reverses in place. If open and close curves
 * split, a fast double press would return along a different path than it went.
 */
export const primitivePopupTransition: Transition = {
	duration: motionDurationMs.primitive / 1000,
	ease: [...motionEasing.standard] as [number, number, number, number],
};

/**
 * The direction always comes from the trigger's side: a popup below enters from above, a popup on
 * the left enters from the right. That answers 'the thing that opened this is there.'
 *
 * inline-* is logical and flips under RTL, but this table folds only for LTR. The old class table
 * had the same limit, and the product has no RTL yet. When that axis arrives, this table is the one
 * place to fix.
 */
const POPUP_ORIGIN: Record<PopupSide, { x: number; y: number }> = {
	bottom: { x: 0, y: -POPUP_SHIFT_PX },
	top: { x: 0, y: POPUP_SHIFT_PX },
	left: { x: POPUP_SHIFT_PX, y: 0 },
	right: { x: -POPUP_SHIFT_PX, y: 0 },
	"inline-start": { x: POPUP_SHIFT_PX, y: 0 },
	"inline-end": { x: -POPUP_SHIFT_PX, y: 0 },
};

/** Closed state: the starting value on mount and the position it returns to on close. */
export function popupClosed(side: PopupSide): TargetAndTransition {
	const { x, y } = POPUP_ORIGIN[side];
	return { opacity: 0, scale: POPUP_SCALE, x, y };
}

export const popupOpen: TargetAndTransition = {
	opacity: 1,
	scale: 1,
	x: 0,
	y: 0,
};

/**
 * Every Motion prop a popup needs. The layer derives `animate` from the open state rather than
 * using AnimatePresence, for three reasons:
 * - Unmounting stays with Base UI, so a closed popup leaves the DOM (no keepMounted).
 * - Callers do not need to hold `open`; the contract is unchanged for over twenty consumers.
 * - There is one element, so closing mid-open is reversed in place by Motion.
 *
 * The element stays alive while closing because Base UI waits for element.getAnimations() before
 * unmounting. Therefore every popup must animate opacity, or its exit is cut off.
 */
export function popupMotion(side: PopupSide, open: boolean) {
	const closed = popupClosed(side);
	return {
		initial: closed,
		animate: open ? popupOpen : closed,
		transition: primitivePopupTransition,
	};
}

/**
 * The placement a dialog takes. `adaptive` is the point of this vocabulary: a bottom-attached sheet
 * on narrow screens, a centered box on wide ones. The decision used to be made by twelve classes at
 * each call site, repeated across five screens. The name exists for the motion (see dialogMotion),
 * and it matches the vocabulary the mobile app already uses (apps/mobile dialog-placement.ts).
 */
export type DialogPlacement = "center" | "adaptive" | "left";

export type ResolvedDialogPlacement = "center" | "bottom" | "left";

/**
 * The width at which `adaptive` splits. It must equal Tailwind's `sm` (40rem). Call sites still
 * move with `sm:top-1/2` classes, so if this query and that breakpoint diverge, there is a width
 * where one side sticks to the bottom while the other centers.
 */
export const DIALOG_WIDE_QUERY = "(min-width: 40rem)";

/** Reduces the width check to a pure value so that it can be verified without rendering. */
export function resolveDialogPlacement(
	placement: DialogPlacement,
	wide: boolean,
): ResolvedDialogPlacement {
	if (placement === "adaptive") return wide ? "center" : "bottom";
	return placement;
}

/**
 * Distance a left drawer enters from (px). Matches the old slide-in-from-left-4 (1rem). It is
 * larger than the center box's shift because of area: on a surface that fills the screen height,
 * 8px reads as a shake.
 */
const DIALOG_EDGE_SHIFT_PX = 16;

/**
 * Dialog motion.
 * - The -50% horizontal offset is owned by Motion. The center box and bottom sheet sit at
 *   left-1/2 and pull back by half their width. That offset was once Tailwind's -translate-x-1/2.
 *   When Motion animates scale, it writes the same transform property inline and the class
 *   disappears, so the box slides half off screen. Every state (initial, open, closed) must carry
 *   the same offset; if one lacks it, the box slides sideways in that state.
 * - Vertical placement follows the same logic. The bottom sheet is anchored by bottom-0, so y is
 *   0. The center box starts at top-1/2 and pulls back half its height. These were split across
 *   classes, which is why 'adaptive' exists.
 * - The drawer (left) has no scale. On a surface that uses the full screen height, scale reads as
 *   'grew'. That surface should communicate only that it came from the left.
 */
export function dialogMotion(
	placement: ResolvedDialogPlacement,
	open: boolean,
) {
	const closed: TargetAndTransition =
		placement === "left"
			? { opacity: 0, x: -DIALOG_EDGE_SHIFT_PX, y: 0 }
			: {
					opacity: 0,
					scale: POPUP_SCALE,
					x: "-50%",
					y: placement === "center" ? "-50%" : 0,
				};
	const shown: TargetAndTransition =
		placement === "left"
			? { opacity: 1, x: 0, y: 0 }
			: {
					opacity: 1,
					scale: 1,
					x: "-50%",
					y: placement === "center" ? "-50%" : 0,
				};

	return {
		initial: closed,
		animate: open ? shown : closed,
		transition: primitivePopupTransition,
	};
}

/**
 * Backdrop behind dialogs. Only opacity moves: the surface covers the whole screen, so movement is
 * noise.
 */
export function backdropMotion(open: boolean) {
	return {
		initial: { opacity: 0 } as TargetAndTransition,
		animate: { opacity: open ? 1 : 0 } as TargetAndTransition,
		transition: primitivePopupTransition,
	};
}

/**
 * CSS-driven primitives. The values above are all shaped for Motion. These rhythms are CSS
 * transitions because Motion cannot express these particular motions, not because there are two
 * systems:
 * - Checkbox indicator: Base UI owns mounting and unmounting, which shows up only through
 *   data-starting-style and data-ending-style. CSS is the only way to read those without mirroring
 *   state in React.
 * - Tab indicator: stays hidden until its position is known, then appears. CSS transitions do not
 *   fire from the first style after display:none, so the first mount is quiet automatically. Motion
 *   would have to recreate that quiet as state.
 * - Switch: the thumb position is pure CSS state driven by data-checked. There is no reason to
 *   mirror it.
 * - Select: Base UI disables the opening transition itself with inline transition: none during
 *   'starting'. Only CSS can express the closing side (see below).
 * - Toast: variants are built from CSS variables that update during a swipe. Motion would require
 *   reworking the swipe interaction.
 *
 * In every case the source of the values is still @rowcat/design. Being a CSS transition is not a
 * reason to write milliseconds into class strings. transition-property is deliberately not here. If
 * that one line stayed in classes, the motion-reduce: variant could override it, which lets reduced
 * motion reach these too. That variant is CSS's own counterpart, not a second watcher, so the
 * matchMedia rule above still holds.
 */

/**
 * Shape that can be spread directly onto a style prop. Typed narrowly so this file does not import
 * React; CSSProperties would tie it back to React.
 */
export type CssTransitionRhythm = {
	readonly transitionDuration: string;
	readonly transitionTimingFunction: string;
};

function cssRhythm(
	durationMs: number,
	easing: CubicBezier,
): CssTransitionRhythm {
	return {
		transitionDuration: `${durationMs}ms`,
		transitionTimingFunction: `cubic-bezier(${easing.join(", ")})`,
	};
}

/**
 * Rhythm for the checkbox mark attaching and detaching. Uses the primitive scale (100ms). This is
 * the immediate answer to the press, not product motion explaining what changed. A visible
 * transition here would read as lag. Entry and exit share one duration and curve: the product's
 * enter/exit asymmetry belongs to sentences that attach and detach, and a 4mm glyph cannot show a
 * 20ms difference. What differs is how far it shrinks (checkbox.tsx).
 */
export const checkboxIndicatorRhythm = cssRhythm(
	motionDurationMs.primitive,
	motionEasing.standard,
);

/**
 * Stroke-draw rhythm for the checkbox mark. It is longer than the indicator rhythm above. The
 * answer to the press (box fills, mark appears) completes within that 100ms. The stroke is an
 * explanation added afterward and blocks nothing, so it is not tied to the primitive scale. Drawn
 * in the same 100ms, the stroke would never be seen, and the rhythm would have no purpose.
 *
 * The enter curve matters. The short stroke (about 30% of the total) finishes quickly and the long
 * one decelerates into place, matching how a hand draws it. With `standard`, the first stroke
 * starts slowly and the empty box appears to pause. Not used on exit (checkbox.tsx): rewinding the
 * stroke reads as erasing.
 */
export const checkboxTickDrawRhythm = cssRhythm(
	motionDurationMs.normal,
	motionEasing.enter,
);

/**
 * Rhythm for the check in menu items (DropdownMenuCheckboxItem and RadioItem). Same scale and curve
 * as the checkbox indicator: the same glyph means the same thing (selected), so it answers the same
 * press with the same rhythm. It has its own name because this file keeps one name per control, so
 * that when the two must diverge, the name shows where to change.
 *
 * The stroke is not drawn here, the only difference from the checkbox. In a radio group one
 * selection moves the mark from one row to another. Adding a stroke would turn one choice into
 * three motions. Menus are scanned surfaces, where the only thing to convey is which row.
 */
export const menuIndicatorRhythm = cssRhythm(
	motionDurationMs.primitive,
	motionEasing.standard,
);

/**
 * Switch press answer: thumb movement and track color move on one rhythm. Same scale and curve as
 * the checkbox, because this is also an answer to a press rather than an explanation of a state
 * change.
 *
 * This control was once outside the rule. transition-transform had no duration and rolled with
 * Tailwind's defaults (150ms, a different curve), so it answered the same press on the same row
 * differently from the checkbox. Changing tokens would not move it, and nothing errors. It has its
 * own name instead of borrowing the checkbox constant, matching this file's shape
 * (tabsIndicatorRhythm does the same).
 */
export const switchRhythm = cssRhythm(
	motionDurationMs.primitive,
	motionEasing.standard,
);

/**
 * Rhythm for the active tab indicator moving between siblings. It uses `normal`, not the primitive
 * scale, on purpose. Unlike open/close infrastructure, this moves position, and the rhythm for that
 * axis is already set: the same value and curve as the app sidebar's active indicator
 * (layoutTransition). Diverging would make one action (another sibling became active) arrive at
 * different speeds on each screen. `standard` because the indicator neither enters nor exits; it
 * only shifts in place.
 */
export const tabsIndicatorRhythm = cssRhythm(
	motionDurationMs.normal,
	motionEasing.standard,
);

/*
 * The select popup's rhythm is deliberately absent, and that absence is the record. Its alignment
 * layout rewrites the element's style attribute directly (measured: only height and
 * --transform-origin survive), so transition values carried by inline style are silently erased.
 * Only this popup has the class carry its rhythm. The CSS variables the class references (such as
 * --motion-duration-primitive) are generated from the same tokens by @rowcat/design's generator.
 * The reasons, and why it is closing-only, are in the header of components/select.tsx.
 */

/**
 * The toast rhythm, the only transition in this package where durations differ per property.
 *
 * Transform and opacity use `slow`: they travel in from and out to off-screen (150%), the largest
 * area movement in this repo, so the scale's upper bound fits. This value was once hard-coded as
 * 500ms in the class, 1.8 times that bound, and did not follow token changes. Height uses `fast`:
 * stacked toasts reflow along this axis, so height must settle before the surface moves or the
 * toasts below will wobble.
 *
 * The time list must match the class's property list by position (transform, opacity, height). That
 * pairing is this value's weakest link. Reordering the class properties means changing this list
 * too. Easing is `standard` for one reason, the same as popups: one curve serves both entry and
 * exit. Pausing during a swipe is not this value's job. Base UI sets inline transition: none during
 * the drag itself (ToastRoot).
 */
export const toastRhythm: CssTransitionRhythm = {
	transitionDuration: `${motionDurationMs.slow}ms, ${motionDurationMs.slow}ms, ${motionDurationMs.fast}ms`,
	transitionTimingFunction: `cubic-bezier(${motionEasing.standard.join(", ")})`,
};

/**
 * Rhythm for toast content revealing and receding within the stack (data-behind and data-expanded).
 * It is `normal`, shorter than the surface movement (`slow`). If text arrives later than the
 * surface, empty cards show first. If the times match, the content moves as one block with the
 * surface when the stack expands, and it is impossible to tell what was revealed.
 */
export const toastContentRhythm = cssRhythm(
	motionDurationMs.normal,
	motionEasing.standard,
);
