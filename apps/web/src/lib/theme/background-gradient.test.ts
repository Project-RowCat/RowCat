import {
	MANAGED_THEME_COLOR_NAMES,
	resolveEffectiveThemeGradient,
} from "@rowcat/design";
import { describe, expect, it } from "vitest";
import {
	ACCOUNT_BACKGROUND_IMAGE_PROPERTY,
	applyAccountBackgroundGradient,
	clearAccountBackgroundGradient,
	themeGradientCss,
} from "./background-gradient.ts";

/**
 * Guards the layer that puts the background gradient on the document, the only place in the product
 * that builds CSS from user values. Four things are checked, none of which the color-override layer
 * covers:
 * - Values that did not pass validation never become a CSS statement. The resolver filters today,
 *   but that is wiring, not this function's contract, so the contract is enforced here.
 * - Semantic color names are not overridden. An image on --background would silently make every
 *   surface that reads it as a color transparent, with no error.
 * - A turned-off gradient is actually removed. An apply-only function would leave the previous
 *   value in the document.
 * - The gradient is anchored to the viewport. Otherwise, on short pages both colors are squeezed
 *   into the top few hundred pixels.
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

const GRADIENT = { from: "#10131a", to: "#4a1f5e", angle: 135 };

describe("building strings", () => {
	it("builds one CSS value from the structure", () => {
		expect(themeGradientCss(GRADIENT)).toBe(
			"linear-gradient(135deg, #10131a 0%, #4a1f5e 100%)",
		);
	});

	/**
	 * Validation is this function's contract. The resolver already filters, but a future caller might
	 * pass draft values straight through, and then arbitrary strings would become styles.
	 */
	it("a value that is not valid syntax does not become a value", () => {
		for (const bad of [
			{ ...GRADIENT, from: "red" },
			{ ...GRADIENT, to: "url(evil.svg)" },
			{ ...GRADIENT, to: "#fff" },
			{ ...GRADIENT, to: "#4a1f5e; background: url(x)" },
			{ ...GRADIENT, angle: 360 },
			{ ...GRADIENT, angle: -1 },
			{ ...GRADIENT, angle: 45.5 },
		])
			expect(themeGradientCss(bad), JSON.stringify(bad)).toBeNull();
	});
});

describe("applying and removing", () => {
	it("stands on one custom property", () => {
		const { element, props } = fakeRoot();
		applyAccountBackgroundGradient(element, GRADIENT);

		expect([...props.keys()]).toEqual([ACCOUNT_BACKGROUND_IMAGE_PROPERTY]);
		expect(props.get(ACCOUNT_BACKGROUND_IMAGE_PROPERTY)).toBe(
			themeGradientCss(GRADIENT),
		);
	});

	/**
	 * Semantic color names are not overridden. Putting an image on --background is the most obvious
	 * wrong answer, and its symptom is not an error but other surfaces going silently transparent.
	 */
	it("does not cover semantic color names", () => {
		const { element, props } = fakeRoot();
		applyAccountBackgroundGradient(element, GRADIENT);

		for (const name of MANAGED_THEME_COLOR_NAMES)
			expect(props.has(`--${name}`), name).toBe(false);
	});

	it("null removes it", () => {
		const { element, props } = fakeRoot();
		applyAccountBackgroundGradient(element, GRADIENT);
		applyAccountBackgroundGradient(element, null);
		expect(props.size).toBe(0);
	});

	/**
	 * A value that cannot be drawn is treated as a request to clear, so no previous value is left in
	 * the document.
	 */
	it("an undrawable value leaves no previous value", () => {
		const { element, props } = fakeRoot();
		applyAccountBackgroundGradient(element, GRADIENT);
		applyAccountBackgroundGradient(element, { ...GRADIENT, to: "nope" });
		expect(props.size).toBe(0);
	});

	it("removing is idempotent", () => {
		const { element, props } = fakeRoot();
		clearAccountBackgroundGradient(element);
		applyAccountBackgroundGradient(element, GRADIENT);
		clearAccountBackgroundGradient(element);
		clearAccountBackgroundGradient(element);
		expect(props.size).toBe(0);
	});
});

/**
 * The actual transitions the layer goes through, checked by value to confirm nothing that must not
 * remain does. The condition decision lives in one shared resolver (resolveEffectiveThemeGradient),
 * and this file only applies its result. Restating those conditions here would make the test and
 * the code share the same mistake.
 */
describe("switching: when the account or settings change", () => {
	const apply = (
		element: HTMLElement,
		state: Parameters<typeof resolveEffectiveThemeGradient>[0],
	) =>
		applyAccountBackgroundGradient(
			element,
			resolveEffectiveThemeGradient(state),
		);

	const WITH_GRADIENT = {
		preset: "default" as const,
		customization: {
			background: "#10131a",
			gradient: { to: "#4a1f5e", angle: 135 },
		},
	};

	/** Logout or account switch: with no viewer the selection is empty, so the gradient goes too. */
	it("switching to an empty selection removes it", () => {
		const { element, props } = fakeRoot();
		apply(element, WITH_GRADIENT);

		apply(element, {
			preset: "default",
			customization: {},
		});
		expect(props.size).toBe(0);
	});

	/** The previous person's gradient must not stay on the next person's screen. */
	it("switching to another account's value overwrites it", () => {
		const { element, props } = fakeRoot();
		apply(element, WITH_GRADIENT);

		apply(element, {
			preset: "white",
			customization: {
				background: "#f4f1ea",
				gradient: { to: "#ffe9c7", angle: 45 },
			},
		});
		expect(props.get(ACCOUNT_BACKGROUND_IMAGE_PROPERTY)).toBe(
			"linear-gradient(45deg, #f4f1ea 0%, #ffe9c7 100%)",
		);
	});

	/** Turning off only the gradient: the colors stay, and only the image disappears. */
	it("turning off only the gradient removes only the property", () => {
		const { element, props } = fakeRoot();
		apply(element, WITH_GRADIENT);

		apply(element, {
			...WITH_GRADIENT,
			customization: { background: "#10131a" },
		});
		expect(props.size).toBe(0);
	});

	/**
	 * Failure to load or offline: with no value known, nothing is drawn and the default background
	 * stays.
	 */
	it("draws nothing for an unknown value", () => {
		const { element, props } = fakeRoot();
		apply(element, {
			preset: "default",
			customization: {},
		});
		expect(props.size).toBe(0);
	});
});
