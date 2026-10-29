import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static scan of the empty-state semantic contract. Currently covers only EmptyDescription.
 *
 * The contract is about which element is drawn, not the browser tree. A generated component once
 * drew a div where the public props promised a paragraph, and no screen or type error showed it.
 * That mismatch returns silently whenever shadcn regenerates the component. Class strings are not
 * part of the contract and are not checked. Like boundaries.test.ts and selection-state.test.ts,
 * this package does not render React.
 */

const source = readFileSync(
	fileURLToPath(new URL("./components/empty.tsx", import.meta.url)),
	"utf8",
);

/**
 * Source with comments removed. Comments in this repo name the rule they describe, so a comment
 * explaining a removed violation would flag itself. Stripping them keeps docs from being edited to
 * satisfy the scanner.
 */
const code = source
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^\s*\/\/.*$/gm, "");

describe("EmptyDescription's element and type say the same thing", () => {
	/** If this check finds nothing to scan, every assertion below passes silently. */
	it("there is something to scan", () => {
		expect(code).toContain("function EmptyDescription(");
	});

	it("takes paragraph props", () => {
		expect(code).toMatch(
			/function EmptyDescription\([\s\S]*?\}: React\.ComponentProps<"p">\)/,
		);
	});

	it("renders a paragraph", () => {
		expect(code).toMatch(/<p\s+data-slot="empty-description"/);
	});

	/**
	 * The check above is not enough. A change that wraps the paragraph in a div, a common mistake,
	 * still passes it, because two elements can stand side by side. The slot must be drawn by exactly
	 * one element.
	 */
	it("does not render a generic division in that slot", () => {
		expect(code).not.toMatch(/<div\s+data-slot="empty-description"/);
	});
});
