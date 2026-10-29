import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static scan of the public contract for the close control.
 *
 * The mismatch it guards against: admin dialogs cannot be dismissed for any reason while work is in
 * progress (apps/web/src/lib/dialog/dismiss.ts), yet the X in the top right looked pressable during
 * that time. Pressing it sent a close request that the policy swallowed, so nothing happened. The
 * data was safe, but the UI offered a control and then refused it.
 *
 * Two separate questions follow:
 * - showCloseButton=false: this surface structurally has no close control.
 * - closeButtonDisabled=true: the control exists but cannot be used right now.
 *
 * Collapsing them would make the X disappear during work, removing a target the moment the user
 * starts an action and shifting the layout.
 *
 * The scan checks the contract, not the rendered tree. The package's tests do not render React,
 * following the neighboring scanners. Native disabled semantics were verified in a browser, and the
 * assertions below guard that structure.
 */

const source = readFileSync(
	fileURLToPath(new URL("./components/dialog.tsx", import.meta.url)),
	"utf8",
);

/**
 * Source with comments stripped. Since this repo's comments name rules by their names, an
 * explanation of why a simulated disable (preventDefault in onClick) is wrong would otherwise flag
 * itself. Docs would then be edited to satisfy the check.
 */
const code = source
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^\s*\/\/.*$/gm, "");

/**
 * If the lookup misses its target, every assertion below passes silently, so the target's presence
 * is asserted first.
 */
const content = (() => {
	const start = code.indexOf("function DialogContent(");
	expect(start, "could not find DialogContent").toBeGreaterThan(-1);
	const end = code.indexOf("function DialogHeader(", start);
	return code.slice(start, end === -1 ? undefined : end);
})();

describe("the close control's two questions are separate", () => {
	it("presence and pressability are separate props", () => {
		expect(content).toMatch(/showCloseButton\?:\s*boolean/);
		expect(content).toMatch(/closeButtonDisabled\?:\s*boolean/);
	});

	/**
	 * The default is the rule. Callers that do not pass this prop, which is most of the repo today,
	 * must behave exactly as before.
	 */
	it("by default it is visible and pressable", () => {
		expect(content).toMatch(/showCloseButton\s*=\s*true/);
		expect(content).toMatch(/closeButtonDisabled\s*=\s*false/);
	});

	/** Removing the control entirely is still solely showCloseButton's job. */
	it("showCloseButton decides whether the control exists", () => {
		expect(content).toMatch(/\{showCloseButton\s*&&\s*\(/);
		expect(content, "existence depends on two values").not.toMatch(
			/showCloseButton\s*&&\s*!?closeButtonDisabled/,
		);
	});
});

describe("inactive is real disabled", () => {
	/**
	 * disabled is applied to the primitive. Base UI's Close resolves that value through its own
	 * useButton. That forwards the native disabled attribute to the rendered element and
	 * short-circuits its own onClick that sends the close request.
	 *
	 * So a disabled X never issues a request, rather than issuing a reason that the policy would
	 * swallow.
	 */
	it("the Close primitive receives the value", () => {
		expect(content).toMatch(
			/<DialogPrimitive\.Close[\s\S]{0,200}?disabled=\{closeButtonDisabled\}/,
		);
	});

	/**
	 * Does not imitate disabling. A pressable button with preventDefault still exposes an operation to
	 * assistive technology and keyboard users, and it still looks active. The mismatch being fixed
	 * would remain.
	 */
	it("does not block with preventDefault", () => {
		expect(content).not.toContain("preventDefault");
		expect(content, "imitates with aria-disabled alone").not.toContain(
			"aria-disabled",
		);
	});

	/**
	 * One close control. Drawing a separate disabled branch would let the two begin to behave
	 * differently.
	 */
	it("there is one close control", () => {
		expect(content.match(/<DialogPrimitive\.Close/g)?.length).toBe(1);
	});

	/** The accessible name stays. Removing it when disabled would leave the control unidentifiable. */
	it("the accessible name remains", () => {
		expect(content).toMatch(/<span className="sr-only">Close<\/span>/);
	});

	/**
	 * The disabled look comes from the shared Button (`disabled:opacity-50
	 * disabled:pointer-events-none`). Repainting it here would make only this button look different
	 * from the repo's other disabled controls.
	 */
	it("does not repaint the disabled look here", () => {
		for (const custom of ["opacity-", "cursor-", "pointer-events-"])
			expect(
				content,
				`the close button writes ${custom} directly`,
			).not.toContain(custom);
	});
});
