import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Geometry of the settings workspace, checked without rendering. The invariant is that the body
 * sits at the center of the canvas, and the navigation list does not take part in deciding that
 * center.
 *
 * This breaks silently: types, rendering, and the test suite all pass while the settings screen
 * sits off-center relative to other screens. It did once: wrapping list, gap, and body in one
 * centered block shifted the body 108px right, and the two files looked identical since both use
 * max-w-2xl.
 *
 * The test does not pin the class string. It checks track symmetry and that the width decision is
 * one value, so margin, color, or corner edits do not fail it.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SHELL = readFileSync(join(HERE, "settings-shell.tsx"), "utf8");
const NAVIGATION = readFileSync(join(HERE, "settings-navigation.tsx"), "utf8");

/**
 * Track list from a `grid-cols-[...]` arbitrary value. In Tailwind, an underscore in such a value
 * means a space.
 */
function gridTracks(source: string): string[] {
	const match = source.match(/grid-cols-\[([^\]]+)\]/);
	if (!match) throw new Error("the settings shell has no grid tracks");
	return match[1].split("_");
}

/**
 * Source with comments removed. Comments in this repo say why, and they name things that were
 * deliberately not done. Banning those names would flag the file documenting the rule as violating
 * it, and that pressure would push toward deleting the explanation (settings-boundaries.test.ts
 * made the same call).
 */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function breakpoints(source: string): Set<string> {
	return new Set(
		[...source.matchAll(/min-\[([^\]]+)\]:/g)].map((match) => match[1]),
	);
}

describe("the body holds the center", () => {
	/**
	 * Both rails must match for the body to be truly centered. With a rail only on the left, as in the
	 * old `mx-auto max-w-4xl` flex layout, the centered object is the whole block, and the body is
	 * pushed right by half of (list + gap).
	 */
	it("both rails are the same track", () => {
		const tracks = gridTracks(SHELL);
		expect(tracks).toHaveLength(3);
		expect(tracks[0]).toBe(tracks[2]);
	});

	/**
	 * The rail is the track that grows, and the body is fixed. Reversed (fixed rail, body `1fr`), the
	 * body would widen with the canvas, and at 1440px names and controls would spread to opposite
	 * edges.
	 */
	it("only the center track has a cap", () => {
		const [rail, content] = gridTracks(SHELL);
		expect(rail).toBe("minmax(0,1fr)");
		expect(content).toBe("minmax(0,42rem)");
	});

	/**
	 * The cap equals the body column's cap (`max-w-2xl` = 42rem). If they differ, the reading column
	 * width changes between narrow and wide viewports, and the difference is visible only when
	 * resizing the window.
	 */
	it("the center track and body column share one width value", () => {
		expect(gridTracks(SHELL)[1]).toContain("42rem");
		expect(SHELL).toContain("max-w-2xl");
	});

	/**
	 * The old block-centering must not come back. If an outer max-width is set on top of the grid, it
	 * replaces the canvas as the constraint and narrows the rail. Symmetry would remain, but the body
	 * would shift again.
	 */
	it("does not put an outer cap on the workspace again", () => {
		expect(withoutComments(SHELL)).not.toContain("max-w-4xl");
	});

	/**
	 * The body's position must not depend on whether the navigation list exists. Symmetry alone is not
	 * enough: with auto-placement, the body sits in the column after the list. When the list
	 * disappears (a breakpoint change or a conditional render), the body moves into the left rail. The
	 * grid stays symmetric while the centering becomes false, and review would not catch it.
	 */
	it("both columns state their own column", () => {
		expect(NAVIGATION).toContain("min-[87rem]:col-start-1");
		expect(SHELL).toContain("min-[87rem]:col-start-2");
	});
});

describe("there is one width decision", () => {
	/**
	 * Grid thresholds and the navigation split must use the same breakpoint. If they differ, the range
	 * in between shows either both lists (the same navigation twice) or neither. With neither,
	 * categories cannot be switched, and that range is narrow enough that developer windows do not
	 * reproduce it.
	 */
	it("the shell and both containers switch at the same width", () => {
		const all = new Set([...breakpoints(SHELL), ...breakpoints(NAVIGATION)]);
		expect([...all]).toEqual(["87rem"]);
	});

	/**
	 * The two containers are each other's inverse. Using the same direction in both (both
	 * `min-[87rem]:hidden`) would leave a width range with no navigation list at all.
	 */
	it("the two containers switch in opposite directions", () => {
		expect(NAVIGATION).toContain("min-[87rem]:block");
		expect(NAVIGATION).toContain("min-[87rem]:hidden");
	});
});
