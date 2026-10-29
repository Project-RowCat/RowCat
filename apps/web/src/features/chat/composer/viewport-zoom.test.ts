import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Locks, by value, which way the iOS Safari focus zoom was fixed.
 *
 * That browser zooms the page when an input whose text is smaller than 16px receives focus. The
 * chat screen is viewport-locked (`viewportLocked`), so the zoom is never undone, and the header
 * and composer are pushed out of the enlarged layout viewport. To the user it looks like "I tapped
 * to type and the screen broke".
 *
 * There are two ways to fix this. The repository chose to enlarge the field text
 * (`COMPOSER_FIELD_TEXT`). The other way writes `user-scalable=no` or `maximum-scale=1` into the
 * viewport meta. That blocks the same zoom but also blocks pinch zoom, so low-vision users could no
 * longer enlarge any screen in the product.
 *
 * ## Why this test exists
 *
 * That one line is the most natural "fix" the next time this is reported, since it is the top
 * search answer. Adding it makes the symptom disappear, and what it removes (pinch zoom) is visible
 * only to the people who use it. Neither compilation nor other tests fail.
 *
 * The only thing scanned is the document's viewport meta, which the route tree's root owns.
 */

const ROOT = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"..",
	"..",
	"routes",
	"__root.tsx",
);

const source = readFileSync(ROOT, "utf8");

describe("viewport zoom is not blocked", () => {
	it("does not write `user-scalable`", () => {
		expect(source).not.toContain("user-scalable");
	});

	/**
	 * `maximum-scale=1` says the same thing in other words: on iOS the value pins the pinch-zoom
	 * ceiling at 1.
	 */
	it("does not write `maximum-scale` either", () => {
		expect(source).not.toContain("maximum-scale");
	});

	/**
	 * Locked together with the two lines above: the declaration that the virtual keyboard shrinks the
	 * layout viewport. With the default (`resizes-visual`), `100dvh` stays at the height that ignores
	 * the keyboard, so the composer of the viewport-locked chat screen slides under the keyboard and
	 * the character just typed is no longer visible. Only with these lines together is "no zoom, and
	 * not covered" true.
	 */
	it("the virtual keyboard shrinks the layout viewport", () => {
		expect(source).toContain("interactive-widget=resizes-content");
	});
});
