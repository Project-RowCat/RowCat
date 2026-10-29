import { translator } from "#/lib/i18n/current.ts";
/**
 * What draft deletion **deletes and what it keeps**. The copy is split out as a pure function. An
 * inline ternary in the component would work too, but this sentence stands in front of an
 * irreversible action and must be checkable without rendering. A mistake here leaves users either
 * giving up on deletion, believing a published work will also be lost, or later finding a work
 * still present that they thought was gone. Draft deletion removes only the draft.
 * `store.deleteDraft()` writes tombstones on the local record and its children, and sends no
 * request to the server. The published work stays as its `story` row. That is correct: deleting
 * works is not a product feature yet, and even when it is, tidying drafts must not delete catalog
 * works. The honest thing this screen can do is state that fact in advance. Before the `Published` tab
 * existed this sentence was not critical. Now the work sits in the adjacent tab, and users see it
 * right after deleting a draft.
 */

/**
 * One line beside the delete confirmation. It is null for drafts that were never published.
 * Unpublished drafts do not get the same sentence, because for those users a 'published work' does
 * not exist yet, so the sentence would be about someone else's story. If every deletion carried the
 * same warning, it would soon go unread, including by the people who need it. The argument is
 * `publishedStoryId` rather than the draft object because the decision depends on that one value.
 * Passing the object would let the title or update time leak into the copy over time.
 */
export function draftDeleteNotice(
	publishedStoryId: string | null,
): string | null {
	if (!publishedStoryId) return null;
	return translator("create")("drafts.deleteNotice");
}
