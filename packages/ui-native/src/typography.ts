import type { FontWeightName } from "@rowcat/design";
import { fontFace, fontWeight } from "@rowcat/design";
import type { TextStyle } from "react-native";

/**
 * Maps a font weight name to a React Native font family and numeric weight. React Native has no
 * variable-font weight axis, so each weight is a separate registered file selected by name. This
 * module only performs that translation.
 *
 * fontWeight is set alongside the family name. Without it, all text renders at one weight whenever
 * the font has not loaded yet or fails to load. That fallback raises no error and erases the
 * heading/body hierarchy. With both set, the hierarchy survives the fallback.
 *
 * Synthetic (faked) bold is not represented. Each family is paired only with its own weight, so
 * reapplying the platform weight is a no-op. A mismatched pair such as Pretendard-Regular with 700
 * would re-bold an already bold glyph on Android, but this table has no place to create such pairs.
 *
 * Font files are not part of this package. Registration (expo-font) belongs to apps/mobile. The
 * name's source is @rowcat/design, so registration and reference use the same string.
 */
export type { FontWeightName };

/**
 * Screens and primitives must not write fontWeight directly. Doing so drops the family name for
 * that spot, so it renders in the system font.
 *
 * The mismatch shows only with Korean text (the Latin glyphs of the two fonts look alike), and only
 * on that screen. boundaries.test.ts enforces this rule.
 */
export function typeface(weight: FontWeightName): TextStyle {
	return { fontFamily: fontFace[weight], fontWeight: fontWeight[weight] };
}
