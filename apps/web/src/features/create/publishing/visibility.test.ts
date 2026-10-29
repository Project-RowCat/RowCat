import { STORY_VISIBILITIES } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import {
	PUBLISH_VISIBILITIES,
	publishButtonLabel,
	publishVisibilityHint,
	toPublishVisibility,
} from "./visibility.ts";

/**
 * The publish visibility options. The test guards four things:
 * - `archived` must not appear as a publish option. The vocabulary has four states, but
 *   publishing can produce only three.
 * - A saved value outside the vocabulary must fold to the safe side. Drafts can hold all four
 *   values (for example after a transfer), and drawing an empty selection would hide what is being
 *   published.
 * - Link visibility must not fold to private. A `=== 'public' ? … : 'private'` rule silently
 *   turned it private.
 * - Guidance copy must not imply review, and link visibility must not promise more privacy than
 *   it provides.
 */

describe("PUBLISH_VISIBILITIES", () => {
	it("archive is not a publish option, and the order is narrowest first", () => {
		expect([...PUBLISH_VISIBILITIES]).toEqual([
			"private",
			"unlisted",
			"public",
		]);
		expect(PUBLISH_VISIBILITIES as readonly string[]).not.toContain("archived");
	});

	it("every option is a vocabulary value", () => {
		for (const value of PUBLISH_VISIBILITIES)
			expect(STORY_VISIBILITIES).toContain(value);
	});
});

describe("toPublishVisibility", () => {
	it("choosable values stay and only archived folds to private", () => {
		/**
		 * Keeping link visibility intact is the point of this block. A fold rule written as 'not public
		 * means private' would break only this line, silently. The symptom would be that the state the
		 * creator chose shows as a different value when the editor reopens.
		 */
		expect(toPublishVisibility("public")).toBe("public");
		expect(toPublishVisibility("unlisted")).toBe("unlisted");
		expect(toPublishVisibility("private")).toBe("private");
		/** This is the narrowest of the three, and the publish button states that fact verbatim. */
		expect(toPublishVisibility("archived")).toBe("private");
	});

	it("every vocabulary value folds to a drawable value", () => {
		for (const value of STORY_VISIBILITIES)
			expect(PUBLISH_VISIBILITIES).toContain(toPublishVisibility(value));
	});
});

describe("copy", () => {
	it("public says it is immediate and does not imply review", () => {
		expect(publishVisibilityHint("public")).toContain("the moment");
		expect(publishVisibilityHint("public")).toContain("anyone");
		for (const word of ["review", "approv", "pending", "coming soon"])
			expect(
				PUBLISH_VISIBILITIES.map(publishVisibilityHint).join(" "),
			).not.toContain(word);
	});

	it("private says it can be changed later", () => {
		/**
		 * Stating that visibility is reversible here keeps first-time publishers from assuming publishing
		 * is final and getting stuck in private.
		 */
		expect(publishVisibilityHint("private")).toContain("make it public");
	});

	it("link-only says both that it is unlisted and that the link opens it", () => {
		/**
		 * Saying only half is misleading either way. 'Not in the list' alone reads as private. 'Opens by
		 * link' alone does not explain why the work is missing from the gallery.
		 */
		expect(publishVisibilityHint("unlisted")).toContain("search");
		expect(publishVisibilityHint("unlisted")).toContain("link");
	});

	it("link-only does not promise more privacy than it has", () => {
		/**
		 * A creator who trusts this sentence and shares the link is put at risk. This feature has no
		 * expiry, password, or invitation. If those words appear in the copy, the copy is a promise that
		 * cannot be kept.
		 */
		for (const word of ["password", "expir", "invit", "safely", "protect"])
			expect(publishVisibilityHint("unlisted")).not.toContain(word);
	});

	it("the button wording matches the chosen value", () => {
		expect(publishButtonLabel("public")).toContain("publicly");
		expect(publishButtonLabel("unlisted")).toContain("link-only");
		expect(publishButtonLabel("private")).toContain("privately");
	});
});
