import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Width budget of the header line: what gives up space first on narrow screens.
 *
 * Three pieces live on this line: the drawer trigger, the context (names and actions of the open
 * room or draft), and the three utilities. Everything around them is `shrink-0`, so the only thing
 * that can shrink is the context, and within it only the title is `min-w-0 truncate`. So when width
 * runs out, the order is:
 *
 * ```text
 * the title goes to 0       → "which conversation is this" disappears
 * an action pill overflows  → it is shrink-0 and does not shrink, so it is drawn **over the utilities**
 * ```
 *
 * Measured in the browser (320px, conversation screen):
 *
 * ```text
 * before the fix   context 14px · title 0px · action pill overlapping the utilities by 60px
 * after the fix    context 104px · title 28px · no overlap (8px gap)
 * 390px            title 2px → 92px
 * ```
 *
 * Nothing raises an error, and the two overlapping controls are **both drawn**, so in review or in
 * a screenshot it just looks crowded. That is why the judgment is pinned as a value.
 *
 * A currency-balance chip used to sit to the left of the utilities, and on narrow widths it was the
 * one that gave up space (the decision was made by whether context was present). Payments left with
 * billing, which removed that chip and that decision. What remains is the promise that all three
 * utilities stay on the line on every route.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** The source with comments removed, so that a sentence recording the rationale cannot pass the checks. */
const codeOf = (file: string): string =>
	readFileSync(join(HERE, file), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

describe("header width budget", () => {
	const header = codeOf("app-header.tsx");

	/**
	 * Notifications, settings and account stay on the line at narrow widths too. If any one of them
	 * disappears on some routes, this line's promise of "the same place on every screen" breaks. The
	 * check also does not re-read route names, on the same axis: that decision belongs to
	 * `shell-route.ts`.
	 */
	it("the three utilities stand on every route", () => {
		expect(header).not.toMatch(/pathname|startsWith\(/);
		const utilities = header.slice(header.indexOf("<NotificationBell"));
		for (const tag of ["<NotificationBell", "<SettingsAction", "<ViewerMenu"]) {
			const at = utilities.indexOf(tag);
			expect(at, tag).toBeGreaterThan(-1);
			const line = utilities.slice(at, utilities.indexOf(">", at));
			expect(line, tag).not.toContain("max-sm:hidden");
			expect(line, tag).not.toContain("workspace");
		}
	});

	/**
	 * The context slot shrinks and the utility group does not. If those two classes were swapped, the
	 * title would take all the width and the global controls would be pushed off-screen.
	 */
	it("the context shrinks and the utility group does not", () => {
		expect(header).toContain(
			'className="flex min-w-0 flex-1 items-center gap-1"',
		);
		expect(header).toContain(
			'className="ml-auto flex shrink-0 items-center gap-1"',
		);
	});
});
