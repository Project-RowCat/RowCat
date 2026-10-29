import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically checks the boundaries of the account theme. The feature breaks in four ways, and all
 * four are silent on screen or look ordinary in review:
 * 1. Two appliers. If the settings screen starts applying colors too, colors vanish when that
 *    screen is left, or the two layers overwrite each other and mount order decides the result.
 * 2. Custom colors go to device storage. This is the most natural fix for first-paint speed, and
 *    it crosses the account boundary: a logged-out browser keeps the previous user's colors, and
 *    the next user's first screen is painted with them.
 * 3. Payments come back. Custom colors were once limited to paying subscribers, and this file
 *    guarded that entitlement axis. Payments were removed from the public release
 *    (docs/oss/PLAN.md, step 3), which flipped the guard: the theme files must contain no payment
 *    or entitlement vocabulary.
 * 4. Arbitrary CSS gets assembled. Once `--x: ${value}` is built from strings, the feature stops
 *    being a color picker and becomes a style injection surface.
 *
 * These tests check policy, not rendered output, because the web tests have no React rendering. The
 * questions can be answered from source alone.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			out.push(...sourceFiles(path));
			continue;
		}
		if (extname(path) !== ".ts" && extname(path) !== ".tsx") continue;
		if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;
		out.push(path);
	}
	return out;
}

/**
 * Source with comments stripped.
 *
 * Comments in this repo explain why, and they name things that were deliberately not done (why not
 * `localStorage`, why `expiresAt` is not computed). Counting those names as violations would flag
 * the file that documents the rule, and that pressure would push toward deleting the comments.
 */
const withoutComments = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FILES = sourceFiles(SRC).map((path) => ({
	path: relative(SRC, path),
	text: withoutComments(readFileSync(path, "utf8")),
}));

/**
 * Files that handle theme colors: the apply layer, the settings editor section, and the helpers
 * that write to the DOM.
 */
const THEME_FILES = FILES.filter(
	(file) =>
		file.path.startsWith("features/theme/") ||
		file.path.startsWith("lib/theme/") ||
		file.path.startsWith("features/settings/theme-customization"),
);

describe("the files to scan exist", () => {
	it("the scan found something", () => {
		expect(FILES.length).toBeGreaterThan(100);
		expect(THEME_FILES.length).toBeGreaterThanOrEqual(4);
	});
});

describe("there is one applier", () => {
	/**
	 * The call that writes color into the document must live in the apply layer only. If the settings
	 * screen starts calling it, colors vanish when the user leaves that screen.
	 */
	it("only the apply layer sets custom properties", () => {
		const callers = FILES.filter(
			(file) =>
				/** The file that defines the function is not counted as a caller of itself. */
				file.path !== "lib/theme/color-overrides.ts" &&
				/\bapplyThemeColorOverrides\s*\(/.test(file.text),
		).map((file) => file.path);

		expect(callers).toEqual(["features/theme/account-theme-bridge.tsx"]);
	});

	/** The apply layer must actually be mounted at the root. Otherwise colors never paint. */
	it("the root mounts the apply layer", () => {
		const root = FILES.find((file) => file.path === "routes/__root.tsx");
		expect(root?.text).toContain("<AccountThemeBridge />");
	});

	/**
	 * The settings section only edits. Saves are applied after the cache by the apply layer, so this
	 * file must not touch the document.
	 */
	it("the settings section does not touch the document directly", () => {
		for (const file of THEME_FILES) {
			if (!file.path.startsWith("features/settings/")) continue;
			expect(file.text, file.path).not.toContain("documentElement");
			expect(file.text, file.path).not.toContain("setProperty");
		}
	});
});

describe("account colors do not go down to device storage", () => {
	/**
	 * The device value is a single brightness preference (`system|light|dark`,
	 * lib/theme/provider.tsx). Storing colors next to it in unscoped storage would put account values
	 * there, which is the leak itself.
	 */
	it("files that handle color do not use browser storage", () => {
		for (const file of THEME_FILES) {
			if (file.path === "lib/theme/provider.tsx") continue;
			for (const storage of [
				"localStorage",
				"sessionStorage",
				"indexedDB",
				"document.cookie",
			])
				expect(file.text, `${file.path} — ${storage}`).not.toContain(storage);
		}
	});

	/**
	 * The reverse direction is checked too. If the brightness-preference provider starts storing
	 * colors, the same defect appears in that file.
	 */
	it("the brightness preference provider does not store colors", () => {
		const provider = FILES.find(
			(file) => file.path === "lib/theme/provider.tsx",
		);
		expect(provider).toBeDefined();
		expect(provider?.text).not.toMatch(/customization|#[0-9a-fA-F]{6}/);
		expect(provider?.text).toContain("localStorage.setItem(storageKey, next)");
	});
});

describe("the theme does not know about billing", () => {
	/**
	 * A natural change that re-locks custom colors would add one of these words. Such a diff looks
	 * ordinary in review. On screen, colors users could pick would silently stop working.
	 */
	it("no billing or entitlement vocabulary in theme files", () => {
		for (const file of THEME_FILES)
			for (const symbol of [
				"billingSummaryQueryOptions",
				"cattowerSubscriptionQueryOptions",
				"invalidateCattowerEntitlement",
				"hasEntitlement",
				"customColorsActive",
				'to="/billing"',
			])
				expect(file.text, `${file.path} — ${symbol}`).not.toContain(symbol);
	});
});

describe("one palette — appearance does not split account colors", () => {
	/**
	 * Color resolution does not take a `scheme`. The palette is single, so custom color resolution is
	 * independent of appearance. Appearance only changes the default tokens already split by the :root
	 * and .dark blocks in tokens.css. Passing `scheme` into the resolver revives the removed model,
	 * where custom colors change with the OS appearance. That symptom shows up only on that account.
	 *
	 * The rule does not count words. An earlier version checked that the apply layer contains no text
	 * matching `scheme` at all, which is broader than the real invariant. Platform chrome appearance
	 * is a different axis and does fall back to the device appearance (scrollbars, default form
	 * controls). A broad rule would push the commit that wires that axis to delete the rule. So this
	 * checks the argument of the resolver.
	 */
	it("does not pass appearance to the color resolver", () => {
		const bridge = FILES.find(
			(file) => file.path === "features/theme/account-theme-bridge.tsx",
		);
		expect(bridge).toBeDefined();
		expect(bridge?.text).toContain("resolveEffectiveThemeOverrides(");

		for (const file of THEME_FILES)
			for (const resolver of [
				"resolveEffectiveThemeOverrides",
				"resolveThemeColorOverrides",
				"resolveThemePresetOverrides",
			])
				expect(file.text, `${file.path} — ${resolver}`).not.toMatch(
					new RegExp(`${resolver}\\([^)]*\\bscheme\\b`),
				);
	});

	/** No appearance-specific palette vocabulary returns to the code. */
	it("no per-appearance palette access", () => {
		for (const file of THEME_FILES) {
			expect(file.text, file.path).not.toMatch(/customization\.(light|dark)\b/);
			expect(file.text, file.path).not.toContain("themeOverridesFor");
			expect(file.text, file.path).not.toContain("ThemePaletteCustomization");
			expect(file.text, file.path).not.toContain("THEME_SCHEME_LABEL");
		}
	});
});

describe("platform chrome — the class is the device's, only colorScheme is layered", () => {
	const bridge = () =>
		FILES.find(
			(file) => file.path === "features/theme/account-theme-bridge.tsx",
		)?.text ?? "";

	/**
	 * The account theme must not change the root .light/.dark classes. Adding a dark class for the
	 * black preset looks like the shortest fix for this bug, but that one line swaps every remaining
	 * semantic token the preset does not cover (muted, border, destructive, charts) to another
	 * palette. It would fold two axes, device preference and account palette, into one. Only the
	 * brightness provider touches classes.
	 */
	it("account theme code does not touch the root class", () => {
		for (const file of THEME_FILES) {
			if (file.path === "lib/theme/provider.tsx") continue;
			expect(file.text, file.path).not.toContain("classList.add");
			expect(file.text, file.path).not.toContain("classList.remove");
			expect(file.text, file.path).not.toContain("classList.toggle");
		}
	});

	/**
	 * Only one place may write `style.colorScheme`. If the two axes (device appearance and account
	 * background) each write it, whichever effect runs last wins. When the OS appearance changes, only
	 * the provider re-renders, so a value unaware of the account background can end up last. The
	 * symptom is quiet: scrollbars go wrong only after an OS appearance change.
	 *
	 * The provider's pre-hydration script is an exception. It is a string that runs before React
	 * mounts, and the account axis does not exist at that point.
	 */
	it("only the chrome layer writes colorScheme", () => {
		const writers = THEME_FILES.filter(
			(file) =>
				file.path !== "lib/theme/provider.tsx" &&
				/\.style\.colorScheme\s*=/.test(file.text),
		).map((file) => file.path);

		expect(writers).toEqual(["lib/theme/chrome-scheme.ts"]);
	});

	/**
	 * The brightness provider does not write that value itself. It notifies the chrome layer instead.
	 */
	it("the brightness provider delegates to the chrome layer", () => {
		const provider =
			FILES.find((file) => file.path === "lib/theme/provider.tsx")?.text ?? "";
		expect(provider).toContain("syncThemeChromeScheme(root)");
		expect(provider).not.toMatch(/root\.style\.colorScheme\s*=/);
	});

	it("the apply layer passes the same overrides to colors and chrome", () => {
		expect(bridge()).toMatch(/applyThemeColorOverrides\(root, overrides\)/);
		expect(bridge()).toMatch(/applyAccountChromeScheme\(root, overrides\)/);
	});

	it("cleanup clears the chrome axis too", () => {
		expect(bridge()).toContain("clearAccountChromeScheme(root)");
	});

	/**
	 * The chrome-axis signal is also sent only from the apply layer, so the settings screen cannot
	 * change the scrollbars.
	 */
	it("only the apply layer announces the chrome axis", () => {
		const callers = FILES.filter(
			(file) =>
				file.path !== "lib/theme/chrome-scheme.ts" &&
				/\bapplyAccountChromeScheme\s*\(/.test(file.text),
		).map((file) => file.path);

		expect(callers).toEqual(["features/theme/account-theme-bridge.tsx"]);
	});

	/**
	 * Save-time preview does not touch the platform chrome. If scrollbars flip while the color picker
	 * is open, the unsaved value has leaked into global state.
	 */
	it("the settings section does not touch the chrome appearance", () => {
		for (const file of THEME_FILES) {
			if (!file.path.startsWith("features/settings/")) continue;
			expect(file.text, file.path).not.toContain("colorScheme");
			expect(file.text, file.path).not.toContain("themeSurfaceScheme");
			expect(file.text, file.path).not.toContain("ChromeScheme");
		}
	});

	/**
	 * The app must not keep its own copy of the brightness judgment. Re-writing the threshold would
	 * make a real mismatch possible: on the same background, text reads as light while the scrollbars
	 * stay in the light scheme.
	 */
	it("the app does not restate the luminance decision", () => {
		const chrome =
			FILES.find((file) => file.path === "lib/theme/chrome-scheme.ts")?.text ??
			"";
		expect(chrome).toContain("themeSurfaceScheme(");
		expect(chrome).not.toContain("relativeLuminance");
		expect(chrome).not.toContain("contrastRatio");
	});
});

describe("composition is done by the shared resolver", () => {
	const bridge = () =>
		FILES.find(
			(file) => file.path === "features/theme/account-theme-bridge.tsx",
		)?.text ?? "";

	/** Composition uses the single shared resolver. The app must not re-write the precedence. */
	it("uses the composition resolver as is", () => {
		expect(bridge()).toContain("effectiveThemeSelection(");
		expect(bridge()).toContain("resolveEffectiveThemeOverrides(");
	});

	/**
	 * No copy of the preset palette. Literal colors in a screen would go stale when the palette is
	 * tuned, and the card would advertise colors that differ from the real ones.
	 */
	it("no color literals in theme files", () => {
		for (const file of THEME_FILES) {
			/**
			 * The two contrast-calculation candidates belong to the design package. If they appear here,
			 * that is a copy.
			 */
			expect(file.text, file.path).not.toMatch(/#[0-9a-fA-F]{6}/);
			expect(file.text, file.path).not.toContain("THEME_PRESET_OVERRIDES");
		}
	});
});

describe("editor shape — four cards and three swatches", () => {
	const section = () =>
		FILES.find(
			(file) =>
				file.path === "features/settings/theme-customization-section.tsx",
		);

	/**
	 * Does not open the browser's color dialog, not even once. The rule used to be that the native
	 * picker is one of the popover's controls, and that control is what this slice removed. It opens
	 * an OS window whose wording, look, color space, and recent-colors list the app does not control,
	 * and which differs per device. It also lives outside this screen, so it does not move with the
	 * in-popover preview.
	 *
	 * The most common counterexample is hiding that control with CSS and leaving it in place. It
	 * disappears visually but stays for the keyboard and assistive technology, and the next person
	 * wires two pickers together without knowing the first is alive. So the test asserts absence
	 * rather than counting.
	 */
	it("no native color input anywhere", () => {
		for (const file of THEME_FILES) {
			expect(file.text, file.path).not.toContain('type="color"');
			expect(file.text, file.path).not.toMatch(
				/createElement\(\s*["']input["']/,
			);
		}
	});

	/** The app's own picker replaces it and lives inside the popover. */
	it("the popover opens the RowCat picker", () => {
		const text = section()?.text ?? "";
		expect(text).toContain("PopoverContent");
		expect(text).toContain("<ThemeColorPicker");
	});

	/**
	 * Picker rules live in a pure module. The web tests in this repo have no React rendering. If the
	 * crop coordinates, hue-family preservation, and partial-input handling sat inside the component,
	 * the only check would be manual trial, and all three fail silently. A drag that passes through
	 * gray, for example, can lose purple, and it takes several drags before anyone notices.
	 */
	it("the picker goes through the pure rule", () => {
		const picker = FILES.find(
			(file) =>
				file.path === "features/settings/theme-customization-picker.tsx",
		);
		expect(picker).toBeDefined();
		for (const symbol of [
			"pointToSv(",
			"pointToHue(",
			"openThemeColorPicker(",
			"themeColorPickerWithHsv(",
			"themeColorPickerWithHex(",
		])
			expect(picker?.text, symbol).toContain(symbol);
	});

	/**
	 * Opening the picker does not change the draft. An empty slot's picker starts from the preset
	 * color. If the mount effect sent that color to the parent, a user who picked nothing would enable
	 * the save button, and saving would freeze the preset color as a custom value. Changing the preset
	 * later would then not move that user's colors. So the call that emits a draft lives only in
	 * user-interaction handlers.
	 */
	it("the picker does not emit the draft from an effect", () => {
		const picker =
			FILES.find(
				(file) =>
					file.path === "features/settings/theme-customization-picker.tsx",
			)?.text ?? "";
		expect(picker).not.toContain("useEffect");
		expect(picker).not.toContain("useLayoutEffect");
	});

	/**
	 * HSV does not leave this folder. Storage, contracts, and the query cache still know colors only
	 * as `#rrggbb`. Sending the axis to the server would create two representations of the same color,
	 * which would diverge on a single rounding step.
	 */
	it("the save request carries no axis", () => {
		const state =
			FILES.find(
				(file) =>
					file.path === "features/settings/theme-customization-state.ts",
			)?.text ?? "";
		for (const axis of ["hue", "saturation", "brightness", "alpha"])
			expect(state, axis).not.toContain(axis);
	});

	/** Custom color rows are generated from the slot list, not from separate light and dark sets. */
	it("color rows come from the slot list", () => {
		const text = section()?.text ?? "";
		expect(text).toContain("THEME_CUSTOMIZATION_SLOTS.map(");
		expect(text).not.toMatch(/\[\s*["']light["']\s*,\s*["']dark["']\s*\]/);
	});

	/**
	 * Preset cards come from the vocabulary list too. Hand-listing the four would miss entries
	 * whenever the vocabulary grows.
	 */
	it("preset cards come from the vocabulary list", () => {
		const text = section()?.text ?? "";
		expect(text).toContain("THEME_PRESET_ORDER.map(");
		expect(text).toContain("themePresetSwatch(");
		expect(text).not.toMatch(/\[\s*["']default["']\s*,\s*["']white["']\s*,/);
	});

	/**
	 * Preset cards form a real radio group. A `<button role="radio">` tells assistive technology that
	 * one of four is chosen but does not keep the other half of that promise. Arrow-key movement is
	 * not provided by the browser; it must be implemented with a roving tabindex. Without it, keyboard
	 * users must Tab through all four. Mouse users see no symptom from the mismatch.
	 */
	it("presets are native radios and do not imitate role", () => {
		const text = section()?.text ?? "";
		expect(text).toContain('type="radio"');
		expect(text).not.toContain('role="radio"');
		expect(text).not.toContain('role="radiogroup"');
		/**
		 * Radios must share one `name` to form a group, which is what makes arrow-key movement work. The
		 * test pins the real `presetGroupName` value, not an invented string.
		 */
		expect(text).toMatch(/name=\{presetGroupName\}/);
	});

	/**
	 * Preset writes are separate from custom-color writes. Combining them into one save would let a
	 * request that changes only the preset erase saved colors, because the write has replace semantics
	 * and an omitted color field clears it.
	 */
	it("the two writes go through their own mutations", () => {
		const text = section()?.text ?? "";
		expect(text).toContain("saveThemePresetMutationOptions");
		expect(text).toContain("saveThemeColorsMutationOptions");
	});

	/**
	 * Both sections are locked only while they are running. An earlier version also locked the lower
	 * section by entitlement. If that condition returns, this test fails first. Rather than counting
	 * words across the whole file, the test finds the fieldset wrapping each section and checks its
	 * opening tag, because counts across both sections mix and say nothing.
	 */
	it("both fieldsets lock only while running", () => {
		const text = section()?.text ?? "";
		for (const anchor of [
			"THEME_PRESET_ORDER.map(",
			"THEME_CUSTOMIZATION_SLOTS.map(",
		]) {
			const at = text.indexOf(anchor);
			expect(at, anchor).toBeGreaterThan(0);
			const open = text.lastIndexOf("<fieldset", at);
			expect(open, anchor).toBeGreaterThan(0);
			const tag = text.slice(open, text.indexOf(">", open) + 1);
			expect(tag, anchor).toContain("disabled={pending}");
		}
	});

	/**
	 * Pre-save feedback is a single preview inside the section. The global document changes only after
	 * save.
	 */
	it("there is a contained preview", () => {
		const text = section()?.text ?? "";
		expect(text).toContain("themePreviewColors(");
		expect(text).toContain("<ThemePreview");
	});

	/**
	 * An invalid draft cannot reach save. The request conversion returns `null`, and the button locks
	 * on that value. If this wiring is missing, one typo would, under replace semantics, save and
	 * erase the colors.
	 */
	it("save locks on the request's existence", () => {
		const text = section()?.text ?? "";
		expect(text).toContain("themeRequestFrom(");
		expect(text).toMatch(/request === null/);
	});

	/**
	 * Reset does not show success in advance. Clearing the draft on press would make a failed request
	 * look like a reset browser. The only path is for the server-confirmed response to land in the
	 * cache first, with the draft following it.
	 */
	it("does not clear the draft right before reset", () => {
		const text = section()?.text ?? "";
		expect(text).not.toMatch(/setDraft\([^)]*EMPTY_THEME_DRAFT[^)]*\)/);
		expect(text).toContain("clearColors.mutate()");
		expect(text).toContain("resetAll.mutate()");
	});

	/**
	 * Both reset items are locked while running. The test looks from the item's opening tag to its
	 * label. The same name also appears in the import list, so the test searches for the last
	 * occurrence (the JSX usage).
	 */
	it("the reset item locks while running", () => {
		const text = section()?.text ?? "";
		for (const label of ["themeClearColorsLabel()", "themeResetAllLabel()"]) {
			const at = text.lastIndexOf(label);
			expect(at, label).toBeGreaterThan(0);

			const open = text.lastIndexOf("<DropdownMenuItem", at);
			expect(open, label).toBeGreaterThan(0);
			const item = text.slice(open, at);

			expect(item, label).toContain("disabled={pending}");
		}
	});

	/**
	 * The color save button is locked while saving, when nothing has changed, and when the draft is
	 * invalid.
	 */
	it("lock conditions of the color save button", () => {
		const text = section()?.text ?? "";
		const at = text.lastIndexOf("themeSaveLabel()");
		const open = text.lastIndexOf("<Button", at);
		expect(text.slice(open, at)).toContain(
			"pending || !dirty || request === null",
		);
	});
});

describe("editor hierarchy — choose, see, refine, save", () => {
	const section = () =>
		FILES.find(
			(file) =>
				file.path === "features/settings/theme-customization-section.tsx",
		)?.text ?? "";

	/**
	 * Only the editor body is inspected. The loading-state set (placeholder, no connection, failure)
	 * uses the same pattern, but it stands in place of the editor rather than being part of it.
	 * Counting across the whole file would say nothing about the editor's counts.
	 */
	const editorBody = () => {
		const text = section();
		const open = text.indexOf("function ThemeEditor(");
		const close = text.indexOf("function ThemeResetMenu(");
		expect(open, "no ThemeEditor").toBeGreaterThan(0);
		expect(close, "no ThemeResetMenu").toBeGreaterThan(open);
		return text.slice(open, close);
	};

	/**
	 * Two frames, and that is the whole story of this editor. SettingsRowFrame is the vocabulary for
	 * separate settings (a border plus vertical spacing). At one point six of them sat inside this
	 * editor, but those six were parts of one editor, not independent settings: preset, the
	 * custom-color section title, the lock notice, preview, color rows, and the action row. The screen
	 * read as 'setting · setting · setting · setting · action · action' instead of 'choose · look ·
	 * refine · save'.
	 *
	 * When this count grows, the change is almost always 'split off another section'. That split
	 * should be expressed inside the editor with spacing and text hierarchy, not with new frames.
	 */
	it("two SettingsRowFrames inside the editor", () => {
		const frames = editorBody().match(/<SettingsRowFrame\b/g) ?? [];
		expect(frames.length).toBe(2);
	});

	/**
	 * Do not wrap the editor in a new Card either. The settings screen builds hierarchy without cards.
	 */
	it("the editor does not wrap in a Card", () => {
		const text = section();
		expect(text).not.toContain("components/card");
		expect(text).not.toMatch(/<Card\b/);
	});

	/**
	 * Reading order is the order of action: preset cards, then preview, then color rows, then
	 * gradient, then save. While the preview sat below the color rows, the question a user asks after
	 * tapping a card ('how does this look?') had its answer after the swatches and gradient controls,
	 * which forced a scroll.
	 */
	it("the preview stands between presets and color rows", () => {
		const text = editorBody();
		const presets = text.indexOf("THEME_PRESET_ORDER.map(");
		const preview = text.indexOf("<ThemePreview");
		const rows = text.indexOf("THEME_CUSTOMIZATION_SLOTS.map(");

		expect(presets).toBeGreaterThan(0);
		expect(preview).toBeGreaterThan(presets);
		expect(rows).toBeGreaterThan(preview);
	});

	/** Commit is always last. The save button comes after the color rows. */
	it("save stands after the editing controls", () => {
		const text = editorBody();
		expect(text.lastIndexOf("themeSaveLabel()")).toBeGreaterThan(
			text.indexOf("<ThemeGradientControls"),
		);
	});

	/**
	 * The two reset actions sit behind one trigger. If the action row listed three operations at the
	 * same weight, the screen would say 'pick one of these', while a user who has finished editing
	 * needs only save. An irreversible action at the same size as save was the cost of that layout.
	 *
	 * The vocabulary itself is not collapsed: there are still two items, and each states its scope.
	 */
	it("reset folds behind one secondary trigger", () => {
		const text = section();
		expect(text).toContain("<ThemeResetMenu");
		expect(text).toContain("themeResetMenuLabel()");

		const menu = text.slice(text.indexOf("function ThemeResetMenu("));
		/** The trigger has secondary weight, not a filled button. */
		expect(menu).toMatch(/variant="outline"/);
		/** Both items remain, and an action that does not apply is not drawn. */
		expect(menu).toContain("themeClearColorsLabel()");
		expect(menu).toContain("themeResetAllLabel()");
		expect(menu).toContain("canClearColors &&");
		expect(menu).toContain("canResetAll &&");
		expect(menu).toContain("if (!canClearColors && !canResetAll) return null;");
	});

	/**
	 * No confirmation dialog was added. These actions still run immediately. Adding confirmation while
	 * reorganizing the layout is a separate decision (whether the cost of undo actually requires it),
	 * and it must not be made quietly inside this change.
	 */
	it("reset has no confirmation dialog", () => {
		const text = section();
		expect(text).not.toContain("AlertDialog");
		expect(text).not.toContain("window.confirm");
	});

	/**
	 * The `Random palette` button acts on the color rows, so it sits next to them. While it sat beside the
	 * section title, it had the same weight as the title without indicating what it acted on.
	 */
	it("the random button follows the color rows at secondary weight", () => {
		const text = editorBody();
		const rows = text.indexOf("THEME_CUSTOMIZATION_SLOTS.map(");
		const random = text.indexOf("themeRandomPaletteLabel()");
		const heading = text.indexOf("themeCustomGroupTitle()");

		expect(random).toBeGreaterThan(rows);
		expect(rows).toBeGreaterThan(heading);

		const open = text.lastIndexOf("<Button", random);
		expect(text.slice(open, random)).toContain('variant="outline"');
	});

	/**
	 * The gradient details are children of the switch. The rule that they render only while enabled is
	 * unchanged. What changed is the visual nesting: indentation and a left rule. Without it, the `Background
	 * gradient`, `Start color`, `End color`, and `Direction` controls would sit at the same weight as the three color rows
	 * above, and the editor would appear to hold seven settings.
	 */
	it("gradient details are indented under the switch", () => {
		const text = section();
		const at = text.indexOf("{gradient.enabled && (");
		expect(at).toBeGreaterThan(0);

		const details = text.slice(at, at + 200);
		expect(details).toMatch(/border-l/);
		expect(details).toMatch(/pl-4/);
	});

	/**
	 * The end-color row must have its own description rather than reuse the switch's sentence. A
	 * repeated paragraph reads like a manual, and it hides that the two rows answer different
	 * questions.
	 */
	it("the end color row has its own description", () => {
		const text = section();
		expect(text).toContain("themeGradientToDescription()");
		/*
		 * Anchors on the JSX usage site. Searching by text position (the old `indexOf(…, 2000)`) breaks
		 * when the import list grows by a line. It would then find the name inside the import list and
		 * report a sorted neighbor name as a violation.
		 */
		const at = text.indexOf("controlName={themeGradientToControlName()}");
		expect(at).toBeGreaterThan(-1);
		expect(text.slice(at, at + 200)).not.toContain(
			"themeGradientToggleDescription()",
		);
	});
});

describe("background gradient — a different axis with one owner", () => {
	const bridge = () =>
		FILES.find(
			(file) => file.path === "features/theme/account-theme-bridge.tsx",
		)?.text ?? "";

	/**
	 * This is the one place that builds a CSS string from account values. The test counts the function
	 * that builds the declaration, not the word `linear-gradient`. The color picker also builds a
	 * gradient string, but it is a color-scale tick (six computed hues joined) with no user value in
	 * it. Counting words would flag that file, and the pressure would be to remove the rule. A second
	 * builder would eventually skip validation, and that would be the style injection surface.
	 */
	it("one function builds the account gradient string", () => {
		const definitions = FILES.filter((file) =>
			/function themeGradientCss|const themeGradientCss/.test(file.text),
		).map((file) => file.path);
		expect(definitions).toEqual(["lib/theme/background-gradient.ts"]);

		/** The TS file that knows the property name must be that same single owner. */
		const owners = FILES.filter((file) =>
			file.text.includes("--account-background-image"),
		).map((file) => file.path);
		expect(owners).toEqual(["lib/theme/background-gradient.ts"]);
	});

	/**
	 * Preview has no grammar of its own. The gradient in the swatch box and the display after save
	 * must pass through the same function. If they diverged, the difference would appear only after
	 * saving.
	 */
	it("the preview uses the same serializer", () => {
		const callers = FILES.filter(
			(file) =>
				file.path !== "lib/theme/background-gradient.ts" &&
				/\bthemeGradientCss\s*\(/.test(file.text),
		).map((file) => file.path);

		expect(callers).toEqual([
			"features/settings/theme-customization-section.tsx",
		]);
	});

	/**
	 * The application site is single too. If the settings screen started calling it, the gradient
	 * would disappear on leaving that screen, and an unsaved draft would leak into global state.
	 */
	it("only the apply layer puts the gradient on the document", () => {
		const callers = FILES.filter(
			(file) =>
				file.path !== "lib/theme/background-gradient.ts" &&
				/\bapplyAccountBackgroundGradient\s*\(/.test(file.text),
		).map((file) => file.path);

		expect(callers).toEqual(["features/theme/account-theme-bridge.tsx"]);
	});

	/**
	 * Cleanup also clears the gradient. Without this line, logout or account switching would leave the
	 * previous user's background on the next user's first screen, until a reload.
	 */
	it("cleanup clears the gradient axis too", () => {
		expect(bridge()).toContain("clearAccountBackgroundGradient(root)");
	});

	/**
	 * The apply layer does not resolve the gradient itself. Calling `resolveThemeGradient` here would
	 * make color and gradient resolution two places. If one drifted, a gradient matching no selection
	 * anyone made would remain.
	 */
	it("the apply layer gets the gradient from the shared resolver", () => {
		expect(bridge()).toContain("resolveEffectiveThemeGradient(selection)");
		expect(bridge()).not.toMatch(/resolveThemeGradient\s*\(/);
	});

	/**
	 * Does not overwrite semantic color names. When `--background` becomes an image, every place that
	 * reads it as a color turns transparent without any error. That silence makes this mistake the
	 * most expensive.
	 */
	it("no image in semantic color names", () => {
		for (const file of THEME_FILES) {
			expect(file.text, file.path).not.toMatch(
				/setProperty\(\s*["'`]--(background|card|popover|sidebar|primary)["'`]/,
			);
			expect(file.text, file.path).not.toMatch(
				/--background\s*:\s*linear-gradient/,
			);
		}
	});

	/**
	 * Platform chrome still reads a solid reference color. The scrollbar asks whether the floor is
	 * light right now, and the answer is one semantic color that is neither end of the gradient.
	 */
	it("the chrome layer does not know the gradient", () => {
		const chrome =
			FILES.find((file) => file.path === "lib/theme/chrome-scheme.ts")?.text ??
			"";
		for (const symbol of [
			"gradient",
			"Gradient",
			"backgroundImage",
			"linear-gradient",
		])
			expect(chrome, symbol).not.toContain(symbol);
	});
});

describe("random palette — entirely local", () => {
	const section = () =>
		FILES.find(
			(file) =>
				file.path === "features/settings/theme-customization-section.tsx",
		)?.text ?? "";

	/**
	 * No server call. The button only computes a color, and that result is saved through the normal
	 * color save. There is no dedicated endpoint, no model call, and no path that combines a save with
	 * the randomizer.
	 */
	it("no random-only server path", () => {
		for (const file of FILES)
			for (const forbidden of [
				"random-theme",
				"randomPalette(",
				"generatePaletteMutation",
				"client.theme.random",
				"savePalette(",
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});

	/**
	 * Does not save on press. If the save mutation were attached to the random button, a user who
	 * pressed it several times would change their account theme each time, with no way to undo.
	 */
	it("the random action does not also save", () => {
		const text = section();
		const at = text.indexOf("themeDraftWithRandomPalette");
		expect(at).toBeGreaterThan(0);

		/** The handler's only effect is a draft update, so no mutation call may appear near it. */
		const handler = text.slice(at - 400, at + 400);
		expect(handler).not.toContain(".mutate(");
	});

	/**
	 * The pure rule module must not call `Math.random` itself. Otherwise the property 'a generated
	 * palette is always readable' could not be checked by value, because the randomness source would
	 * be hidden inside the module.
	 */
	it("the pure rule does not call the random source directly", () => {
		const state =
			FILES.find(
				(file) =>
					file.path === "features/settings/theme-customization-state.ts",
			)?.text ?? "";
		expect(state).not.toMatch(/Math\.random/);
		expect(state).toContain("ThemeRandomSource");
	});

	/** Only the editor section may pass in the randomness source. */
	it("only the edit section passes the random source", () => {
		const callers = THEME_FILES.filter((file) =>
			/Math\.random/.test(file.text),
		).map((file) => file.path);
		expect(callers).toEqual([
			"features/settings/theme-customization-section.tsx",
		]);
	});
});

describe("no arbitrary CSS is assembled", () => {
	/**
	 * No `<style>` strings and no declarations joined from templates. The only way to apply is
	 * `setProperty` on a known property name. The list of names is closed by the design package.
	 */
	it("builds no style string", () => {
		for (const file of THEME_FILES) {
			expect(file.text, file.path).not.toContain("dangerouslySetInnerHTML");
			expect(file.text, file.path).not.toContain("insertRule");
			expect(file.text, file.path).not.toMatch(/<style/);
			expect(file.text, file.path).not.toMatch(/`[^`]*--[a-z-]+\s*:[^`]*\$\{/);
		}
	});

	/**
	 * The app does not re-list the color names. If it did, the app side would go stale whenever the
	 * design package widens the table. The symptom would be a property that never gets cleared.
	 */
	it("the app does not restate the managed list", () => {
		const overrides = FILES.find(
			(file) => file.path === "lib/theme/color-overrides.ts",
		);
		expect(overrides?.text).toContain("MANAGED_THEME_COLOR_NAMES");
		expect(overrides?.text).not.toMatch(/"card-foreground"|'card-foreground'/);
	});
});
