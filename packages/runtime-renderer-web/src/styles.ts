import { isRuntimeColor } from "@rowcat/runtime/color";
import {
	checkRuntimeScale,
	checkRuntimeTranslate,
	RUNTIME_MOTION_NEUTRAL,
} from "@rowcat/runtime/transition";
import type { RuntimeHostValue } from "@rowcat/runtime-host/patches";
import { rendererError, WEB_RENDERER_ERROR_CODE } from "./errors.ts";

/**
 * Runtime style to CSS: only the axes documented in the contract, each converted explicitly.
 * - No generic key-to-CSS copying. It would widen runtime styles to all of CSS and make
 *   unsupported properties (position: fixed, zIndex, fontFamily) work on the web only. An unknown
 *   key is a contract error.
 * - Units: a number is a density-independent unit mapped to CSS px. Percentage strings pass
 *   through. Other unit strings are rejected.
 * - Transforms: translateX, translateY and scale collapse into one CSS transform in a fixed order
 *   (translate, then scale). Scale first would multiply the translation distance, and renderers
 *   must agree. Missing axes get neutral values, so removing an axis transitions back to neutral.
 * - gap: an explicit gap prop beats style.gap, decided here rather than by browser assignment
 *   order. The native renderer uses the same rule (docs/creator-runtime/web-renderer.md).
 * - Types are not a boundary: a string that fails isRuntimeColor never becomes a CSS color.
 */

export type CssMap = Map<string, string>;

const isRecord = (
	value: RuntimeHostValue,
): value is { readonly [key: string]: RuntimeHostValue } =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const contract = (message: string) =>
	rendererError(WEB_RENDERER_ERROR_CODE.contract, message);

const finiteNumber = (name: string, value: RuntimeHostValue): number => {
	if (typeof value !== "number" || !Number.isFinite(value))
		throw contract(`style.${name}: expected a finite number`);
	return value;
};

/** Number to px. Fractional values are kept as-is; the browser handles subpixels. */
export const pxCss = (value: number): string => `${value}px`;

const PERCENT = /^-?(?:\d+|\d*\.\d+)%$/;

export function lengthCss(name: string, value: RuntimeHostValue): string {
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw contract(`style.${name}: expected a finite number`);
		return pxCss(value);
	}
	if (typeof value === "string" && PERCENT.test(value)) return value;
	throw contract(`style.${name}: expected a number or a percentage string`);
}

export function colorCss(name: string, value: RuntimeHostValue): string {
	if (typeof value !== "string" || !isRuntimeColor(value))
		throw contract(`${name}: expected a #rgb, #rrggbb or #rrggbbaa color`);
	return value;
}

/**
 * Clamps to 0 to 1, the same rule as the contract's clamp. NaN is already rejected by the validator
 * before this point.
 */
export function opacityCss(name: string, value: RuntimeHostValue): string {
	const number = finiteNumber(name, value);
	return String(Math.min(1, Math.max(0, number)));
}

/**
 * One transform axis. The range check is done by a function from @rowcat/runtime. The VM already
 * rejects with that same function, but this realm is the final authority. No copy of the check is
 * written here: the day copies diverge, only the web would let Infinity through.
 */
const translateValue = (name: string, value: RuntimeHostValue): number => {
	const why = checkRuntimeTranslate(value);
	if (why !== null) throw contract(`style.${name}: ${why}`);
	return value as number;
};

const scaleValue = (value: RuntimeHostValue): number => {
	const why = checkRuntimeScale(value);
	if (why !== null) throw contract(`style.scale: ${why}`);
	return value as number;
};

const JUSTIFY: Readonly<Record<string, string>> = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	between: "space-between",
	around: "space-around",
};

const ALIGN: Readonly<Record<string, string>> = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	stretch: "stretch",
};

const TEXT_ALIGN: Readonly<Record<string, string>> = {
	start: "start",
	center: "center",
	end: "end",
};

const FONT_WEIGHT: Readonly<Record<string, string>> = {
	regular: "400",
	medium: "500",
	bold: "700",
};

function enumCss(
	name: string,
	value: RuntimeHostValue,
	table: Readonly<Record<string, string>>,
): string {
	if (typeof value === "string" && Object.hasOwn(table, value))
		return table[value] as string;
	throw contract(
		`style.${name}: expected one of ${Object.keys(table).join(" · ")}`,
	);
}

/**
 * RuntimeStyle to CSS declarations. When gapOverride is set (the gap prop of Stack or Row),
 * style.gap is not read. This is the priority described in the header above. The return value is
 * the complete set of declarations, so the caller can compare it with the previous set and clear
 * whatever is missing.
 */
export function boxStyleCss(
	value: RuntimeHostValue,
	gapOverride: number | null = null,
): CssMap {
	const css: CssMap = new Map();
	if (value === null) {
		if (gapOverride !== null) css.set("gap", pxCss(gapOverride));
		return css;
	}
	if (!isRecord(value)) throw contract("style: expected an object");
	/**
	 * If any one of the three transform axes is present, one transform declaration is emitted. Missing
	 * axes get neutral values.
	 */
	let translateX: number | null = null;
	let translateY: number | null = null;
	let scale: number | null = null;
	for (const key of Object.keys(value)) {
		const entry = value[key] as RuntimeHostValue;
		switch (key) {
			case "translateX":
				translateX = translateValue(key, entry);
				break;
			case "translateY":
				translateY = translateValue(key, entry);
				break;
			case "scale":
				scale = scaleValue(entry);
				break;
			case "width":
				css.set("width", lengthCss(key, entry));
				break;
			case "height":
				css.set("height", lengthCss(key, entry));
				break;
			case "minWidth":
				css.set("min-width", lengthCss(key, entry));
				break;
			case "maxWidth":
				css.set("max-width", lengthCss(key, entry));
				break;
			case "minHeight":
				css.set("min-height", lengthCss(key, entry));
				break;
			case "maxHeight":
				css.set("max-height", lengthCss(key, entry));
				break;
			case "padding":
				css.set("padding", pxCss(finiteNumber(key, entry)));
				break;
			case "gap":
				if (gapOverride === null)
					css.set("gap", pxCss(finiteNumber(key, entry)));
				break;
			case "opacity":
				css.set("opacity", opacityCss(key, entry));
				break;
			case "backgroundColor":
				css.set("background-color", colorCss(`style.${key}`, entry));
				break;
			case "borderRadius":
				css.set("border-radius", pxCss(finiteNumber(key, entry)));
				break;
			case "justify":
				css.set("justify-content", enumCss(key, entry, JUSTIFY));
				break;
			case "align":
				css.set("align-items", enumCss(key, entry, ALIGN));
				break;
			case "grow":
				css.set("flex-grow", String(finiteNumber(key, entry)));
				break;
			/**
			 * Negative values are rejected because browsers silently ignore them. The creator would believe
			 * the value works, and the mistake would only come out when the screen is looked at.
			 */
			case "shrink": {
				const shrink = finiteNumber(key, entry);
				if (shrink < 0) throw contract(`style.${key}: must not be negative`);
				css.set("flex-shrink", String(shrink));
				break;
			}
			default:
				throw contract(`style.${key}: unknown style property`);
		}
	}
	if (translateX !== null || translateY !== null || scale !== null)
		css.set(
			"transform",
			transformCss(
				translateX ?? RUNTIME_MOTION_NEUTRAL.translateX,
				translateY ?? RUNTIME_MOTION_NEUTRAL.translateY,
				scale ?? RUNTIME_MOTION_NEUTRAL.scale,
			),
		);
	if (gapOverride !== null) css.set("gap", pxCss(gapOverride));
	return css;
}

/**
 * Three transform axes to one CSS transform. The order is part of the contract: translate,
 * translate, scale.
 *
 * The native renderer's transform array uses the same order. If the two diverge, the translation
 * distance of a scaled node differs per platform. The difference is invisible when the scale is 1.
 */
export const transformCss = (
	translateX: number,
	translateY: number,
	scale: number,
): string =>
	`translateX(${pxCss(translateX)}) translateY(${pxCss(translateY)}) scale(${scale})`;

/**
 * RuntimeTextStyle to CSS declarations. lines maps to the web's line-clamp idiom
 * (-webkit-line-clamp). The point is that this syntax never appears in the runtime API. The creator
 * writes only 'how many lines', and how the cut is made belongs to the renderer.
 */
export function textStyleCss(value: RuntimeHostValue): CssMap {
	const css: CssMap = new Map();
	if (value === null) return css;
	if (!isRecord(value)) throw contract("style: expected an object");
	for (const key of Object.keys(value)) {
		const entry = value[key] as RuntimeHostValue;
		switch (key) {
			case "color":
				css.set("color", colorCss(`style.${key}`, entry));
				break;
			case "fontSize":
				css.set("font-size", pxCss(finiteNumber(key, entry)));
				break;
			case "fontWeight":
				css.set("font-weight", enumCss(key, entry, FONT_WEIGHT));
				break;
			case "align":
				css.set("text-align", enumCss(key, entry, TEXT_ALIGN));
				break;
			case "lines": {
				const lines = finiteNumber(key, entry);
				if (!Number.isInteger(lines) || lines < 1)
					throw contract("style.lines: expected a positive integer");
				css.set("display", "-webkit-box");
				css.set("-webkit-box-orient", "vertical");
				css.set("-webkit-line-clamp", String(lines));
				css.set("overflow", "hidden");
				break;
			}
			case "opacity":
				css.set("opacity", opacityCss(key, entry));
				break;
			default:
				throw contract(`style.${key}: unknown text style property`);
		}
	}
	return css;
}

/** Style for Progress. Only width is supported. */
export function progressStyleCss(value: RuntimeHostValue): CssMap {
	const css: CssMap = new Map();
	if (value === null) return css;
	if (!isRecord(value)) throw contract("style: expected an object");
	for (const key of Object.keys(value)) {
		if (key !== "width")
			throw contract(`style.${key}: unknown progress style property`);
		css.set("width", lengthCss(key, value[key] as RuntimeHostValue));
	}
	return css;
}

/**
 * Sync inline declarations to the target set: remove what is missing, rewrite only what changed.
 *
 * The reason not to replace element.style.cssText wholesale is not the cost of reparsing. It is
 * that a wholesale replacement can erase declarations this code does not manage. This renderer
 * writes only the declarations it manages here, so one list (applied) is enough.
 */
export function syncInlineCss(
	element: HTMLElement,
	applied: CssMap,
	next: CssMap,
): void {
	for (const property of applied.keys())
		if (!next.has(property)) {
			element.style.removeProperty(property);
			applied.delete(property);
		}
	for (const [property, value] of next)
		if (applied.get(property) !== value) {
			element.style.setProperty(property, value);
			applied.set(property, value);
		}
}
