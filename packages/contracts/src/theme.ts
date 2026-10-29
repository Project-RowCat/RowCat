import { z } from "zod";

/**
 * Account theme protocol for `/v2/me/theme-customization`. There are three axes with different
 * owners:
 * - Base appearance (system | light | dark): per device. It is not sent here, so there is no
 *   `theme`, `scheme` or `mode` field.
 * - Account preset (default | white | gray | black): per account. Any member can choose it.
 * - Custom colors (background, surface, primary, and one gradient): per account. Any member can
 *   choose them. The preset and the colors stay in separate writes, so neither erases the other. A
 *   preset is a name whose values RowCat owns. Custom colors are values the member sent. Splitting
 *   them keeps a preset change from wiping saved colors, and keeps color saves from reverting the
 *   preset. Presets were free and custom colors were limited to `Cattower` subscribers. Payments were
 *   removed from the public build (`docs/oss/PLAN.md` §3), so the eligibility flag
 *   (`customColorsActive`) was removed too. A flag that is always true only leaves a branch in the
 *   readers. There is one palette for both appearances. The chosen colors apply in light and dark
 *   alike, and the appearance decides only the unchosen tokens. Splitting the palette would make
 *   the user decide twice and double the form, save and validation logic. Readability holds because
 *   foreground is derived from the chosen color. `light` and `dark` keys are rejected with 400 by
 *   `.strict()`. Not accepted here:
 * - Foreground color. A user could pick #ffffff for both background and foreground and lose the
 *   ability to read their own screen. `@rowcat/design` derives it from the contrast calculation.
 * - Arbitrary semantic token names. The shape is a closed set of three, not `Record<string,
 *   string>`. A free key would make any stored string a runtime color name, turning the feature
 *   into a style injection surface.
 * - CSS. Image URLs, fonts, declarations, `var()`, `color-mix()` and `linear-gradient(...)`
 *   strings all fail `ThemeColorHex`. That one pattern keeps user input from becoming CSS. The
 *   gradient is built on this rule: only a color and an integer travel (`ThemeGradientDto`), and
 *   the web serializes the CSS string from them. No CSS string is stored, cached or sent.
 * - Target member. Living under `/me` is the rule, the same as billing, notifications and sync.
 */

/**
 * Account-selectable preset: a closed set of four. The member sends a name, never a color value.
 * The schema has no slot for a shape like `{ preset: { background: '#ffffff' } }`. Accepting such a
 * shape would turn presets into a second arbitrary-color surface, with the same color stored by two
 * paths and no way to say which wins. Color values live in `@rowcat/design`
 * (`resolveThemePresetOverrides`). This contract does not carry that table, for two reasons.
 * Refining the palette must not change the wire contract. And the stored value has to be the name:
 * if values were stored, everyone who already chose a preset would stay locked to the old colors,
 * while stored names pick up palette changes. `default` means no account override. The other three
 * are neutral palettes. Taste colors such as blue, red or purple belong to custom colors, not
 * presets. If the preset vocabulary grew to include tastes, the same decision would be made on two
 * surfaces. Case is not folded: `WHITE` and `Dark` are rejected. Unlike color strings, this is a
 * vocabulary a browser never rewrites, and accepting variants would give the stored value two
 * canonical spellings.
 */
export const ThemePreset = z.enum(["default", "white", "gray", "black"]);
export type ThemePreset = z.infer<typeof ThemePreset>;

/**
 * Value for an account that has chosen nothing. It is the storage default and the target of a
 * reset.
 */
export const DEFAULT_THEME_PRESET: ThemePreset = "default";

/**
 * A color: opaque sRGB hex only. `#rgb` shorthand, 8-digit alpha, and `rgb()`, `hsl()` and
 * `oklch()` are rejected. The narrowness has three reasons:
 * 1. It is not an injection surface. The value ends up in CSS custom properties and the native
 *    color parser. Every widening of the syntax adds room for something that looks like a color to
 *    pass.
 * 2. Both platforms read the same value. React Native's color parser does not know `oklch()`,
 *    and it folds unknown strings into `null` rather than raising an error, so the style disappears
 *    silently.
 * 3. Contrast calculation always holds. With alpha, the system could not know what a foreground
 *    sits on, so a derived foreground would lose its readability guarantee. Uppercase hex digits
 *    are accepted and folded to lowercase, since browser color inputs often emit uppercase.
 *    Rejecting them would tell the user nothing about what went wrong. Only one spelling may be
 *    stored, though. If the same color were stored under two strings, 'did it change?' would depend
 *    on casing.
 */
export const ThemeColorHex = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, "Only #rrggbb colors can be used.")
	.transform((value) => value.toLowerCase());
export type ThemeColorHex = z.infer<typeof ThemeColorHex>;

/**
 * Background gradient: only the second end and the direction. The first end is `background`. That
 * value does other jobs too: the foreground derives from it, the scrollbar appearance reads its
 * brightness, and on mobile without this presentation layer it is the plain background. Writing the
 * first end here as well would store one color under two values that would eventually diverge, and
 * then nothing could say which is the real first end. No CSS is accepted, and there is no slot for
 * a `linear-gradient(...)` string. The reasoning is the same as for `ThemeColorHex`. The string is
 * produced by the web's serializer, which accepts only values that passed this schema. `css`,
 * `stops`, `positions`, `type`, `radial`, `conic`, `repeat` and `backgroundImage` are all rejected
 * with 400 by `.strict()`. The angle is an integer, and 360 is not accepted. A real number would
 * let the same direction be stored as both `135` and `135.0000001`, so 'did it change?' would
 * depend on floating-point error. 360 is rejected because it is the same direction as 0. If both
 * were accepted, a member who slid to the end and back would enable the save button, and that save
 * would change nothing. The editor normalizes input at its own boundary.
 */
export const ThemeGradientDto = z
	.object({
		/** Second gradient end. Uses the same color syntax as `background`. */
		to: ThemeColorHex,
		/** Direction in degrees. `0` is up, and angles run clockwise, as in CSS `deg`. */
		angle: z.number().int().min(0).max(359),
	})
	.strict();
export type ThemeGradientDto = z.infer<typeof ThemeGradientDto>;

/**
 * Account selection: a color set plus one background presentation. Everything is optional.
 * `.strict()` is the point of this schema. zod's default silently drops unknown keys, so a client
 * that sent a typo would get a success response and believe its colors were saved. The old nested
 * format (`light` and `dark` palettes) is also covered: without strictness, such a request would
 * silently collapse to an empty document and erase the stored colors. An omitted field means 'use
 * the RowCat default', not 'leave unchanged' (see PUT below). A gradient cannot exist without a
 * background. The `.refine` below enforces that. It lives in the schema because the rule is
 * structural: a gradient without a first end cannot be drawn. If the service folded it silently,
 * the client would receive success, believe the gradient was stored, and find no gradient on the
 * next read. Responses use the same schema, but this rule does not fire there. A row with a
 * background-less gradient is read back with the gradient key omitted, so the server cannot produce
 * such a document.
 */
export const ThemeCustomizationDto = z
	.object({
		/**
		 * The page's bottom color. Foreground derives from it. When a gradient is present, this becomes
		 * the first end. It is still a single opaque color either way.
		 */
		background: ThemeColorHex.optional(),
		/**
		 * Reference point for the neutral UI family. The three primary surfaces that hold text (card,
		 * popover, sidebar) take the chosen color as-is. The layers above them (muted, secondary, accent)
		 * and borders (border, input) are derived from it by `@rowcat/design`. Each field still takes a
		 * single color. Derived token names are rejected by `.strict()`.
		 */
		surface: ThemeColorHex.optional(),
		/** Used for emphasized controls and focus indication. */
		primary: ThemeColorHex.optional(),
		/** Optional background gradient. When present, `background` above is its first end. */
		gradient: ThemeGradientDto.optional(),
	})
	.strict()
	.refine((value) => !value.gradient || Boolean(value.background), {
		message: "A gradient must be set together with a background color.",
		path: ["gradient"],
	});
export type ThemeCustomizationDto = z.infer<typeof ThemeCustomizationDto>;

/**
 * Full account theme state for `GET /v2/me/theme-customization`.
 * - `preset`: the preset currently chosen.
 * - `customization`: the saved custom colors, layered on top of the preset. The two fields are
 *   independent. Changing the preset keeps the colors, and clearing the colors keeps the preset.
 */
export const ThemeCustomizationStateDto = z.object({
	/**
	 * An account that has not chosen is `default`. The field is always present in the response;
	 * absence is never used to express it.
	 */
	preset: ThemePreset,
	customization: ThemeCustomizationDto,
});
export type ThemeCustomizationStateDto = z.infer<
	typeof ThemeCustomizationStateDto
>;

/**
 * Preset selection. The body holds only a name, and there is no slot for colors. `.strict()` means
 * a request that includes a color field fails with 400. It is not silently ignored, because a
 * client that sent colors would believe they were saved. Custom colors are not touched. If choosing
 * a preset erased stored colors, one tap on a preset would lose the colors the user had picked.
 */
export const ThemePresetUpdateRequest = z
	.object({ preset: ThemePreset })
	.strict();
export type ThemePresetUpdateRequest = z.infer<typeof ThemePresetUpdateRequest>;

/**
 * Save custom colors. This replaces the whole document, as PUT means. PATCH was not used because
 * clearing would need a special representation. With merge semantics, reverting one field needs a
 * shape like `{ primary: null }`, where `null` and an omitted key mean different things, and each
 * client implements that difference differently. Replacement removes the question: what is sent is
 * exactly what is stored, and an empty document (`{}`) means reset to no custom colors. The
 * gradient follows the same rule. Omitting it means 'remove the stored gradient', not 'leave it'.
 * That is all the `Turn off gradient` control in the editor does. It has no endpoint of
 * its own, because a separate endpoint would turn one save button into two round trips, with a
 * state in which only one succeeded. The preset is not touched. The absence of a `preset` field
 * here is the structural form of that promise. If a color save reset the preset to `default`, the
 * user would see a change they never made.
 */
export const ThemeCustomizationUpdateRequest = ThemeCustomizationDto;
export type ThemeCustomizationUpdateRequest = z.infer<
	typeof ThemeCustomizationUpdateRequest
>;
