import type { StoryDraft } from "@rowcat/authoring";
import type { CreatorWork } from "@rowcat/domain";

/**
 * Rule that links a server work to a local draft. Kept as a pure function so it can be checked
 * without rendering.
 * - The component is the expensive place to test this (IndexedDB subscription plus infinite
 *   query), and a wrong link fails silently: `Edit draft` opens the wrong draft, or `Not found` shows
 *   although the draft exists.
 * - The two identities stay separate:
 *     StoryDraft.id              identity of the editing document, made on this device
 *     CreatorWork.id             identity of the published copy, made by the server
 *     CreatorWork.originDraftId  the only bridge from work to draft (points to StoryDraft.id)
 * - The draft id does not change to the server id after publishing (see the StoryDraft header in
 *   `@rowcat/authoring`). The link is always `originDraftId`, never the title or the list position:
 *   titles can change independently on each side after publish, and positions shift whenever
 *   sorting changes (the draft list is a liveQuery that re-sorts on other tabs' autosave).
 * - A missing draft is not an error. Three paths produce it: the draft was deleted; the work was
 *   published from another device and sync has not arrived; or the work came in without a draft
 *   (import or seed). In all three the screen simply does not draw `Edit draft`.
 * - Do not restore a draft from the replayed snapshot. A snapshot expresses the published form,
 *   not the authoring form. Republishing a restored draft would make content the creator never
 *   wrote part of their work.
 */

/**
 * Set of draft ids alive on this device.
 *
 * Exists so each work row does not call `store.getDraft()`. That would cost one IndexedDB round
 * trip per work, on every render, and renders are frequent because the draft list is already
 * subscribed and changes often. Building the index from the list already in hand is both more
 * accurate and cheaper.
 *
 * It holds ids rather than draft objects because this screen uses none of the draft content. It
 * only needs to know whether a draft can be opened; the title comes from the server work.
 */
export const draftIdIndex = (drafts: readonly StoryDraft[]): Set<string> =>
	new Set(drafts.map((draft) => draft.id));

export interface CreatorWorkRow {
	work: CreatorWork;
	/**
	 * The original draft openable on this device, or null.
	 *
	 * `work.originDraftId` is not used directly, and this field exists for that reason. The value
	 * being set and the draft being present on this device are different facts. Mixing them would
	 * render a dead link to a deleted draft.
	 */
	editableDraftId: string | null;
}

/**
 * Server works plus the local draft index produce the rows to draw.
 *
 * Order is the server's (most recently updated first). Re-sorting here would shift page boundaries
 * for `Show more`, and the shift shows up as the same work appearing twice.
 */
export function creatorWorkRows(
	works: readonly CreatorWork[],
	localDraftIds: ReadonlySet<string>,
): CreatorWorkRow[] {
	return works.map((work) => ({
		work,
		editableDraftId:
			work.originDraftId !== null && localDraftIds.has(work.originDraftId)
				? work.originDraftId
				: null,
	}));
}
