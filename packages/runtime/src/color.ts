import { RUNTIME_ERROR_CODE, RuntimeError } from "./internal/errors.ts";
import { RUNTIME_COLOR } from "./internal/symbols.ts";

/**
 * Colors are only #rgb, #rrggbb and #rrggbbaa, and the type encodes that fact.
 *
 * - `#${string}` was rejected because it accepts far more than the docs promise ("#", "#zzzz").
 *   That mismatch is silent: the host would later reject all those values at once.
 * - Counting digits in the type (six HexDigit slots) is not representable. The template union has
 *   about 110 million members, past TypeScript's union limit (TS2590). Verified on the repo's tsgo
 *   7 and on TypeScript 5.9.3, which the compiler and Monaco use. Even when it errors, that type
 *   checks nothing. Only the 3-digit form (10,648 members) is representable.
 * - Validation therefore moves to the call site. A recursive conditional type over the generic
 *   parameter counts characters one at a time and admits exactly the three formats. The cost is the
 *   call shape: color("#ff00aa").
 * - TypeScript is not a boundary. The type only constrains literals the author writes. Stored or
 *   computed values bypass it, so the same rule is checked again at runtime (isRuntimeColor).
 *   Renderer-side validation is not part of this slice.
 */

type HexDigit =
	| "0"
	| "1"
	| "2"
	| "3"
	| "4"
	| "5"
	| "6"
	| "7"
	| "8"
	| "9"
	| "a"
	| "b"
	| "c"
	| "d"
	| "e"
	| "f"
	| "A"
	| "B"
	| "C"
	| "D"
	| "E"
	| "F";

/**
 * Marks that a non-hex character was seen. Do not use `never` here: `never extends 3 | 6 | 8` is
 * true (never is assignable to everything), so an invalid value such as `#ggg` would pass. The
 * first implementation written this way let `#ggg` through.
 */
type NotHex = "rowcat.not-hex";

/**
 * Counts characters one slot at a time. No union is built, so the cost grows linearly with length.
 */
type HexLength<S extends string, Acc extends unknown[] = []> = S extends ""
	? Acc["length"]
	: S extends `${infer Head}${infer Rest}`
		? Head extends HexDigit
			? HexLength<Rest, [...Acc, unknown]>
			: NotHex
		: NotHex;

/**
 * Whether this literal is a supported color format. If not, it resolves to `never`, which blocks
 * the call site.
 */
export type ValidHexColor<S extends string> = S extends `#${infer Body}`
	? HexLength<Body> extends 3 | 6 | 8
		? S
		: never
	: never;

/**
 * A value that has passed validation. The brand keeps plain strings out of this slot, which makes
 * the type check a real contract. Without the brand, RuntimeColor would just be string.
 */
export type RuntimeColor = string & { readonly [RUNTIME_COLOR]: "color" };

/** Checks the value at runtime, not the type, for strings that never came from a literal. */
export function isRuntimeColor(value: string): value is RuntimeColor {
	return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

/**
 * Seals a color literal. The parameter is `S & ValidHexColor<S>`, with `S` bare so the literal is
 * inferred. If the literal is outside the formats, the intersection becomes `never` and the call
 * site rejects it. Dynamic strings cannot enter, since `string` is not one of the three formats.
 * That is the honest half of the contract, not a hole: computed colors are narrowed with
 * isRuntimeColor first. An extra overload for plain strings would disable the literal check,
 * because a wrong literal would fall into it and pass.
 */
export function color<S extends string>(
	value: S & ValidHexColor<S>,
): RuntimeColor {
	/**
	 * Values that passed the type are still checked once more. This function can be called where no
	 * type check exists (a JS-ported host, a later VM boundary), and then this line is the only gate.
	 */
	const raw: string = value;
	if (!isRuntimeColor(raw))
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.invalidColor,
			`"${raw}" is not a color. Only #rgb · #rrggbb · #rrggbbaa formats can be used.`,
		);
	return raw;
}
