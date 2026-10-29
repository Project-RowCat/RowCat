import {
	resolveEffectiveThemeOverrides,
	resolveThemePresetOverrides,
} from "@rowcat/design";
import { beforeEach, describe, expect, it } from "vitest";
import {
	applyAccountChromeScheme,
	baseThemeChromeScheme,
	clearAccountChromeScheme,
	resolveThemeChromeScheme,
	syncThemeChromeScheme,
} from "./chrome-scheme.ts";

/**
 * Guards where the browser chrome's appearance is decided: scrollbars, default form controls, and
 * the caret. None of them read our tokens, so a flip in the effective background gives no warning;
 * the symptom is a white scrollbar beside a black page.
 * - If the account overrides the background, derive the chrome from it.
 * - Otherwise, follow device and default appearance. No DOM is mounted: the layer only reads one
 *   root class and writes style.colorScheme, so a fake element is enough.
 */

function fakeRoot(base: "light" | "dark") {
	const classes = new Set<string>([base]);
	const style = { colorScheme: base as string };
	return {
		element: {
			classList: {
				contains: (name: string) => classes.has(name),
			},
			style,
		} as unknown as HTMLElement,
		style,
		/** Device appearance changed: the same thing the provider does when it swaps classes. */
		setBase(next: "light" | "dark") {
			classes.delete("light");
			classes.delete("dark");
			classes.add(next);
		},
	};
}

const PRESET = (name: "white" | "gray" | "black" | "default") =>
	resolveEffectiveThemeOverrides({
		preset: name,
		customization: null,
	});

const PRESET_WITH_CUSTOM = (
	name: "white" | "gray" | "black" | "default",
	background: string,
) =>
	resolveEffectiveThemeOverrides({
		preset: name,
		customization: { background },
	});

/**
 * The module keeps an account axis (so device appearance changes do not lose it), so it is cleared
 * before each test. One test's background must not carry into the next judgment.
 */
beforeEach(() => {
	clearAccountChromeScheme(fakeRoot("light").element);
});

describe("decision: the effective background if any, otherwise the device appearance", () => {
	it("an empty override is the device appearance", () => {
		expect(resolveThemeChromeScheme("light", {})).toBe("light");
		expect(resolveThemeChromeScheme("dark", {})).toBe("dark");
	});

	it("the black preset is dark even with a light device", () => {
		expect(resolveThemeChromeScheme("light", PRESET("black"))).toBe("dark");
	});

	it("the white preset is light even with a dark device", () => {
		expect(resolveThemeChromeScheme("dark", PRESET("white"))).toBe("light");
	});

	/**
	 * Checks the composed result, not the preset name. Looking at the preset first would let it absorb
	 * a custom background, so that account would lose light scrollbars on a white page.
	 */
	it("black preset + white background is light", () => {
		expect(
			resolveThemeChromeScheme("light", PRESET_WITH_CUSTOM("black", "#ffffff")),
		).toBe("light");
	});

	it("white preset + black background is dark", () => {
		expect(
			resolveThemeChromeScheme("dark", PRESET_WITH_CUSTOM("white", "#000000")),
		).toBe("dark");
	});

	/**
	 * The 'default' preset with only an accent color is why the fallback exists. Its overrides are
	 * non-empty but do not cover the background, so the chrome must keep following the device.
	 */
	it("an override that does not cover the background keeps the device appearance", () => {
		const overrides = resolveEffectiveThemeOverrides({
			preset: "default",
			customization: { primary: "#7957ff" },
		});
		expect(Object.keys(overrides).length).toBeGreaterThan(0);
		expect(overrides.background).toBeUndefined();

		expect(resolveThemeChromeScheme("dark", overrides)).toBe("dark");
		expect(resolveThemeChromeScheme("light", overrides)).toBe("light");
	});
});

describe("the root class records the base appearance", () => {
	it("reads from the class", () => {
		expect(baseThemeChromeScheme(fakeRoot("dark").element)).toBe("dark");
		expect(baseThemeChromeScheme(fakeRoot("light").element)).toBe("light");
	});

	/**
	 * Does not read back its own value. If style.colorScheme were the default, the value this module
	 * wrote would become the new 'default', and removing the account color would no longer return the
	 * chrome to device appearance.
	 */
	it("does not mistake its own colorScheme for the default", () => {
		const root = fakeRoot("light");
		applyAccountChromeScheme(root.element, PRESET("black"));
		expect(root.style.colorScheme).toBe("dark");

		expect(baseThemeChromeScheme(root.element)).toBe("light");
	});
});

describe("one place writes it; no reliance on effect order", () => {
	it("the account axis layers over the device appearance", () => {
		const root = fakeRoot("light");
		applyAccountChromeScheme(root.element, PRESET("black"));
		expect(root.style.colorScheme).toBe("dark");
	});

	/**
	 * A device appearance change must not overwrite the account background. In the old model the
	 * provider wrote the value without knowing about the account background, and the bug showed only
	 * after an OS appearance change.
	 */
	it("an OS appearance change does not overwrite the account background", () => {
		const root = fakeRoot("light");
		applyAccountChromeScheme(root.element, PRESET("black"));

		root.setBase("dark");
		syncThemeChromeScheme(root.element);
		expect(root.style.colorScheme).toBe("dark");

		root.setBase("light");
		syncThemeChromeScheme(root.element);
		expect(root.style.colorScheme).toBe("dark");
	});

	it("without an account background it follows the device", () => {
		const root = fakeRoot("light");
		applyAccountChromeScheme(root.element, PRESET("default"));
		expect(root.style.colorScheme).toBe("light");

		root.setBase("dark");
		syncThemeChromeScheme(root.element);
		expect(root.style.colorScheme).toBe("dark");
	});
});

describe("no old account axis remains", () => {
	/**
	 * Switching black back to default: cleanup runs before apply, which follows from how effects run.
	 */
	it("reverting the preset returns to the device appearance", () => {
		const root = fakeRoot("light");
		applyAccountChromeScheme(root.element, PRESET("black"));
		expect(root.style.colorScheme).toBe("dark");

		clearAccountChromeScheme(root.element);
		applyAccountChromeScheme(root.element, PRESET("default"));
		expect(root.style.colorScheme).toBe("light");
	});

	it("reverting the white preset returns to dark", () => {
		const root = fakeRoot("dark");
		applyAccountChromeScheme(root.element, PRESET("white"));
		expect(root.style.colorScheme).toBe("light");

		clearAccountChromeScheme(root.element);
		applyAccountChromeScheme(root.element, PRESET("default"));
		expect(root.style.colorScheme).toBe("dark");
	});

	/**
	 * Logout, account switch, and failed lookup all arrive as 'no overrides', so all three must reset
	 * to device appearance.
	 */
	it("cleanup alone returns to the device appearance", () => {
		const root = fakeRoot("light");
		applyAccountChromeScheme(root.element, PRESET("black"));

		clearAccountChromeScheme(root.element);
		expect(root.style.colorScheme).toBe("light");
	});

	/**
	 * Does not remove the property. Removing it would also erase the value the pre-hydration script
	 * set, leaving a logged-out dark browser with a light scrollbar.
	 */
	it("cleanup does not empty the property", () => {
		const root = fakeRoot("dark");
		applyAccountChromeScheme(root.element, PRESET("white"));
		clearAccountChromeScheme(root.element);
		expect(root.style.colorScheme).toBe("dark");
	});
});

describe("makes no copy of the preset palette", () => {
	/**
	 * Asserts that the judgment's input comes from the product's real palette. A color literal here
	 * would go stale when the palette is tuned, and a passing test would then mean 'the old black was
	 * dark' instead of 'the black preset is dark'.
	 */
	it("the preset's background comes from the design package", () => {
		expect(PRESET("black").background).toBe(
			resolveThemePresetOverrides("black").background,
		);
		expect(PRESET("white").background).toBe(
			resolveThemePresetOverrides("white").background,
		);
	});
});
