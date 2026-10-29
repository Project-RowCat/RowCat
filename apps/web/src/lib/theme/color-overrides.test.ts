import {
	MANAGED_THEME_COLOR_NAMES,
	resolveThemeColorOverrides,
} from "@rowcat/design";
import { describe, expect, it } from "vitest";
import {
	applyThemeColorOverrides,
	clearThemeColorOverrides,
} from "./color-overrides.ts";

/**
 * Guards the document color layer, where removal matters more than application. The three failures
 * are all leftovers:
 * - A reverted slot keeps its color (an account that painted three slots, then kept only one).
 * - A subscription ends but the colors stay.
 * - An account switch leaves the previous person's colors. All three share one cause: clearing
 *   removed only what was currently applied. So clear walks every managed name.
 */

function fakeRoot() {
	const props = new Map<string, string>();
	return {
		element: {
			style: {
				setProperty: (name: string, value: string) => props.set(name, value),
				removeProperty: (name: string) => props.delete(name),
			},
		} as unknown as HTMLElement,
		props,
	};
}

const CUSTOMIZATION = {
	background: "#fffaf2",
	surface: "#ffffff",
	primary: "#7957ff",
};

describe("applying overrides", () => {
	it("chosen colors stand as custom properties", () => {
		const { element, props } = fakeRoot();

		applyThemeColorOverrides(
			element,
			resolveThemeColorOverrides(CUSTOMIZATION),
		);

		expect(props.get("--background")).toBe("#fffaf2");
		expect(props.get("--card")).toBe("#ffffff");
		expect(props.get("--primary")).toBe("#7957ff");
		/** Foreground tokens are derived, so they are set even though the user never picked them. */
		expect(props.get("--foreground")).toBeDefined();
		expect(props.get("--primary-foreground")).toBeDefined();
	});

	/**
	 * Semantic colors the user never chose (destructive, chart) are left alone; the product owns them.
	 */
	it("destructive and chart colors are untouched", () => {
		const { element, props } = fakeRoot();
		applyThemeColorOverrides(
			element,
			resolveThemeColorOverrides(CUSTOMIZATION),
		);

		for (const name of [
			"--destructive",
			"--destructive-foreground",
			"--chart-1",
			"--chart-5",
		])
			expect(props.has(name), name).toBe(false);
	});

	/**
	 * The opposite: neutral tokens ARE painted. The surface used to stop at cards, popovers, and
	 * sidebars, so default or preset borders and muted stayed beside a custom surface, and this change
	 * fixes that.
	 */
	it("neutral colors derived from the surface stand too", () => {
		const { element, props } = fakeRoot();
		applyThemeColorOverrides(
			element,
			resolveThemeColorOverrides(CUSTOMIZATION),
		);

		for (const name of [
			"--muted",
			"--muted-foreground",
			"--secondary",
			"--accent",
			"--border",
			"--input",
			"--sidebar-accent",
			"--sidebar-border",
		])
			expect(props.has(name), name).toBe(true);

		/**
		 * Derived, not copied: if the layer and border colors matched the surface, the visual hierarchy
		 * would disappear.
		 */
		expect(props.get("--muted")).not.toBe(props.get("--card"));
		expect(props.get("--border")).not.toBe(props.get("--muted"));
	});

	/**
	 * Values are always #rrggbb hexes that passed the resolver, so an arbitrary CSS fragment never
	 * becomes a property value.
	 */
	it("every applied value is a hex color", () => {
		const { element, props } = fakeRoot();
		applyThemeColorOverrides(
			element,
			resolveThemeColorOverrides(CUSTOMIZATION),
		);

		for (const value of props.values()) expect(value).toMatch(/^#[0-9a-f]{6}$/);
	});
});

describe("removing clears **everything it manages**", () => {
	/**
	 * Covers a saved state where three slots were painted and then only the background was kept. A
	 * reverted surface or accent left in the document would show the user a color they deleted.
	 */
	it("reverting a slot leaves none of its color", () => {
		const { element, props } = fakeRoot();

		applyThemeColorOverrides(
			element,
			resolveThemeColorOverrides(CUSTOMIZATION),
		);
		expect(props.has("--card")).toBe(true);

		applyThemeColorOverrides(
			element,
			resolveThemeColorOverrides({ background: "#10131a" }),
		);

		expect(props.get("--background")).toBe("#10131a");
		expect(props.has("--card")).toBe(false);
		expect(props.has("--primary")).toBe(false);

		/**
		 * Derived colors must disappear too. If the managed list were narrower than the resolver's
		 * output, an account that emptied a surface would keep its derived border and muted inline until
		 * reload.
		 */
		for (const name of [
			"--muted",
			"--muted-foreground",
			"--secondary",
			"--accent",
			"--border",
			"--input",
			"--sidebar-accent",
			"--sidebar-border",
		])
			expect(props.has(name), name).toBe(false);
	});

	it("applying an empty override leaves nothing", () => {
		const { element, props } = fakeRoot();
		applyThemeColorOverrides(
			element,
			resolveThemeColorOverrides(CUSTOMIZATION),
		);

		applyThemeColorOverrides(element, resolveThemeColorOverrides(null));

		expect(props.size).toBe(0);
	});

	it("clear walks the whole managed list and is safe with nothing set", () => {
		const { element, props } = fakeRoot();
		/**
		 * Plants the names by hand, so an implementation that clears only what is currently applied fails
		 * the test.
		 */
		for (const name of MANAGED_THEME_COLOR_NAMES)
			element.style.setProperty(`--${name}`, "#000000");

		clearThemeColorOverrides(element);
		expect(props.size).toBe(0);

		expect(() => clearThemeColorOverrides(element)).not.toThrow();
	});
});
