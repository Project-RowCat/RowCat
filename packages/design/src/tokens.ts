/**
 * Design tokens: the single source of truth. This is plain data, not platform code, so web CSS
 * variables and future React Native styles read the same values.
 *
 * - tokens.css is generated from this file (`pnpm --filter @rowcat/design gen`). Do not edit
 *   either file by hand. Two copies of the colors guarantee that light and dark drift apart.
 * - The brand purple is defined by its hue, 286.2. Chroma (0.23) is shared by both themes, and
 *   lightness is the only per-theme difference, by one step.
 * - Text on the primary surface is light in both themes. Dark text on this chroma passed the
 *   contrast numbers but was hard to read in practice.
 * - `text-primary` cannot meet AA in dark theme, because the same value must serve both as text
 *   on the page background and as text on the primary surface. The surface role was chosen. A
 *   future link style would need its own color, not a retuned token.
 * - The purple sits right at the sRGB boundary (linear blue is 1.0002). Brightening it while
 *   keeping chroma 0.23 leaves the gamut. The converter clips while browsers map differently, so
 *   web and native differ on phones only. The current values are darker than canonical and in
 *   gamut, and the tests enforce that.
 * - Purple is not applied across the app. Surfaces, cards, borders and `accent` stay neutral, and
 *   `destructive`, warning and success keep their own colors. Purple appears only on emphasis
 *   controls and focus indicators.
 */

/** Maps a color name to its oklch value. Keys match CSS variable names exactly. */
export type ColorTokens = Record<string, string>;

/**
 * Uses `satisfies` instead of `: ColorTokens`. With an annotation, keys widen to `string` and
 * `keyof` says nothing. With `satisfies`, literal keys survive, so `ColorName` becomes the real
 * vocabulary, and the compiler checks that dark has the same key set as light (see the typed
 * `darkColors` below). The generator's runtime check stays. It guards the `.js` path that generated
 * output runs through, while this one catches mistakes during editing.
 */
export const lightColors = {
	background: "oklch(1 0 0)",
	foreground: "oklch(0.141 0.005 285.823)",
	card: "oklch(1 0 0)",
	"card-foreground": "oklch(0.141 0.005 285.823)",
	popover: "oklch(1 0 0)",
	"popover-foreground": "oklch(0.141 0.005 285.823)",
	/*
	 * Brand purple, one step darker than the canonical 0.599. Text on this surface is always
	 * normal-size (buttons, badges, user bubbles), and the canonical value gives only 4.16:1 against
	 * it, below AA. Hue and chroma are unchanged. Lowering lightness raises the contrast to 4.71:1.
	 * `text-primary` also serves as text on the white background (link buttons, markdown links), so
	 * that case is checked too (4.92:1).
	 */
	primary: "oklch(0.57 0.23 286.2)",
	"primary-foreground": "oklch(0.985 0 0)",
	secondary: "oklch(0.967 0.001 286.375)",
	"secondary-foreground": "oklch(0.21 0.006 285.885)",
	muted: "oklch(0.967 0.001 286.375)",
	"muted-foreground": "oklch(0.552 0.016 285.938)",
	accent: "oklch(0.967 0.001 286.375)",
	"accent-foreground": "oklch(0.21 0.006 285.885)",
	/*
	 * Light-theme destructive is also a value meant for text. At 0.577 it measured 4.46:1 on white,
	 * just under WCAG AA (4.5:1). That matters where it sits on a lightly tinted destructive surface,
	 * such as the heading of a publish-validation error. Hue and chroma are unchanged. Lowering
	 * lightness reaches 4.81:1.
	 */
	destructive: "oklch(0.55 0.245 27.325)",
	"destructive-foreground": "oklch(0.55 0.245 27.325)",
	border: "oklch(0.92 0.004 286.32)",
	input: "oklch(0.92 0.004 286.32)",
	/*
	 * Focus indicator: brand hue, but weaker than the primary surface. It uses the same hue (286.2)
	 * with lower chroma and higher lightness. Against white it measures 3.28:1, while the primary
	 * surface measures 4.92:1. The earlier neutral gray (0.871) measured 1.48:1, far below the 3:1
	 * non-text threshold. Focus is the only signal that tells keyboard users where they are.
	 *
	 * `border-ring` (the border of a focused input) and `ring-ring/50` (its halo) read this value.
	 *
	 * Lightness was chosen against the sidebar (0.985), not the white background. A slightly darker
	 * surface lowers contrast, and `sidebar-ring` sits on that surface. Checking only white would
	 * leave focus inside the sidebar below threshold. The sidebar case is checked too and reaches
	 * 3.14:1.
	 */
	ring: "oklch(0.66 0.17 286.2)",
	"chart-1": "oklch(0.646 0.222 41.116)",
	"chart-2": "oklch(0.6 0.118 184.704)",
	"chart-3": "oklch(0.398 0.07 227.392)",
	"chart-4": "oklch(0.828 0.189 84.429)",
	"chart-5": "oklch(0.769 0.188 70.08)",
	sidebar: "oklch(0.985 0 0)",
	"sidebar-foreground": "oklch(0.141 0.005 285.823)",
	/*
	 * The sidebar accent belongs to the same purple family. Diverging values would make the same
	 * product use a different color in each section.
	 */
	"sidebar-primary": "oklch(0.57 0.23 286.2)",
	"sidebar-primary-foreground": "oklch(0.985 0 0)",
	"sidebar-accent": "oklch(0.967 0.001 286.375)",
	"sidebar-accent-foreground": "oklch(0.21 0.006 285.885)",
	"sidebar-border": "oklch(0.92 0.004 286.32)",
	"sidebar-ring": "oklch(0.66 0.17 286.2)",
};

/**
 * Vocabulary of color names: the CSS variable names on web, and the keys of the native theme
 * object. `ColorName` is derived from `lightColors`.
 */
export type ColorName = keyof typeof lightColors;

export const darkColors: Record<ColorName, string> = {
	background: "oklch(0.141 0.005 285.823)",
	foreground: "oklch(0.985 0 0)",
	card: "oklch(0.141 0.005 285.823)",
	"card-foreground": "oklch(0.985 0 0)",
	popover: "oklch(0.141 0.005 285.823)",
	"popover-foreground": "oklch(0.985 0 0)",
	/*
	 * One step darker than light. The foreground is light, as in light theme.
	 *
	 * A colored surface looks brighter against a dark background than against white (simultaneous
	 * contrast). Lowering it one step makes the two themes read as the same purple. The direction also
	 * matches the foreground: light text on this surface needs a darker surface, and 0.56 gives 4.92:1
	 * (light is 4.71:1).
	 *
	 * The earlier version was the opposite: a dark foreground on 0.63. Contrast was higher (5.29:1),
	 * but it was harder to read in practice. At that lightness, chroma 0.23 also left sRGB and had to
	 * be trimmed. The two themes now share one chroma and have room in the gamut. The cost is
	 * `text-primary`, whose reasoning is in the header of tokens.ts.
	 */
	primary: "oklch(0.56 0.23 286.2)",
	"primary-foreground": "oklch(0.985 0 0)",
	secondary: "oklch(0.274 0.006 286.033)",
	"secondary-foreground": "oklch(0.985 0 0)",
	muted: "oklch(0.274 0.006 286.033)",
	"muted-foreground": "oklch(0.705 0.015 286.067)",
	accent: "oklch(0.274 0.006 286.033)",
	"accent-foreground": "oklch(0.985 0 0)",
	/*
	 * The dark-theme destructive color must be the lighter side. The earlier value (0.396) was darker
	 * than light (0.577). Destructive is effectively used as text color (`text-destructive`), and dark
	 * red on a dark background fell to 1.98:1, so the `Couldn't save` message was barely visible. That
	 * message is the only signal of an autosave failure.
	 *
	 * Where destructive is used as a surface it is always alpha-blended (`bg-destructive/5` to `/30`,
	 * `border-destructive/40`), so lightening it keeps it a faint tint. No opaque destructive
	 * background has text on it. Light theme already sets destructive and its foreground to the same
	 * value, and dark follows that convention (5.23:1).
	 */
	destructive: "oklch(0.637 0.237 25.331)",
	"destructive-foreground": "oklch(0.637 0.237 25.331)",
	border: "oklch(0.274 0.006 286.033)",
	input: "oklch(0.274 0.006 286.033)",
	/*
	 * Focus must stay below the primary surface on chroma, not lightness (0.155 vs 0.23).
	 *
	 * In light theme, ring is brighter than the primary surface, so lightness separated them. In dark
	 * theme the primary surface is mid-brightness and lightness says nothing. Both sit at a similar
	 * distance from the background, and hierarchy comes from chroma and area.
	 *
	 * Two surfaces are reference points. The dark sidebar (0.21) is lighter than the background
	 * (0.141), so the same value has less contrast there. Checking only the background would let focus
	 * inside the sidebar fall below threshold. Both are checked; they measure 3.72:1 and 3.32:1.
	 */
	ring: "oklch(0.54 0.155 286.2)",
	"chart-1": "oklch(0.488 0.243 264.376)",
	"chart-2": "oklch(0.696 0.17 162.48)",
	"chart-3": "oklch(0.769 0.188 70.08)",
	"chart-4": "oklch(0.627 0.265 303.9)",
	"chart-5": "oklch(0.645 0.246 16.439)",
	sidebar: "oklch(0.21 0.006 285.885)",
	"sidebar-foreground": "oklch(0.985 0 0)",
	/*
	 * This was previously blue (0.488 0.243 264.376), the shadcn default. It equaled `chart-1` and had
	 * nothing to do with the brand. The foreground is on the same bright side as `primary`.
	 */
	"sidebar-primary": "oklch(0.56 0.23 286.2)",
	"sidebar-primary-foreground": "oklch(0.985 0 0)",
	"sidebar-accent": "oklch(0.274 0.006 286.033)",
	"sidebar-accent-foreground": "oklch(0.985 0 0)",
	"sidebar-border": "oklch(0.274 0.006 286.033)",
	"sidebar-ring": "oklch(0.54 0.155 286.2)",
};

/**
 * Base corner radius in rem. Derived values (sm, md, lg, xl) are computed from it. See
 * `radiusBasePx` and `radiusScale`.
 */
export const radius = "0.625rem";

/**
 * Pixel form of the same base radius. React Native has no rem, and all of its style values are
 * density-independent pixels. Instead of writing two values, one is derived. The web `--radius` is
 * 0.625rem, and with the browser's default 16px root font size that equals 10px.
 *
 * The multiplication lives here rather than in the generator, because `radiusScale` is read by
 * non-CSS consumers. The generator still emits the string `radius` unchanged, so web output does
 * not change.
 */
export const radiusBasePx = 10;

/**
 * Derived radii, using the same arithmetic as the `@theme inline` block on web: sm = radius - 4px,
 * md = radius - 2px, lg = radius, xl = radius + 4px.
 *
 * `full` has no CSS counterpart. On web, Tailwind's `rounded-full` is used there, and that value is
 * not one of our tokens. Naming it keeps pill shapes from inventing a number.
 */
export const radiusScale = {
	sm: radiusBasePx - 4,
	md: radiusBasePx - 2,
	lg: radiusBasePx,
	xl: radiusBasePx + 4,
	full: 9999,
} as const;

/**
 * Border width of 1, the same thickness as web's `1px`. The value is the whole token, but that is
 * not obvious, so the reason is recorded here. React Native's style unit and CSS px are both
 * density-independent. `borderWidth: 1` and `border: 1px` are therefore the same physical thickness
 * (three device pixels on a 3x screen), and the two apps' lines match side by side.
 *
 * Warning: while `StyleSheet.hairlineWidth` occupied this value, every native line was thinner than
 * on web. That value is the thinnest line the device can draw: 0.33 on a 3x screen, and 0.67 even
 * doubled, about two-thirds of web. Cards, inputs, dividers, headers, outline buttons and outline
 * badges all used it, so native edges looked consistently faint next to web. The justification
 * written there (at 1 it becomes three device pixels thick on 3x) was true, but web draws exactly
 * that too. The comparison was missing.
 *
 * No true hairline need exists in this repo (such as iOS table separators). If one appears, use
 * `StyleSheet.hairlineWidth` at that spot and record why.
 */
export const borderWidth = 1;

/**
 * Spacing scale on a 4px base, using the same steps as web's Tailwind scale. In the 4px unit: xs =
 * 1, sm = 2, md = 3, lg = 4, xl = 6, 2xl = 8, 3xl = 12.
 *
 * The steps have names rather than numbers so both platforms use the same word. Web applies these
 * as classes and native as numbers, but the decision that a gap is `md` is made once.
 */
export const space = {
	px: 1,
	xs: 4,
	sm: 8,
	md: 12,
	lg: 16,
	xl: 24,
	"2xl": 32,
	"3xl": 48,
} as const;

/**
 * Semantic type scale. Web uses `text-xs` and `text-sm` directly, and here the difference is
 * naming, not hierarchy. `caption` (12) equals web's `text-xs`. `body` at 15 is one step larger
 * than web's 14, on purpose, because reading distance differs between a screen seen at arm's length
 * and one held in the hand. Naming the steps matters because, without names, screens mixed 13, 14
 * and 15, which had happened.
 */
export const fontSize = {
	caption: 12,
	label: 13,
	body: 15,
	title: 17,
	heading: 20,
	display: 24,
} as const;

/**
 * Each size is paired with its line height so one value cannot change alone. Changing only the font
 * size makes long paragraphs run together, and short text does not reveal the problem.
 */
export const lineHeight = {
	caption: 16,
	label: 18,
	body: 22,
	title: 24,
	heading: 28,
	display: 32,
	/*
	 * The one unpaired value: a second line height for the same `body` size. It plays the role of
	 * web's `leading-7` (28px) for long text, versus the default for short lines. It is named because
	 * three places need it (work descriptions, comment bodies, assistant replies). Those used to be
	 * 22, 25 and 22. None matched web, and nothing in the code showed they were the same thing.
	 */
	reading: 28,
} as const;

/**
 * Weights are strings because React Native's `fontWeight` takes that form. The scale matches web's
 * `font-medium`, `font-semibold` and `font-bold`.
 */
export const fontWeight = {
	regular: "400",
	medium: "500",
	semibold: "600",
	bold: "700",
	/*
	 * Web's `font-black`. It is used only for screen titles: discovery, chat list, create, work titles
	 * and profile names. Utility screens (account, notifications, billing) use `bold`. Folding the two
	 * together would make destinations and tools read at the same weight. Web keeps the distinction in
	 * classes, and for a while this scale had no top slot.
	 */
	black: "900",
} as const;

/** Name of a weight in the scale above. `fontFace` is indexed by these names. */
export type FontWeightName = keyof typeof fontWeight;

/**
 * The identity of the body font: what the product is set in. It is a shared token, like color and
 * spacing, because if each platform chose its own, the same screen would render in different
 * glyphs. This matters most for Korean. If unset, the device picks its own (Apple SD Gothic Neo,
 * Malgun Gothic, Noto Sans KR), and letter spacing and glyph height differ enough to change the
 * line count.
 *
 * This value was missing for a while, and its absence rendered the two apps in different fonts. The
 * web app fixed Pretendard (`--font-sans` in ui-web/src/styles/globals.css), while native used the
 * platform default. The rationale written for that choice said the web also uses a system font
 * stack, which was never true. Keeping the value here prevents that mismatch from recurring.
 */
export const fontFamilyName = "Pretendard";

/**
 * Maps each weight to the name of the font file registered for it. Web loads one variable font and
 * moves the weight axis with `font-weight`, so it does not read this table. Native has no such
 * axis: each weight is a separate file registered under its own name.
 *
 * The table lives here rather than in `ui-native`, because two packages consume it: the one that
 * registers the files (`apps/mobile`) and the one that references the names (`@rowcat/ui-native`).
 * If only one side is edited, a typo becomes a silent fallback to the system font, since an unknown
 * `fontFamily` falls back rather than erroring.
 *
 * It has four entries because `fontWeight` has four. The type checks this.
 */
export const fontFace = {
	regular: "Pretendard-Regular",
	medium: "Pretendard-Medium",
	semibold: "Pretendard-SemiBold",
	bold: "Pretendard-Bold",
	black: "Pretendard-Black",
} as const satisfies Record<FontWeightName, string>;

/**
 * Tracking for headings, matching web's `tracking-tight` (-0.025em). It is a ratio because web's
 * `em` scales with the font size, but React Native's `letterSpacing` is absolute. Each size must
 * multiply this value, or a fixed value makes tracking tuned at 24pt look twice as wide at 17pt. It
 * applies only to headings. Web applies no tracking to body text, labels or captions either.
 */
export const trackingTight = -0.025;

/**
 * Icon sizes equal to web's `size-3`, `size-4` and `size-5`.
 *
 * Control heights are absent on purpose. Web buttons are 36px and native minimum touch targets are
 * 44pt. Those are different answers to different input devices, not two expressions of one
 * decision. A single value would be wrong on one platform, and the wrong side is the finger.
 * Control dimensions belong to each platform's UI package.
 */
export const iconSize = {
	sm: 12,
	md: 16,
	lg: 20,
	/*
	 * The first three sizes sit beside text (web's `size-3`, `size-4`, `size-5`). The last two are for
	 * icons that stand alone: web's `size-6` (the empty-state image box) and `size-10` (the
	 * work-detail cover placeholder). They share the scale because they are icons too. The names keep
	 * screens from hardcoding 28 or 40.
	 */
	xl: 24,
	"2xl": 40,
} as const;

/** Color name list. The generator checks that light and dark share the same key set. */
export const colorNames: ColorName[] = Object.keys(lightColors) as ColorName[];
