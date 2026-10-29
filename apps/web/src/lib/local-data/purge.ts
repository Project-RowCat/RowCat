import { resetViewerState } from "@rowcat/query";
import type { QueryClient } from "@tanstack/react-query";
import type { LocalDataScope } from "./scope.tsx";

/**
 * Local cleanup for a withdrawn member, kept in one place because the sequence spans domains:
 * conversations, authoring, sync, device preferences, the remembered device key and the query
 * cache. If one store owned the procedure, the others would be dragged into knowledge they do not
 * need, and new domains would never be added here.
 *
 * The server deletion must succeed first. Wiping locally first would remove this device's data and
 * then fail on a wrong password. The account would remain with its data gone, and no retry can
 * restore that.
 *
 * Local failure does not roll back. The account cannot be restored, so the withdrawal still counts
 * as successful. A cleanup failure is rethrown, but the private query cache is cleared first in
 * every case. Retries need only the member id, which the caller reads before the server call.
 */

export interface PurgeDeletedViewerOptions {
	/** Member id of the deleted account. Read it before the server deletion. */
	viewerId: string;
	/**
	 * Current local scope. On retries it is already a guest scope and nothing happens. The first call
	 * already abandoned it, and abandonment cannot be undone.
	 */
	scope: LocalDataScope;
	queryClient: QueryClient;
}

/**
 * Erases this device's traces of the member. The order matters.
 *
 * 1. Abandon the scope (synchronous). From the moment this returns, in-progress autosave, sync
 *    and generation lose ownership. Nothing new is written while the later steps wait.
 * 2. Delete the database. Deleting through the open instance means that instance is not reopened
 *    automatically later, so a late write cannot revive the database.
 * 3. Clear the query cache. This makes the viewer null and drops the scope to guest, so it must
 *    come after step 2. If it came first, the connection would be released before the deletion,
 *    step 2 would delete by name only, and the guarantee above would be lost.
 */
export async function purgeDeletedViewerLocally({
	viewerId,
	scope,
	queryClient,
}: PurgeDeletedViewerOptions): Promise<void> {
	scope.abandonViewer(viewerId);

	try {
		/**
		 * Dynamic import. This module is called from the account screen, which also renders on the
		 * server. A static import of db.ts would pull Dexie into the server bundle's static graph.
		 */
		const { deleteLocalDbForViewer } = await import("./db.ts");
		await deleteLocalDbForViewer(viewerId);
	} finally {
		/**
		 * Private server-side state is cleared whether or not the steps above succeeded. Using the same
		 * function as logout is the point: the list of slots to clear (viewer, personalization, account,
		 * gallery, detail) already lives there. A second list here would eventually be updated on one
		 * side only.
		 */
		await resetViewerState(queryClient);
	}
}
