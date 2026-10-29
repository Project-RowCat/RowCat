import { isThemeColorHex } from "@rowcat/design";
import {
	clampHue,
	clampUnit,
	type HsvColor,
	hexToHsv,
	hsvToHex,
	preserveHue,
} from "./theme-customization-color.ts";
import { normalizedThemeDraftValue } from "./theme-customization-state.ts";

/**
 * Color picker rules, separated from rendering. Three questions are answered here:
 *
 * 1. Which color is at a pointer position (coordinates to axes). Off-surface pointers, the
 *    zero-width first frame, and the inverted vertical axis are all resolved here.
 * 2. What is authoritative: the HSV value alone. If hue, saturation, value, hex, and handle
 *    position were kept as separate state, they would drift apart, and nothing would say which one
 *    is the user's color.
 * 3. What an unfinished text entry erases: nothing. Parsing each keystroke and overwriting state
 *    would make the field impossible to edit.
 *
 * State has two fields. `hsv` is the last valid color, and the picker draws only from it. `rawHex`
 * is the text as typed, which is also the draft output. Everything else (handle position, preview
 * color, validity) is derived. Promoting a derived value to state adds a pair that must stay in
 * sync.
 *
 * `hsv` is not rebuilt from the hex the picker emits. Gray and black drop hue from the channels, so
 * rederiving on every drag would turn purple into red after passing through gray. Dragging copies
 * `hsv` directly. Rederiving happens only when someone types hex, and then `preserveHue` keeps the
 * hue.
 */

/**
 * A subset of DOMRect. The module does not depend on the DOM, which is why its tests run without a
 * browser.
 */
export interface PickerRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface PickerPoint {
	clientX: number;
	clientY: number;
}

const ratio = (offset: number, size: number): number =>
	size > 0 ? clampUnit(offset / size) : 0;

/**
 * The vertical axis is inverted: the top is value 1, the bottom is value 0. Screen coordinates grow
 * downward, so omitting the flip makes the picker move upside down. A handle position computed with
 * the same mistake would flip with it and leave no symptom, only a reversed color.
 *
 * Out-of-bounds coordinates are clamped. A pointer that left the surface was not lost; the user
 * dragged to the end.
 */
export function pointToSv(
	point: PickerPoint,
	rect: PickerRect,
): {
	s: number;
	v: number;
} {
	return {
		s: ratio(point.clientX - rect.left, rect.width),
		v: 1 - ratio(point.clientY - rect.top, rect.height),
	};
}

/**
 * Horizontal slider point to hue. The right end is 360 degrees, not folded to 0 (see the
 * theme-customization-color.ts header).
 */
export function pointToHue(
	clientX: number,
	rect: Pick<PickerRect, "left" | "width">,
): number {
	return ratio(clientX - rect.left, rect.width) * 360;
}

/** Axes to handle position (percent). Uses the same vertical flip as the coordinate conversion. */
export function svPosition(hsv: HsvColor): { left: number; top: number } {
	return {
		left: clampUnit(hsv.s) * 100,
		top: (1 - clampUnit(hsv.v)) * 100,
	};
}

export const huePosition = (hue: number): number => (clampHue(hue) / 360) * 100;

export interface ThemeColorPickerState {
	/** The last valid color. Partial hex input cannot change this value. */
	hsv: HsvColor;
	/** The hex field's text as typed. An empty string means 'use the preset color'. */
	rawHex: string;
}

/**
 * Initial state when the popover opens. With no chosen value it starts from the preset color, which
 * does not make it a draft: `rawHex` stays empty.
 *
 * Simply opening must not create a custom color (a paid feature). The user has chosen nothing, but
 * Save would become enabled, and saving would freeze the preset color as a custom value. Changing
 * the preset later would then leave that user's color behind.
 */
export function openThemeColorPicker(
	rawValue: string,
	fallbackColor: string,
): ThemeColorPickerState {
	const normalized = normalizedThemeDraftValue(rawValue);
	const source = isThemeColorHex(normalized) ? normalized : fallbackColor;
	return { hsv: hexToHsv(source) ?? { h: 0, s: 0, v: 0 }, rawHex: rawValue };
}

/**
 * Dragging or keyboard input moved the axes. This is where a custom value is created. The result is
 * a custom value even when its hex happens to match the preset. Judging intent by comparing the
 * final color to the preset would silently drop the choice of someone who deliberately picked the
 * same black on a black preset. What matters is whether manipulation happened, not the color.
 *
 * Not taking a previous state is the structural form of hue preservation here: a drag carries all
 * three axes, so nothing needs preserving. The only path where hue must be preserved is the one
 * that rederives axes from a color, which is `themeColorPickerWithHex` below.
 */
export function themeColorPickerWithHsv(hsv: HsvColor): ThemeColorPickerState {
	const next: HsvColor = {
		h: clampHue(hsv.h),
		s: clampUnit(hsv.s),
		v: clampUnit(hsv.v),
	};
	return { hsv: next, rawHex: hsvToHex(next) };
}

/**
 * A person typed a hex value. Three branches, and in all of them `rawHex` keeps exactly what was
 * typed:
 *
 *   empty            picker returns to the preset color (clearing the field means 'use preset')
 *   valid color      picker jumps there (hue is kept if the color has none)
 *   anything else    picker keeps its last valid color: nothing is erased or reverted
 *
 * The last branch is the point of the function. Parsing partial input and overwriting state would
 * jump the picker to black on `#`, and again on every later character.
 */
export function themeColorPickerWithHex(
	state: ThemeColorPickerState,
	rawHex: string,
	fallbackColor: string,
): ThemeColorPickerState {
	const normalized = normalizedThemeDraftValue(rawHex);

	if (normalized === "") {
		const hsv = hexToHsv(fallbackColor);
		return { hsv: hsv ? preserveHue(state.hsv, hsv) : state.hsv, rawHex };
	}

	const hsv = isThemeColorHex(normalized) ? hexToHsv(normalized) : null;
	return { hsv: hsv ? preserveHue(state.hsv, hsv) : state.hsv, rawHex };
}

/** Color the picker draws now. During partial hex input this is still the last valid color. */
export const themeColorPickerColor = (state: ThemeColorPickerState): string =>
	hsvToHex(state.hsv);
