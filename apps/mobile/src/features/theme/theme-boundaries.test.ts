import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * This app's account theme. Presets and solid colors are editable here; the background gradient is
 * only carried through, never drawn or edited.
 *
 * The boundary is narrower than it used to be. It once said "consume only, never edit", which was
 * right while `/settings` did not exist. This app now has a theme editor:
 *
 * ```text
 * four presets          pick
 * three custom colors   edit
 * background gradient   not drawn · not edited · **not erased either**
 * ```
 *
 * Four regressions this file guards against, each quiet or ordinary-looking in review:
 *
 * 1. **The base appearance moves below authentication.** It is the most natural fix when adding
 *    an override layer, and then the login, waiting and error screens render without colors — the
 *    three screens a user sees first.
 * 2. **`ThemedChrome` stays outside the override layer.** The screen has a custom background,
 *    but the default background flashes for a frame on every transition.
 * 3. **A second store appears.** This value belongs to the account, so a local copy in SQLite or
 *    SecureStore would never receive colors edited on the web.
 * 4. **The gradient leaks into the editor, or a save erases it.** This app must have no code
 *    that draws it and no control that edits it, yet color writes replace the whole value, so an
 *    unsent gradient is erased. That loss leaves no trace on this app's screens.
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

const withoutComments = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FILES = sourceFiles(SRC).map((path) => ({
	path: relative(SRC, path),
	text: withoutComments(readFileSync(path, "utf8")),
}));

const fileAt = (path: string) => FILES.find((file) => file.path === path);

describe("the files to scan actually exist", () => {
	it("the scan found something", () => {
		expect(FILES.length).toBeGreaterThan(50);
		expect(fileAt("features/theme/viewer-theme-override.tsx")).toBeDefined();
	});
});

describe("there are two theme layers and their order is the rule", () => {
	const layout = () => fileAt("app/_layout.tsx")?.text ?? "";

	/**
	 * The base appearance is the **outermost** layer. Below the identity provider, the login, waiting
	 * and error screens would render without colors.
	 *
	 * `DeviceAppearanceProvider` occupies this slot: it reads the device preference and mounts
	 * `ThemeProvider` inside itself (`lib/appearance/provider.tsx`). If the two were separated, the
	 * place that reads brightness and the place that builds colors would mount without knowing about
	 * each other, and a frame in the default appearance would appear between them.
	 */
	it("the base appearance layer is outside identity", () => {
		const text = layout();
		expect(text.indexOf("<DeviceAppearanceProvider>")).toBeGreaterThanOrEqual(
			0,
		);
		expect(text.indexOf("<DeviceAppearanceProvider>")).toBeLessThan(
			text.indexOf("<MobileIdentityProvider>"),
		);
	});

	/**
	 * **There is exactly one place that mounts `ThemeProvider`.** If a screen mounted another one
	 * inside its own tree, everything below would render in colors unrelated to the device preference,
	 * and that mismatch would show only on that screen.
	 */
	it("one file stands the base theme", () => {
		const owners = FILES.filter((file) =>
			/<ThemeProvider\b/.test(file.text),
		).map((file) => file.path);
		expect(owners).toEqual(["lib/appearance/provider.tsx"]);
	});

	/**
	 * **The brightness preference lives outside identity.** If this layer moved below the member
	 * scope, there would be nowhere to keep a guest's choice, and switching accounts would reset
	 * brightness too.
	 */
	it("the brightness layer is outside the member store", () => {
		const text = layout();
		expect(text.indexOf("<DeviceAppearanceProvider>")).toBeLessThan(
			text.indexOf("<ViewerScopedLocalData>"),
		);
	});

	/** Account colors sit below identity: above it, there is no way to say whose colors they are. */
	it("the override layer is inside identity", () => {
		const text = layout();
		expect(text.indexOf("<MobileIdentityProvider>")).toBeLessThan(
			text.indexOf("<ViewerThemeOverride>"),
		);
	});

	/**
	 * **`ThemedChrome` is inside the override layer.** The status bar and stack-transition background
	 * must read the effective color; outside this layer, the default background flashes for one frame
	 * on every screen transition.
	 */
	it("the native shell is inside the override layer", () => {
		const text = layout();
		const open = text.indexOf("<ViewerThemeOverride>");
		const close = text.indexOf("</ViewerThemeOverride>");
		const chrome = text.indexOf("<ThemedChrome />");
		expect(open).toBeGreaterThanOrEqual(0);
		expect(chrome).toBeGreaterThan(open);
		expect(chrome).toBeLessThan(close);
	});

	/** Overrides are applied in one place. If each screen applied them, mount order would decide the result. */
	it("one file draws the override layer", () => {
		const users = FILES.filter((file) =>
			/<ThemeColorOverrideProvider\b/.test(file.text),
		).map((file) => file.path);
		expect(users).toEqual(["features/theme/viewer-theme-override.tsx"]);
	});
});

describe("the status bar follows the effective background", () => {
	const layout = () => fileAt("app/_layout.tsx")?.text ?? "";

	/**
	 * **The icon color is not chosen from `scheme`.**
	 *
	 * This line used to be `scheme === "dark" ? "light" : "dark"`. Its flaw is that the two inputs
	 * come from different sources: `scheme` is the **device appearance**, while `colors.background`
	 * already carries the account theme. The moment an account overrides the background they diverge
	 * (device light + black preset → black icons on a black background). That symptom raises no error.
	 */
	it("the shell reads the effective background instead of the appearance", () => {
		const text = layout();
		expect(text).toContain("statusBarStyleForBackground(colors.background)");
		expect(text).not.toMatch(/scheme === "dark" \? "light" : "dark"/);
		/** The component no longer extracts `scheme` at all, so there is nowhere to use it. */
		expect(text).toMatch(/const \{ colors \} = useTheme\(\)/);
		expect(text).not.toMatch(/const \{ colors, scheme \} = useTheme\(\)/);
	});

	/** Does not revert to the automatic mode that follows the OS appearance. */
	it("StatusBar doesn't fall back to the OS appearance", () => {
		expect(layout()).not.toContain('style="auto"');
	});

	/**
	 * One place does the flip. `expo-status-bar`'s `style` sets the **icon color**, not the background
	 * brightness, and the value is inverted once. If each screen wrote that ternary, one would
	 * eventually be written backwards, and the mistake would show only on that screen.
	 */
	it("one pure module decides icon colors", () => {
		const callers = FILES.filter(
			(file) =>
				file.path !== "features/theme/chrome-scheme.ts" &&
				/\bstatusBarStyleForBackground\s*\(/.test(file.text),
		).map((file) => file.path);
		expect(callers).toEqual(["app/_layout.tsx"]);

		const helper = fileAt("features/theme/chrome-scheme.ts")?.text ?? "";
		/** Brightness classification is done by the **same function** as on the web; no second luminance formula. */
		expect(helper).toContain("themeSurfaceScheme(");
		expect(helper).not.toContain("relativeLuminance");
		expect(helper).not.toContain("contrastRatio");
	});
});

describe("doesn't create a second store", () => {
	const theme = () =>
		FILES.filter((file) => file.path.startsWith("features/theme/"));

	/**
	 * This is an account value, so no copy goes into device storage. A copy would keep colors edited
	 * on the web from reaching this app, and would keep the previous person's colors after an account
	 * switch.
	 */
	it("doesn't use device storage", () => {
		for (const file of theme())
			for (const storage of [
				"expo-sqlite",
				"expo-secure-store",
				"AsyncStorage",
				"local-data",
			])
				expect(file.text, `${file.path} — ${storage}`).not.toContain(storage);
	});

	/**
	 * **Payment vocabulary does not come back.** Custom colors were once reserved for a paying
	 * subscriber tier. Billing was removed from the public release (`docs/oss/PLAN.md` §3), so if that
	 * vocabulary reappeared in this layer, colors everyone was able to pick would be silently blocked.
	 */
	it("doesn't use billing or entitlement vocabulary", () => {
		for (const file of theme())
			for (const symbol of [
				"customColorsActive",
				"invalidateCattowerEntitlement",
				"billingSummaryQueryOptions",
			])
				expect(file.text, `${file.path} — ${symbol}`).not.toContain(symbol);
	});

	/** Query keys and policy belong to the shared package; this app does not create mobile-only keys. */
	it("uses the shared query options as is", () => {
		const bridge =
			fileAt("features/theme/viewer-theme-override.tsx")?.text ?? "";
		expect(bridge).toContain("themeCustomizationQueryOptions");
		expect(bridge).toContain("effectiveThemeSelection");
		expect(bridge).not.toMatch(/queryKey:/);
	});
});

describe("the shared resolver does the composition", () => {
	const bridge = () =>
		fileAt("features/theme/viewer-theme-override.tsx")?.text ?? "";

	/** Composition is done by one shared resolver; this app does not restate the precedence. */
	it("uses the composition resolver as is", () => {
		expect(bridge()).toContain("resolveEffectiveThemeOverrides(");
	});

	/**
	 * **Do not copy the preset palette.** Writing it out would make the web's `Black` and this app's
	 * `Black` slightly different blacks, and the difference shows only when the two screens are compared
	 * side by side.
	 */
	it("no preset color literals in this app", () => {
		for (const file of FILES) {
			if (!file.path.startsWith("features/theme/")) continue;
			expect(file.text, file.path).not.toMatch(/#[0-9a-fA-F]{6}/);
			expect(file.text, file.path).not.toContain("THEME_PRESET_OVERRIDES");
		}
	});
});

describe("there's one palette — appearance doesn't split account colors", () => {
	/**
	 * **The override layer does not read the appearance (`scheme`).** The palette is single, so
	 * custom-color resolution takes no appearance input. When the OS changes appearance, only the
	 * parent `ThemeProvider`'s default table changes; the chosen cells stay. If this file started
	 * reading `scheme` again, the removed model of "custom colors that depend on appearance" would
	 * return, and the symptom would appear only on accounts whose OS appearance changed.
	 */
	it("the override layer doesn't read the appearance", () => {
		const bridge =
			fileAt("features/theme/viewer-theme-override.tsx")?.text ?? "";
		expect(bridge).not.toMatch(/\bscheme\b/);
		expect(bridge).toContain("resolveEffectiveThemeOverrides(");
	});

	/** No appearance-specific palette vocabulary comes back. */
	it("no per-appearance palette access", () => {
		for (const file of FILES) {
			expect(file.text, file.path).not.toContain("themeOverridesFor");
			expect(file.text, file.path).not.toMatch(/customization\.(light|dark)\b/);
		}
	});
});

describe("background gradient — not drawn, but not erased either", () => {
	/**
	 * **A web-only expression.** If the account saves a gradient, the web page background is drawn in
	 * two colors. This app uses that background's **solid reference point** (`background`) instead.
	 * That value is a semantic token, so cards, text and the status bar all stay consistent. What is
	 * lost is one layer of expression, not the theme.
	 *
	 * Drawing it here would add a native dependency (`expo-linear-gradient`, which requires a rebuild)
	 * and require the app's background to have a single owner. Neither decision was asked for by this
	 * slice.
	 */
	it("doesn't draw the gradient", () => {
		for (const file of FILES)
			for (const symbol of [
				"resolveEffectiveThemeGradient",
				"resolveThemeGradient",
				"themeGradientCss",
				"themeGradientForeground",
				"defaultThemeGradient",
				"linear-gradient",
				"expo-linear-gradient",
				"react-native-linear-gradient",
			])
				expect(file.text, `${file.path} — ${symbol}`).not.toContain(symbol);
	});

	/** No gradient editor either: no control is drawn that would let someone pick a value this app cannot edit. */
	it("no gradient editing vocabulary", () => {
		for (const file of FILES)
			for (const forbidden of [
				"Background gradient",
				"themeDraftWithGradient",
				"generateRandomTheme",
				"Random palette",
			])
				expect(file.text, `${file.path} — ${forbidden}`).not.toContain(
					forbidden,
				);
	});

	/**
	 * **Yet saving must not erase it either. This is the most important check in this group.**
	 *
	 * Color writes are replacements: what is sent is the entire stored value. If this app's request
	 * conversion dropped the gradient slots, a save that changed one color here would **erase** the
	 * gradient made on the web, and the loss would leave no trace on this app's screens (the gradient
	 * is never drawn here in the first place). The user finds out the next time they open the web.
	 */
	it("the request conversion sends the saved gradient back again", () => {
		const state =
			fileAt("features/settings/theme-customization-state.ts")?.text ?? "";
		expect(state).toContain("draft.gradient");
		expect(state).toMatch(/out\.gradient\s*=\s*draft\.gradient/);
		/** Without a start point, nothing is sent; the contract rejects that request. */
		expect(state).toMatch(/draft\.gradient\s*&&\s*out\.background/);
	});

	/**
	 * **And the value being carried must not go stale — this is where this slice made a fix.**
	 *
	 * If the draft-sync effect depended only on the **visible slots**, a change that altered only the
	 * gradient on the web would arrive here without re-running the effect, and the draft would keep
	 * the old value. The next color save, being a replacement, would **restore the web's newest
	 * gradient**. The decision lives in a pure module so it can be checked: this app's tests do not
	 * render screens, so the only way to verify a rule inside a dependency array is to try it on two
	 * devices.
	 */
	it("draft sync observes the gradient too", () => {
		const editor =
			fileAt("features/settings/theme-customization-section.tsx")?.text ?? "";
		expect(editor).toMatch(/\}, \[themeDraftSyncKey\(saved\)\]\)/);
		/** Does not revert to the old dependency that watched only the visible slots. */
		expect(editor).not.toMatch(
			/\[\s*saved\.background,\s*saved\.surface,\s*saved\.primary\s*\]/,
		);

		const state =
			fileAt("features/settings/theme-customization-state.ts")?.text ?? "";
		expect(state).toMatch(/export function themeDraftSyncKey\b/);
		expect(state).toContain("draft.gradient.to");
		expect(state).toContain("draft.gradient.angle");
	});

	/**
	 * **But that observation must not wipe local edits either — this is where this slice made a fix.**
	 *
	 * Resetting the whole draft when the snapshot changes (`setDraft(saved)`) would pay for the
	 * observation above: every change that arrives with only the **gradient** altered on the web would
	 * also discard unsaved color edits on this screen. That revert has no explanation on screen
	 * either.
	 *
	 * So "what changed" (`themeDraftSyncKey`) and "what to change to" (`syncThemeDraftFromServer`) are
	 * kept apart, and the latter is a **pure function**. This app's tests do not render screens, so if
	 * that rule lived inside the effect there would be no way to check it by value.
	 */
	it("draft sync goes through the pure merge function", () => {
		const editor =
			fileAt("features/settings/theme-customization-section.tsx")?.text ?? "";
		expect(editor).toContain("syncThemeDraftFromServer(");
		/** Does not revert to the old line that overwrote the whole snapshot. */
		expect(editor).not.toMatch(/setDraft\(saved\)/);
		/** The basis for classification is the **previous server snapshot**, not the current draft. */
		expect(editor).toContain("previousSavedRef");

		const state =
			fileAt("features/settings/theme-customization-state.ts")?.text ?? "";
		expect(state).toMatch(/export function syncThemeDraftFromServer\b/);
		/** Compares two server snapshots (comparing `current` would read local edits as remote changes). */
		expect(state).toMatch(/themeDraftEquals\(previousSaved,\s*nextSaved\)/);
	});

	/**
	 * **Sync and `dirty` are kept apart.** Merging them would turn on this screen's `Save colors` button the
	 * moment only the gradient changed on the web, and the user would see an edit they never made. In
	 * this app, only the three visible slots can be edited.
	 */
	it("the `dirty` decision looks only at the three visible cells", () => {
		const editor =
			fileAt("features/settings/theme-customization-section.tsx")?.text ?? "";
		expect(editor).toMatch(/const dirty = !themeDraftEquals\(draft, saved\)/);

		const state =
			fileAt("features/settings/theme-customization-state.ts")?.text ?? "";
		const equals = state.slice(
			state.indexOf("export function themeDraftEquals"),
		);
		expect(equals.slice(0, equals.indexOf("\n}"))).not.toContain("gradient");
	});
});

describe("the editor's hierarchy — choose · see · refine · save", () => {
	const source = () =>
		fileAt("features/settings/theme-customization-section.tsx")?.text ?? "";

	/**
	 * Only the body of the editor is examined. The import list contains the same names, so comparing
	 * positions across the whole file would make every ordering check below point at that list.
	 */
	const editor = () => {
		const text = source();
		const open = text.indexOf("function ThemeEditor(");
		const close = text.indexOf("function ThemeResetMenu(");
		expect(open, "there's no ThemeEditor").toBeGreaterThan(0);
		expect(close, "there's no ThemeResetMenu").toBeGreaterThan(open);
		return text.slice(open, close);
	};

	/**
	 * **Reading order is doing order.**
	 *
	 * ```text
	 * preset cards → preview → three color rows → save
	 * ```
	 *
	 * While the preview was its own section after the direct settings section, the answer to the
	 * question a person asks next after tapping a card ("how does this look?") sat below the color
	 * rows, which forced scrolling. The web follows the same order.
	 */
	it("the preview stands between the presets and the color rows", () => {
		const text = editor();
		const presets = text.indexOf("THEME_PRESET_ORDER.map(");
		const preview = text.indexOf("THEME_PREVIEW_NOTE");
		const rows = text.indexOf("THEME_CUSTOMIZATION_SLOTS.map(");

		expect(presets).toBeGreaterThan(0);
		expect(preview).toBeGreaterThan(presets);
		expect(rows).toBeGreaterThan(preview);
	});

	/**
	 * **The preview has no heading.** The card inside the box already draws `Theme preview`; adding a
	 * heading above it would show the same word twice in a column.
	 */
	it("doesn't draw the preview title twice", () => {
		const text = editor();
		expect((text.match(/THEME_PREVIEW_TITLE/g) ?? []).length).toBe(1);
	});

	/**
	 * **Commit is last.** The person who adjusted the color rows should not have to scroll up to find
	 * save, and right beside that button the note says that changes apply only after saving.
	 */
	it("save stands after the color rows and says it's a draft", () => {
		const text = editor();
		expect(text.lastIndexOf("THEME_SAVE_LABEL")).toBeGreaterThan(
			text.indexOf("THEME_CUSTOMIZATION_SLOTS.map("),
		);
		expect(text).toContain("THEME_SAVE_NOTE");
	});

	/**
	 * **The two reset actions sit behind one trigger.**
	 *
	 * Two full-width buttons used to exist (one inside this section, one at the bottom of the screen),
	 * each the same size as `Save colors`. The person finishing an edit needs one action, save, but the
	 * screen presented three at equal weight.
	 *
	 * **The vocabulary is not collapsed** — there are still two items, and each states its own scope.
	 */
	it("reset folds behind one trigger", () => {
		const text = source();
		expect(text).toContain("<ThemeResetMenu");
		expect(text).toContain("THEME_RESET_MENU_LABEL");

		const menu = text.slice(text.indexOf("function ThemeResetMenu("));
		expect(menu).toContain("THEME_CLEAR_COLORS_LABEL");
		expect(menu).toContain("THEME_RESET_ALL_LABEL");
		expect(menu).toContain("if (!canClearColors && !canResetAll) return null;");

		/** Does not revert to the old full-width layout; that would carry the same weight as save. */
		const clear = text.lastIndexOf("THEME_CLEAR_COLORS_LABEL");
		expect(text.slice(clear - 200, clear)).not.toContain("fullWidth");
		const reset = text.lastIndexOf("THEME_RESET_ALL_LABEL");
		expect(text.slice(reset - 200, reset)).not.toContain("fullWidth");
	});

	/**
	 * **No confirmation dialog was added.** These actions still run immediately without confirmation;
	 * adding one while reorganizing the layout would be a separate decision.
	 */
	it("reset has no confirm dialog attached", () => {
		expect(source()).not.toContain("AlertDialog");
	});

	/**
	 * **Still no gradient editing and no random palette.** This app can neither draw nor edit the
	 * gradient (see the group above), and a random palette is an action that also rolls that value.
	 * The layout change did not bring in another feature.
	 */
	it("web-only operations didn't come along", () => {
		const text = source();
		for (const forbidden of ["RandomPalette", "themeDraftWithRandom"])
			expect(text, forbidden).not.toContain(forbidden);
	});
});

describe("the editor is in one settings place and the application layer stays as is", () => {
	/**
	 * **The rule this slice reversed.** This place once said "no form here that edits the theme and no
	 * save action", which was right then: with no settings screen in this app, wherever the editor was
	 * placed, some unrelated screen would come to own app-behavior settings.
	 *
	 * That premise no longer holds (`/settings` exists). So instead of asserting absence, this locks
	 * the **location**: the call sites for writes must be that one settings section, and account or
	 * discovery screens must not take those actions.
	 */
	it("one settings file calls the theme writes", () => {
		for (const mutation of [
			"saveThemePresetMutationOptions",
			"saveThemeColorsMutationOptions",
			"clearThemeColorsMutationOptions",
			"resetThemeMutationOptions",
		]) {
			const callers = FILES.filter((file) => file.text.includes(mutation)).map(
				(file) => file.path,
			);
			expect(callers, mutation).toEqual([
				"features/settings/theme-customization-section.tsx",
			]);
		}
	});

	/**
	 * **The SDK is not called directly.** Cache policy (placing the confirmed value into the cache,
	 * and collapsing overlapping calls within the same scope) belongs to `@rowcat/query`. Skipping it,
	 * a save that succeeds still draws the old colors until the refetch finishes, and the person reads
	 * the save as having done nothing.
	 */
	it("doesn't call SDK theme methods directly", () => {
		for (const file of FILES)
			for (const direct of [
				"client.theme.savePreset",
				"client.theme.saveColors",
				"client.theme.clearColors",
				"client.theme.reset",
			])
				expect(file.text, `${file.path} — ${direct}`).not.toContain(direct);
	});

	/**
	 * **The application layer did not change by a single character.** If the editor started painting
	 * colors directly, colors would either reset when the person leaves the settings screen, or two
	 * layers would paint different values. Overrides are still applied by `ViewerThemeOverride` alone
	 * (the check above locks that).
	 */
	it("settings doesn't imitate the override layer", () => {
		const editor =
			fileAt("features/settings/theme-customization-section.tsx")?.text ?? "";
		expect(editor).not.toContain("ThemeColorOverrideProvider");
		expect(editor).not.toContain("resolveEffectiveThemeOverrides");
	});
});
