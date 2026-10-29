import type { ColorName } from "@rowcat/design";
import { iconSize } from "@rowcat/design";
import Svg, { Path } from "react-native-svg";
import type { IconSize } from "./icon.tsx";
import { useTheme } from "./theme.tsx";

/**
 * Brand marks are not icons. The quickest change would be adding `google` to the table in
 * `icon.tsx`, but that table fails in two ways:
 * - Source: Lucide ships no brand icons, and every entry in that table is a lucide-react-native
 *   glyph.
 * - Color: `Icon` paints one color chosen by `tone`, while the Google mark's identity is its four
 *   colors. A brand in that table would silently ignore `tone` for one entry. That compiles and
 *   renders, and shows no symptom until someone passes `tone='destructive'`. So the vocabularies
 *   are kept apart: different names, different rules.
 *
 * Why this file is exempt from two boundary checks: `react-native-svg` is imported directly because
 * Lucide lacks the drawing, and hex colors are literal because the brand asset must not follow the
 * theme. `boundaries.test.ts` allows both by file name. The list is deliberate, so a new exception
 * has to pass review.
 *
 * Web parity: the paths are copied from `apps/web/src/features/auth/google-mark.tsx` and
 * `apple-mark.tsx`, and their opposite color rules are kept. Google hard-codes four colors. Apple
 * is a monochrome mark that follows the theme color (web's `currentColor` is `tone` here), because
 * its guidelines require contrast with the background. A black Apple mark would vanish on dark
 * buttons in the dark theme.
 */

/**
 * The vocabulary contains only marks the app actually draws. Kakao is intentionally absent. Its
 * value arrives in the commit that adds that provider's login wiring, and its mark comes with it.
 * Adding the name first would create an entry with no drawing that could then be chosen through
 * `Button`'s `brand`.
 */
export type BrandName = "google" | "apple";

/** Decorative. A text label is always provided next to it (`label` on `Button`). */
const DECORATION = {
	accessible: false,
	accessibilityElementsHidden: true,
	importantForAccessibility: "no-hide-descendants",
} as const;

export function BrandMark({
	name,
	size = "md",
	/**
	 * Only the Apple mark reads `tone`. The Google mark's brand colors are its identity, so no value
	 * overrides them. The branch below shows this.
	 */
	tone = "foreground",
}: {
	name: BrandName;
	size?: IconSize;
	tone?: ColorName;
}) {
	const { colors } = useTheme();
	const box = iconSize[size];

	if (name === "google")
		return (
			<Svg viewBox="0 0 48 48" width={box} height={box} {...DECORATION}>
				<Path
					fill="#EA4335"
					d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
				/>
				<Path
					fill="#4285F4"
					d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
				/>
				<Path
					fill="#FBBC05"
					d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.28-3.14.76-4.59l-7.97-6.19A23.9 23.9 0 0 0 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
				/>
				<Path
					fill="#34A853"
					d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48z"
				/>
			</Svg>
		);

	return (
		<Svg viewBox="0 0 24 24" width={box} height={box} {...DECORATION}>
			<Path
				fill={colors[tone]}
				d="M16.365 1.43c0 1.14-.42 2.2-1.13 3.02-.85.99-2.24 1.76-3.4 1.67a3.7 3.7 0 0 1-.03-.42c0-1.1.5-2.26 1.14-2.98.77-.87 2.06-1.53 3.3-1.58l.12.29zM20.9 17.02c-.55 1.27-.82 1.84-1.53 2.97-.99 1.57-2.39 3.53-4.12 3.54-1.54.02-1.93-1-4.02-.99-2.09.01-2.52 1.01-4.06.99-1.73-.01-3.05-1.78-4.04-3.35C.36 15.79-.06 10.6 1.7 8.03c1.25-1.84 3.22-2.91 5.08-2.91 1.89 0 3.08 1.04 4.65 1.04 1.52 0 2.44-1.04 4.63-1.04 1.65 0 3.4.9 4.65 2.45-4.09 2.24-3.43 8.08.19 9.45z"
			/>
		</Svg>
	);
}
