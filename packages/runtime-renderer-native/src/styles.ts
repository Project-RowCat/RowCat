import { isRuntimeColor } from "@rowcat/runtime/color";
import {
	checkRuntimeScale,
	checkRuntimeTranslate,
	RUNTIME_MOTION_NEUTRAL,
} from "@rowcat/runtime/transition";
import type { RuntimeHostValue } from "@rowcat/runtime-host/patches";
import { NATIVE_RENDERER_ERROR_CODE, rendererError } from "./errors.ts";

/**
 * Converts runtime style to React Native style, one documented axis at a time. Never a generic
 * merge like Object.assign(rnStyle, creatorStyle): that would make RN-only keys (position absolute,
 * zIndex, fontFamily) work on this platform while the web renderer rejects them, so the same work
 * would render differently. An unknown key is a contract error.
 * - Exports a narrow record of only the keys actually used, which fits RN's ViewStyle/TextStyle
 *   structurally. The file does not import react-native, so it is testable without RN, and the type
 *   states what is exported.
 * - Units: numbers are dp/pt; percentage strings stay percentages; other unit strings are
 *   rejected.
 * - Transform axes fold into one array in the web's order (translate, translate, scale). A
 *   different order makes a scaled node's travel differ per platform.
 * - gap precedence matches the web: an explicit gap prop beats style.gap
 *   (docs/creator-runtime/web-renderer.md).
 * - Types are not a boundary: a color string that fails isRuntimeColor is rejected here too.
 */

/** A percentage string or a dp number. Structurally fits React Native's DimensionValue. */
export type NativeLength = number | `${number}%`;

/** Style accepted by the box primitive. It lists every key this layer emits and nothing else. */
export interface NativeBoxStyle {
	width?: NativeLength;
	height?: NativeLength;
	minWidth?: NativeLength;
	maxWidth?: NativeLength;
	minHeight?: NativeLength;
	maxHeight?: NativeLength;
	padding?: number;
	gap?: number;
	opacity?: number;
	backgroundColor?: string;
	borderRadius?: number;
	justifyContent?:
		| "flex-start"
		| "center"
		| "flex-end"
		| "space-between"
		| "space-around";
	alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
	flexGrow?: number;
	flexShrink?: number;
	/**
	 * Transform for nodes without a transition. A transitioning node gets an Animated.Value layer on
	 * top of this value, and that layer wins (motion.tsx). It is still emitted statically here,
	 * because a transform without a transition is normal use and should not require a React-driven
	 * layer.
	 */
	transform?: readonly (
		| { translateX: number }
		| { translateY: number }
		| { scale: number }
	)[];
}

/** Text style. `lines` is not part of it: it becomes the numberOfLines prop instead. */
export interface NativeTextStyle {
	color?: string;
	fontSize?: number;
	fontWeight?: "400" | "500" | "700";
	textAlign?: "left" | "center" | "right";
	opacity?: number;
}

export interface NativeProgressStyle {
	width?: NativeLength;
}

export const isRecord = (
	value: RuntimeHostValue,
): value is { readonly [key: string]: RuntimeHostValue } =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const contract = (message: string) =>
	rendererError(NATIVE_RENDERER_ERROR_CODE.contract, message);

const finiteNumber = (name: string, value: RuntimeHostValue): number => {
	if (typeof value !== "number" || !Number.isFinite(value))
		throw contract(`style.${name}: expected a finite number`);
	return value;
};

const PERCENT = /^-?(?:\d+|\d*\.\d+)%$/;

/** Converts a RuntimeLength to dp or a percentage. Other unit strings are outside the contract. */
export function lengthValue(
	name: string,
	value: RuntimeHostValue,
): NativeLength {
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw contract(`style.${name}: expected a finite number`);
		return value;
	}
	if (typeof value === "string" && PERCENT.test(value))
		return value as NativeLength;
	throw contract(`style.${name}: expected a number or a percentage string`);
}

export function colorValue(name: string, value: RuntimeHostValue): string {
	if (typeof value !== "string" || !isRuntimeColor(value))
		throw contract(`${name}: expected a #rgb, #rrggbb or #rrggbbaa color`);
	return value;
}

/** Clamped to 0 to 1, the same rule the contract uses. */
export function opacityValue(name: string, value: RuntimeHostValue): number {
	return Math.min(1, Math.max(0, finiteNumber(name, value)));
}

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

/** Order is part of the contract: the array follows the web's transformCss order. */
export const transformValue = (
	translateX: number,
	translateY: number,
	scale: number,
): NonNullable<NativeBoxStyle["transform"]> => [
	{ translateX },
	{ translateY },
	{ scale },
];

const JUSTIFY = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	between: "space-between",
	around: "space-around",
} as const;

const ALIGN = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	stretch: "stretch",
} as const;

/**
 * `start` and `end` become `left` and `right`. This is the only loss in the table. React Native's
 * textAlign has no logical direction values. The two diverge only for right-to-left text, which
 * this product has no surface for yet, so the difference is not observable now. This table is where
 * to fix it when RTL arrives.
 */
const TEXT_ALIGN = {
	start: "left",
	center: "center",
	end: "right",
} as const;

const FONT_WEIGHT = {
	regular: "400",
	medium: "500",
	bold: "700",
} as const;

function enumValue<T extends Readonly<Record<string, string>>>(
	name: string,
	value: RuntimeHostValue,
	table: T,
): T[keyof T] {
	if (typeof value === "string" && Object.hasOwn(table, value))
		return table[value] as T[keyof T];
	throw contract(
		`style.${name}: expected one of ${Object.keys(table).join(" · ")}`,
	);
}

/**
 * gapOverride (the gap prop of Stack or Row) means style.gap is not read. The return is the node's
 * complete style, so callers replace rather than merge; merging would leave removed axes behind.
 */
export function boxStyleOf(
	value: RuntimeHostValue,
	gapOverride: number | null = null,
): NativeBoxStyle {
	const style: NativeBoxStyle = {};
	let translateX: number | null = null;
	let translateY: number | null = null;
	let scale: number | null = null;
	if (value !== null) {
		if (!isRecord(value)) throw contract("style: expected an object");
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
					style.width = lengthValue(key, entry);
					break;
				case "height":
					style.height = lengthValue(key, entry);
					break;
				case "minWidth":
					style.minWidth = lengthValue(key, entry);
					break;
				case "maxWidth":
					style.maxWidth = lengthValue(key, entry);
					break;
				case "minHeight":
					style.minHeight = lengthValue(key, entry);
					break;
				case "maxHeight":
					style.maxHeight = lengthValue(key, entry);
					break;
				case "padding":
					style.padding = finiteNumber(key, entry);
					break;
				case "gap":
					if (gapOverride === null) style.gap = finiteNumber(key, entry);
					break;
				case "opacity":
					style.opacity = opacityValue(key, entry);
					break;
				case "backgroundColor":
					style.backgroundColor = colorValue(`style.${key}`, entry);
					break;
				case "borderRadius":
					style.borderRadius = finiteNumber(key, entry);
					break;
				case "justify":
					style.justifyContent = enumValue(key, entry, JUSTIFY);
					break;
				case "align":
					style.alignItems = enumValue(key, entry, ALIGN);
					break;
				case "grow":
					style.flexGrow = finiteNumber(key, entry);
					break;
				/**
				 * Negative values are silently ignored on the web. Both renderers reject them at this point
				 * instead.
				 */
				case "shrink": {
					const shrink = finiteNumber(key, entry);
					if (shrink < 0) throw contract(`style.${key}: must not be negative`);
					style.flexShrink = shrink;
					break;
				}
				default:
					throw contract(`style.${key}: unknown style property`);
			}
		}
	}
	if (translateX !== null || translateY !== null || scale !== null)
		style.transform = transformValue(
			translateX ?? RUNTIME_MOTION_NEUTRAL.translateX,
			translateY ?? RUNTIME_MOTION_NEUTRAL.translateY,
			scale ?? RUNTIME_MOTION_NEUTRAL.scale,
		);
	if (gapOverride !== null) style.gap = gapOverride;
	return style;
}

/**
 * `lines` comes back separately instead of as style, which is where this diverges from the web. The
 * web maps it to the CSS idiom -webkit-line-clamp; here it is the numberOfLines prop. What the
 * creator writes is a line count on both sides; how to truncate is the renderer's choice.
 */
export function textStyleOf(value: RuntimeHostValue): {
	style: NativeTextStyle;
	lines: number | null;
} {
	const style: NativeTextStyle = {};
	let lines: number | null = null;
	if (value === null) return { style, lines };
	if (!isRecord(value)) throw contract("style: expected an object");
	for (const key of Object.keys(value)) {
		const entry = value[key] as RuntimeHostValue;
		switch (key) {
			case "color":
				style.color = colorValue(`style.${key}`, entry);
				break;
			case "fontSize":
				style.fontSize = finiteNumber(key, entry);
				break;
			case "fontWeight":
				style.fontWeight = enumValue(key, entry, FONT_WEIGHT);
				break;
			case "align":
				style.textAlign = enumValue(key, entry, TEXT_ALIGN);
				break;
			case "lines": {
				const count = finiteNumber(key, entry);
				if (!Number.isInteger(count) || count < 1)
					throw contract("style.lines: expected a positive integer");
				lines = count;
				break;
			}
			case "opacity":
				style.opacity = opacityValue(key, entry);
				break;
			default:
				throw contract(`style.${key}: unknown text style property`);
		}
	}
	return { style, lines };
}

export function progressStyleOf(value: RuntimeHostValue): NativeProgressStyle {
	const style: NativeProgressStyle = {};
	if (value === null) return style;
	if (!isRecord(value)) throw contract("style: expected an object");
	for (const key of Object.keys(value)) {
		if (key !== "width")
			throw contract(`style.${key}: unknown progress style property`);
		style.width = lengthValue(key, value[key] as RuntimeHostValue);
	}
	return style;
}
