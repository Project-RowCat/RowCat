import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Layout contract with the web. It locks in values measured on device and browser, so they cannot
 * silently revert. The test does not check screenshots; it checks that the decision is still in the
 * code. Each value is recorded with its measurement in docs/design/VISUAL-PARITY.md. Static checks
 * cannot prove the values are right, only that they are not reverted. Tests in this package do not
 * render React, as in semantics.test.ts.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const codeOf = (file: string): string =>
	readFileSync(`${HERE}${file}`, "utf8")
		.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
		.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");

describe("Select trigger", () => {
	const select = codeOf("select.tsx");

	/**
	 * `flex: 1` also sets `flexBasis: 0`. In a parent whose width comes from its content, the text
	 * then contributes nothing to the parent's width and disappears, leaving only the chevron.
	 * Measured in the lab: 50.0 against the web's 71.0.
	 */
	it("the value shrinks but does not disappear", () => {
		const value = /\n\tvalue: \{([\s\S]*?)\},\n/.exec(select)?.[1];
		expect(value, "could not find the value style block").toBeDefined();
		expect(value).toContain("flexShrink: 1");
		expect(value).not.toMatch(/flex:\s*1/);
	});

	/** The container, not a child's flex side effect, decides where the value and the chevron sit. */
	it("value on the left, chevron on the right", () => {
		const trigger = /\n\ttrigger: \{([\s\S]*?)\},\n/.exec(select)?.[1];
		expect(trigger).toContain('justifyContent: "space-between"');
	});

	/**
	 * Under a large accessibility font scale this trigger must grow like the other controls. A fixed
	 * height would clip the enlarged value inside the box. Input makes the same choice for the same
	 * reason; on device it grew from 36 to 57.7.
	 */
	it("grows with larger text", () => {
		const trigger = /\n\ttrigger: \{([\s\S]*?)\},\n/.exec(select)?.[1];
		expect(trigger).toContain("minHeight: controlHeight.md");
		expect(trigger).not.toMatch(/\bheight: controlHeight/);
	});
});

describe("empty-state actions", () => {
	const state = codeOf("state.tsx");

	/**
	 * The web's Empty callers use two variants: `default` (a way out of a dead-end screen) and
	 * `outline` (a next step beside the state). `secondary` is neither.
	 */
	it("weight is choosable with a vocabulary of two", () => {
		expect(state).toContain('actionVariant?: "primary" | "outline"');
		expect(state).toContain('actionVariant = "primary"');
		expect(state).toContain("variant={actionVariant}");
	});

	/**
	 * The vocabulary is not opened to every button variant. That would let a `destructive` action
	 * appear in an empty state.
	 */
	it("the vocabulary is not open to every button variant", () => {
		expect(state).not.toMatch(/actionVariant\?: ButtonVariant/);
	});

	/**
	 * Centered explicitly on the action. Button's own `alignSelf` overrides the parent's `alignItems`,
	 * so centering has to be given here.
	 */
	it("actions stand centered", () => {
		expect(state).toContain("style={state.emptyAction}");
		const action = /\n\temptyAction: \{([\s\S]*?)\},\n/.exec(state)?.[1];
		expect(action).toContain('alignSelf: "center"');
	});
});

describe("dialog footer actions", () => {
	const dialog = codeOf("dialog.tsx");

	/**
	 * The web's DialogFooter is `flex-col-reverse` on narrow screens. Its default `align-items:
	 * stretch` widens buttons to the full width (measured at 308.1 on a 390 screen). `alignItems:
	 * "stretch"` does not fix it, because this app's Button always sets its own `alignSelf`, which
	 * overrides the parent. So the container passes `fullWidth` to each child.
	 */
	it("stretches children to row width", () => {
		expect(dialog).toContain("fullWidth: child.props.fullWidth ?? true");
	});

	/**
	 * All three layouts (center, bottom, full) use the web's `p-6` horizontal padding, which is 24.
	 */
	it("horizontal padding is the web's 24", () => {
		expect(dialog).toContain("const padLeft = space.xl");
		expect(dialog).toContain("const padRight = space.xl");
	});
});
