import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Checks that the retry action actually retries, using a static scan.
 *
 * A paused query (fetchStatus: "paused") makes no request when query.refetch() is called.
 * panel-retry.ts records that fact against the library code. So every retry in a section that draws
 * a server query has to go through usePanelRetry, and neither the types nor the render enforce
 * that. Reverting to a raw refetch() passes everything, and the button is dead only for offline
 * users, so review does not show it. Three surfaces were reverted this way: the account-deletion
 * trigger, the payment result, and the theme colors.
 *
 * The list is an allowlist, not a ban on refetch everywhere. A ban would also catch places where a
 * plain refetch is correct because a value already exists. The list holds the server-query sections
 * where pausing actually shows. A new section that reads isPaused and draws a retry gets added
 * here.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

const read = (relative: string): string =>
	readFileSync(join(SRC, relative), "utf8");

/**
 * Source with comments stripped, so that comments explaining a rule are not judged as violations of
 * it.
 */
const codeOf = (relative: string): string =>
	read(relative)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

/** Sections that draw server queries and offer a retry. All of them go through the same path. */
const RETRY_SURFACES = [
	"features/account/security-section.tsx",
	"features/account/sessions-section.tsx",
	"features/account/passkeys-section.tsx",
	"features/account/delete-account-trigger.tsx",
	"features/create/analytics/panel.tsx",
	"features/create/publishing/work-list.tsx",
	"features/generation/model-target-field.tsx",
	"features/moderation/my-reports-section.tsx",
	"features/notifications/use-notifications.ts",
	"features/settings/theme-customization-section.tsx",
	"features/story/comments/comment-section.tsx",
] as const;

describe("retry has one path", () => {
	for (const surface of RETRY_SURFACES) {
		it(`${surface} goes through usePanelRetry`, () => {
			expect(codeOf(surface)).toContain("usePanelRetry(");
		});

		it(`${surface} has no raw refetch`, () => {
			expect(codeOf(surface)).not.toContain(".refetch(");
		});
	}
});

describe("held values come before failure", () => {
	/**
	 * If a failed background refresh covers the value that was already held with an error box, the
	 * user reads their data as gone. Sections that use a pure resolver are guarded by that function's
	 * test. Sections that branch inside the component are guarded here, since removing a single
	 * !query.data guard would pass both types and rendering.
	 */
	it("the security section's data branch comes before its failure branch", () => {
		const code = codeOf("features/account/security-section.tsx");
		expect(code).toContain("data !== undefined ?");
		expect(code.indexOf("<SecurityDetails")).toBeLessThan(
			code.indexOf("<SecurityError"),
		);
	});

	it("the sessions and passkeys failure branch stands only without held values", () => {
		for (const surface of [
			"features/account/sessions-section.tsx",
			"features/account/passkeys-section.tsx",
		])
			expect(codeOf(surface), surface).toContain("isError && !query.data");
	});

	it("the published works failure branch also stands only without held values", () => {
		expect(codeOf("features/create/publishing/work-list.tsx")).toContain(
			"isError && !query.data",
		);
	});

	it("the account deletion trigger keeps the button when values are held", () => {
		expect(codeOf("features/account/delete-account-trigger.tsx")).toContain(
			"account.data === undefined",
		);
	});

	it("the comments section goes through the pure resolver", () => {
		const code = codeOf("features/story/comments/comment-section.tsx");
		expect(code).toContain("commentPanelView(");
		/**
		 * A failed `Show more` (load more) must not replace the list. The line beside the boundary says so,
		 * and the check looks for isFetchNextPageError in the source.
		 */
		expect(code).toContain("isFetchNextPageError");
	});
});
