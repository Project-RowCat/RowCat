import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Checks statically that a failed `Show more` (load more) is not silent. This repo's web tests have no
 * React rendering, so this reads the source. Three things are guarded: the failure axis exists;
 * auto-load stops while failing; and both call sites (gallery and profile) pass that axis. The last
 * matters most: a screen that omits the optional prop would silently revert to the old silent
 * failure while still passing types and render.
 *
 * Background: next-page failures were once completely silent (the button came back with no
 * message), and the IntersectionObserver retried the failed request automatically against the same
 * boundary, hammering a dead connection.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const read = (...segments: string[]): string =>
	readFileSync(join(HERE, ...segments), "utf8");

const codeOf = (...segments: string[]): string =>
	read(...segments)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

describe("a next-page failure is stated beside the boundary", () => {
	it("the failure axis exists, and the failure sentence and retry stand together", () => {
		const code = codeOf("gallery-load-more.tsx");
		expect(code).toContain("failed");
		expect(code).toContain('t("loadMoreFailed")');
		expect(code).toContain('t("common:actions.retry")');
	});

	it("the observer does not refetch automatically during failure", () => {
		/**
		 * A person decides when to retry, via the button. Automatically repeating a failed request causes
		 * a retry storm.
		 */
		expect(codeOf("gallery-load-more.tsx")).toContain("|| failed) return");
	});

	it("the gallery and profile actually pass the failure axis", () => {
		expect(codeOf("gallery-page.tsx")).toContain(
			"failed={isFetchNextPageError}",
		);
		expect(codeOf("..", "profile", "profile-page.tsx")).toContain(
			"failed={isFetchNextPageError}",
		);
	});
});
