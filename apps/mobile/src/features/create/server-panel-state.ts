/**
 * Rules for what the two server-resource panels (`Published`, `Analytics`) draw. Same order as web's
 * `creatorAnalyticsPanelView`. Kept out of components because this app's tests do not render React
 * and a wrong order fails silently:
 *
 * - paused after loading: offline users see a placeholder that never ends.
 * - failure after empty: a failed fetch shows `No published stories yet`, which reads as us having lost
 *   the person's data.
 *
 * Paused and failed states take the screen only when no value is held. With a held value it keeps
 * drawing and only adds a way to retry (`retryable`); covering it with an error screen loses
 * without gaining.
 *
 * Local drafts do not pass through this decision. This file knows only TanStack Query's four axes;
 * the draft panel sits on SQLite and uses `create-home-state.ts`, so a failed server query never
 * touches the draft list.
 */

export type ServerPanelState =
	/** No connection and no held value: waiting, not an error. */
	| "offline"
	/** The query failed and no value is held. */
	| "error"
	/** First fetch in progress. */
	| "loading"
	/** The server has no rows; must be distinguished from failure. */
	| "empty"
	/** There are values to draw. */
	| "ready";

/** Only the query axes this rule reads, so it can be tested without the library. */
export interface ServerPanelQueryView {
	/** Retries paused because the network is judged absent (`fetchStatus: "paused"`). */
	isPaused: boolean;
	isError: boolean;
	isPending: boolean;
	/** Whether at least one page is held. */
	hasData: boolean;
	/** Accumulated row count. */
	rowCount: number;
}

export interface ServerPanelView {
	state: ServerPanelState;
	/**
	 * Whether the last refresh failed or paused while values are drawn. Only `Try again` and a staleness
	 * line are added; the drawn value is still server-confirmed, just possibly not current.
	 */
	retryable: boolean;
}

/** The order is the whole function: held value, paused, failed, loading, empty. */
export function serverPanelView(q: ServerPanelQueryView): ServerPanelView {
	if (q.hasData)
		return {
			state: q.rowCount === 0 ? "empty" : "ready",
			retryable: q.isError || q.isPaused,
		};
	// Paused comes before failed: the user's next step differs (wait vs press again), and paused is
	// still `isPending`, so placing it later would read as loading and never end.
	if (q.isPaused) return { state: "offline", retryable: true };
	if (q.isError) return { state: "error", retryable: true };
	if (q.isPending) return { state: "loading", retryable: false };
	return { state: "empty", retryable: false };
}

/**
 * Ids of drafts alive on this device. Avoids calling `store.getDraft()` per work row, which would
 * cost one SQLite round trip per work on every render (the draft list is already subscribed and
 * changes often). Ids rather than drafts because the screen only needs "can it be opened".
 */
export const draftIdIndex = (drafts: readonly { id: string }[]): Set<string> =>
	new Set(drafts.map((draft) => draft.id));

/**
 * The draft id if this server work can be edited on this device, else `null`.
 *
 * Having `originDraftId` is not the same as that draft existing here; mixing them draws dead links
 * to deleted drafts and offers editing for works published from another device. A missing draft is
 * not an error. Drafts are never restored from the playback snapshot, which is the publication's
 * representation, so republishing a restored draft would make content the creator never wrote their
 * own.
 */
export const editableDraftIdFor = (
	work: { originDraftId: string | null },
	localDraftIds: ReadonlySet<string>,
): string | null =>
	work.originDraftId !== null && localDraftIds.has(work.originDraftId)
		? work.originDraftId
		: null;
