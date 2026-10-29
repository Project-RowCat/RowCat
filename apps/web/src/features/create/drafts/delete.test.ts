import { describe, expect, it } from "vitest";
import { draftDeleteNotice } from "./delete.ts";

/**
 * The delete confirmation copy. It is a sentence in front of an irreversible action, so it is
 * checked without rendering. Getting it wrong changes what the user does. If they believe a
 * published work will be deleted too, they stop cleaning up drafts. If they expect a deletion that
 * does not happen, they later find a work they thought was gone. In both cases our own sentence was
 * wrong.
 */
describe("draft delete notice", () => {
	/**
	 * This matters more now that the `Published` tab exists on this screen. A user who deletes a draft
	 * sees their published work still there in the adjacent tab right away.
	 */
	it("a published draft says the story stays", () => {
		const notice = draftDeleteNotice("story-1");
		expect(notice).not.toBeNull();
		expect(notice).toContain("Only the draft");
		expect(notice).toContain("stay");
	});

	/**
	 * No warning on unpublished drafts. Such a user has no `Published` yet, so the sentence would be
	 * about someone else's story. If every deletion carried the same warning, the warning would soon
	 * go unread.
	 */
	it("a never-published draft has no notice", () => {
		expect(draftDeleteNotice(null)).toBeNull();
	});

	/**
	 * Publication is decided by `publishedStoryId` alone. An empty string does not count as published.
	 */
	it("an empty string does not count as published", () => {
		expect(draftDeleteNotice("")).toBeNull();
	});
});
