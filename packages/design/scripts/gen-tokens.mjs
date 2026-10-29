import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Generator that produces tokens.css and tokens.native.ts from tokens.ts. Several hand-maintained
 * copies of the tokens let one get updated while the others stay stale, usually dark mode, since it
 * is less visible. The values live only in `tokens.ts`, and every consumer shape is emitted from
 * it.
 * - tokens.ts (oklch): the single source.
 * - tokens.css: web output, CSS variables as-is (browsers read oklch).
 * - tokens.native.ts: native output, converted to hex. React Native's color parser has no oklch,
 *   and it folds unknown strings into a silent null. Both outputs come from one run. A separate
 *   script for native output would let someone who changed a color run only one of them, leaving a
 *   mismatch that shows up only in the app. The `.ts` file cannot be read directly, so the script
 *   relies on Node 24's type stripping (`--experimental-strip-types`, the default from Node 24). If
 *   this script fails, the CSS stays in its previous state.
 */

const here = dirname(fileURLToPath(import.meta.url));
const { lightColors, darkColors, radius, colorNames } = await import(
  join(here, "../src/tokens.ts")
);
const { motionDurationMs, motionEasing } = await import(
  join(here, "../src/motion.ts")
);
const { oklchToHex } = await import(join(here, "../src/oklch.ts"));

// Check first that light and dark have the same set of keys. A color present in only one theme
// resolves its `var()` to an empty value in the other, and renders transparent without any error.
const lightKeys = new Set(Object.keys(lightColors));
const darkKeys = new Set(Object.keys(darkColors));
const onlyLight = [...lightKeys].filter((k) => !darkKeys.has(k));
const onlyDark = [...darkKeys].filter((k) => !lightKeys.has(k));
if (onlyLight.length || onlyDark.length) {
  console.error(
    `token keys diverge: light only: [${onlyLight}], dark only: [${onlyDark}]`,
  );
  process.exit(1);
}

const vars = (colors) =>
  Object.entries(colors)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");

const themeColors = colorNames
  .map((name) => `  --color-${name}: var(--${name});`)
  .join("\n");

/*
 * Motion tokens are also exported as CSS variables. Most motion values (`motionDurationMs`) reach
 * the element through Motion transitions or inline `style`. One place cannot rely on inline styles.
 * Base UI's select popup rewrites the element's style attribute directly for alignment, which wipes
 * the transition values React set. There, the rhythm is carried by a class
 * (`duration-(--motion-duration-*)`), and the variables it references are emitted from the same
 * source (`src/motion.ts`). Hand-writing the values in CSS would create a second source.
 */
/*
 * Default rhythm for `transition-*` classes that set no duration. It is set in the `@theme` block
 * below as `--default-transition-*`. Without it, Tailwind's defaults apply (150ms,
 * `cubic-bezier(0.4, 0, 0.2, 1)`), a value that exists in no token. More than thirty places, such
 * as hover states, focus rings and input borders, that take no rhythm of their own were answering
 * the same press with a different rhythm than the primitive (100ms, `standard`). All of these are
 * an immediate answer to a press, so the default is `primitive`. Places that need a different
 * rhythm state their own value explicitly.
 */
const motionVars = [
  ...Object.entries(motionDurationMs).map(
    ([name, ms]) => `  --motion-duration-${name}: ${ms}ms;`,
  ),
  ...Object.entries(motionEasing).map(
    ([name, curve]) => `  --motion-easing-${name}: cubic-bezier(${curve.join(", ")});`,
  ),
].join("\n");

const css = `/*
 * Generated file: do not edit by hand.
 * Source: packages/design/src/tokens.ts · src/motion.ts
 * Regenerate: pnpm --filter @rowcat/design gen
 */

:root {
${vars(lightColors)}
  --radius: ${radius};
${motionVars}
}

.dark {
${vars(darkColors)}
}

@theme inline {
${themeColors}
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --default-transition-duration: var(--motion-duration-primitive);
  --default-transition-timing-function: var(--motion-easing-standard);
}
`;

writeFileSync(join(here, "../src/tokens.css"), css);

/*
 * Native output. Key order is fixed to `colorNames`, the declaration order of the light palette.
 * Iterating `Object.entries(darkColors)` directly could make the two blocks' line order diverge. A
 * commit that changed no color would then still produce a diff in the generated file, and the drift
 * check would be buried in that noise.
 */
const nativeEntries = (colors) =>
  colorNames
    .map((name) => `\t${JSON.stringify(name)}: ${JSON.stringify(oklchToHex(colors[name]))},`)
    .join("\n");

const native = `/*
 * Generated file: do not edit by hand.
 * Source: packages/design/src/tokens.ts (oklch)
 * Regenerate: pnpm --filter @rowcat/design gen
 *
 * React Native cannot read oklch(); the conversion's rationale is in the src/oklch.ts header.
 */

import type { ColorName } from "./tokens.ts";

export const nativeLightColors: Record<ColorName, string> = {
${nativeEntries(lightColors)}
};

export const nativeDarkColors: Record<ColorName, string> = {
${nativeEntries(darkColors)}
};
`;

writeFileSync(join(here, "../src/tokens.native.ts"), native);
console.log(`generated tokens.css · tokens.native.ts (${colorNames.length} colors)`);
