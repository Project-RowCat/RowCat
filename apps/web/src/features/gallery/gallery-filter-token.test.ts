import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically checks the rule for a filter token being added and removed. Presence is needed where
 * the element to press sits inside the thing that disappears, so a mismatch fails silently:
 * - No press guard: an × already removed is pressed again during its exit.
 * - Guard on the exit target: it applies only when the exit starts. On a tab that receives no
 *   animation frames it never applies, and that is when the line stays longest.
 * - `initial` not disabled: on a page reached by a link that already has the filter set, the
 *   token appears as if the user had just picked it.
 * - Pulled out with `popLayout`: the button just pressed keeps focus while floating out of the
 *   flow.
 *
 * None of these throws or fails typecheck, so what is verified is the pairing: the toolbar has
 * presence, and the line carries its own guard. This is the same rule as the mobile `Screen(edges)`
 * and `ComposerArea` pairing.
 *
 * Motion style is not asserted here (same rule as `list-motion.test.ts`). Real movement is checked
 * in a browser.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const read = (name: string) => readFileSync(join(HERE, name), "utf8");

/**
 * Source with comments stripped, so the header describing this rule does not report itself as a
 * violation.
 */
const code = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const toolbar = code(read("gallery-toolbar.tsx"));
const token = code(read("gallery-filter-token.tsx"));

describe("presence of applied conditions", () => {
	/**
	 * This list comes from the URL. A person arriving through a link with a filter set sees the token
	 * from the start; making it enter would look like they had just picked it.
	 */
	it("the toolbar suppresses the first-render entrance", () => {
		expect(toolbar).toMatch(/<AnimatePresence\s+initial=\{false\}/);
	});

	/**
	 * The list's semantics stay the same: moving the rows into a component does not change `ul > li`.
	 */
	it("the drawn markup is still a list", () => {
		expect(toolbar).toMatch(/<ul\b/);
		expect(token).toMatch(/<m\.li\b/);
	});

	/**
	 * Because this is a hook, the line must be a component, and this requirement is what the check
	 * protects. Without the line, the × of a just-removed filter gets pressed again during its exit.
	 */
	it("a leaving row cannot be pressed", () => {
		expect(token).toMatch(/useExitGuard\(\)/);
		expect(token).toMatch(/style=\{exiting\}/);
	});

	/**
	 * Putting the guard on the animated element applies it when the animation starts, so on a tab that
	 * gets no animation frames it never applies. `exit-guard.ts` records this failure, measured in a
	 * browser.
	 */
	it("that protection is not carried on the animation target", () => {
		expect(token).not.toMatch(/pointerEvents/);
	});

	/**
	 * Same reason as the tag chip: it stays in the flow. The remove button sits inside the token that
	 * will disappear, so pulling it out would leave the just-pressed button holding focus while it
	 * floats.
	 */
	it("does not take it out of the flow", () => {
		expect(toolbar).not.toMatch(/popLayout/);
		expect(token).not.toMatch(/popLayout/);
	});

	/**
	 * Rhythm is owned by `lib/motion` alone. Writing values here would make the token move at a
	 * different distance from the list rows, and removing a token would look different on each screen.
	 */
	it("does not build the rhythm here", () => {
		expect(token).toMatch(/from "#\/lib\/motion\/list-motion\.ts"/);
		expect(token).toMatch(/exit=\{rowExit\}/);
	});
});
