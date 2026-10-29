import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * How the heart says "on": these three axes locked by code shape.
 *
 * This app's tests do not render screens (`vitest.config.ts`), so the check reads source. The
 * regressions it targets are silent: the fill starting to **replace** the accessibility state, or
 * the fill quietly vanishing so on/off is left to color alone.
 *
 * ```text
 * color        destructive          — the same as absent for someone who cannot tell colors apart
 * fill         filled={favorited}   — survives as shape; the same axis as web's `fill-current`
 * state        accessibilityState   — **required**; it must remain even if the other two are gone
 * ```
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const code = readFileSync(join(HERE, "favorite-control.tsx"), "utf8")
	.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
	.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");

describe("on is told by color and fill together", () => {
	/** Filled when on, empty when off. A constant would make that axis say nothing. */
	it("the fill follows the favorite state", () => {
		expect(code).toContain("filled={favorited}");
		expect(code).not.toMatch(/filled=\{(true|false)\}/);
	});

	/** Off is a plain secondary color, not emphasis: a work not saved must not stand out. */
	it("only on is destructive and off is muted-foreground", () => {
		expect(code).toContain(
			'tone={favorited ? "destructive" : "muted-foreground"}',
		);
	});
});

describe("fill doesn't stand in for state", () => {
	/**
	 * **This check is the point of this file.** The filled heart is visual feedback, and only
	 * `selected` carries that fact to screen readers. Without that line the screen looks fine and the
	 * regression shows only to people using assistive technology.
	 */
	it("on/off goes out as an accessibility state too", () => {
		expect(code).toContain("selected: favorited");
	});

	/** The name follows on/off too: a bare `Favorites` would leave the state unknown until pressed. */
	it("the button's name states the current state", () => {
		expect(code).toMatch(
			/accessibilityLabel=\{\s*favorited \? "Remove from favorites" : "Add to favorites"\s*\}/,
		);
	});
});
