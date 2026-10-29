import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically checks that the follow button stays one element whose state changes. Tests here do not
 * render React, so they verify policy, not the styles Motion produces (same rule as
 * lib/motion/*.test.ts). Real motion is checked in a browser. Three silent mistakes are targeted:
 * - adding a second state just to drive a transition
 * - the label or width shifting while the state changes
 * - a success toast added on top of an already-visible result
 */

const SOURCE = readFileSync(
	fileURLToPath(new URL("./follow-button.tsx", import.meta.url)),
	"utf8",
);

/**
 * The source with comments stripped, so that sentences explaining a rule are not flagged as
 * violations of it.
 */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
	/^\s*\/\/.*$/gm,
	"",
);

describe("both states remain as values", () => {
	it("there is actually something to scan", () => {
		expect(code).toContain("export function FollowButton");
	});

	/**
	 * `aria-pressed` states the status, and the text repeats it. Both must remain if motion fails
	 * (slow device, dropped frames, reduced motion). If the visual became the only signal, a user who
	 * does not see the screen would have no record of what they did.
	 */
	it("derives the pressed state straight from the relation", () => {
		expect(code).toContain("aria-pressed={following}");
	});

	it.each([
		'"follow.follow"',
		'"follow.following"',
	])("the %s label remains", (label) => {
		expect(code).toContain(label);
	});

	it.each(["UserPlus", "UserMinus"])("the %s glyph remains", (icon) => {
		expect(code).toContain(icon);
	});

	/**
	 * Labels swap without overlapping, so there is one frame with no text at all (label-swap.ts).
	 * `aria-label` holds the name so it is never empty during that frame. Its value is the same word
	 * as the visible text, so the name and the display never differ.
	 */
	it("the name is never empty while it swaps", () => {
		expect(code).toContain("aria-label={label}");
		expect(code).toMatch(
			/const label = following\s*\?\s*t\("follow\.following"\)\s*:\s*t\("follow\.follow"\)/,
		);
	});
});

describe("what swaps is the content, not the button", () => {
	/**
	 * Core rule. The container must stay the same for the change to read as the same control changing
	 * state. If the button itself animated, a single relationship change would look like the control
	 * being replaced.
	 */
	it("does not move the button itself", () => {
		expect(code).not.toMatch(/<m\.button|motion\.button/);
		expect(code).toContain("<Button");
	});

	/**
	 * The icon swap is done by the shared primitive. A transition written only for this button would
	 * give the same kind of event (a control changed state) a different weight on each screen. That
	 * difference only shows when two screens are compared side by side. `icon-swap.ts` shares the
	 * values for this reason.
	 */
	it("does not rebuild the glyph swap", () => {
		expect(code).toContain("<AnimatedIconSwap");
		expect(code).not.toMatch(/\brotate:/);
		expect(code).not.toMatch(/\bscale:/);
	});

	/**
	 * Label rhythm also comes from shared code. If the values were written in this file, changing the
	 * tokens would not reach here.
	 */
	it("takes the word rhythm from the shared module", () => {
		expect(code).toContain("labelSwapIn");
		expect(code).toContain("labelSwapOut");
		expect(code).not.toMatch(/\bduration:\s*[\d.]/);
		expect(code).not.toMatch(/\bease:\s*\[/);
	});

	/**
	 * Labels that swap without overlap disappear and reappear, so the slot briefly empties and the
	 * button narrows, then widens back. To prevent that, both labels are stacked invisibly in the same
	 * grid cell, so the longer word sets the slot width. The width is not a hard-coded number. A font
	 * change would make a hard-coded number stale.
	 */
	it("the width does not jitter during the swap", () => {
		expect(code).toMatch(
			/\[\s*t\("follow\.follow"\),\s*t\("follow\.following"\),?\s*\]\.map/,
		);
		expect(code).toContain("invisible col-start-1 row-start-1");
		expect(code).not.toMatch(/\bw-\[\d|\bmin-w-\[\d/);
	});

	/**
	 * Tone changes (background and border) interpolate together, and `Button`'s `transition-all`
	 * already handles that. Re-declaring it here would give two places control over the same values.
	 */
	it("keeps the meaning of the variant", () => {
		expect(code).toContain('variant={following ? "outline" : "default"}');
	});
});

describe("motion holds no product state", () => {
	/**
	 * The change is triggered when `following` changes, not on click. Starting it on click would make
	 * the screen and the value diverge when an optimistic update reverts after a failed mutation.
	 */
	it("creates no state just for the transition", () => {
		expect(code).not.toMatch(/\buseState\b|\buseEffect\b|\buseRef\b/);
		expect(code).not.toMatch(/onAnimationComplete/);
	});

	/**
	 * This screen does not touch the cache. `@rowcat/query` decides which entries change
	 * (`followMutationOptions`), including reversal. If this screen edited the cache, a failure would
	 * have two places to revert.
	 */
	it("does not edit the cache by hand", () => {
		expect(code).toContain("followMutationOptions");
		expect(code).not.toMatch(/setQueryData/);
		expect(code).not.toMatch(/followers\s*[+-]\s*1/);
	});

	/** Sends the desired next state rather than a toggle. Retrying does not change the outcome. */
	it("sends the desired next state", () => {
		expect(code).toContain("mutation.mutate(!following)");
	});

	/**
	 * No success toast. The changed label, glyph, tone, and `aria-pressed` already are the result. A
	 * toast on top would become an unreadable background, and the failure would then go unread too
	 * (docs/design/FAILURE-FEEDBACK.md).
	 */
	it("does not repeat success as a toast", () => {
		expect(code).not.toMatch(/showSuccessToast|showErrorToast|toast\(/);
	});

	/**
	 * A failure stays inline, next to the button, not as a toast. The control stays on screen, so the
	 * message belongs beside it.
	 */
	it("failure stays next to the button", () => {
		expect(code).toContain("followErrorMessage(mutation.error)");
		expect(code).toContain("<m.output");
	});
});
