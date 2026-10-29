import type {
	DraftConflictRecovery,
	DraftRecoveryStore,
} from "@rowcat/authoring";
import { parseDraftConflictRecovery } from "@rowcat/authoring";
import type { LocalDb } from "#/lib/local-data/db.ts";

/**
 * IndexedDB implementation of DraftRecoveryStore. Read and discard only.
 * - No write method, by contract. Copies are created inside the transaction that commits a merge
 *   (applyPull in local-sync/store.ts). A save method here would break that atomicity, since a copy
 *   made outside a merge would not point at any lost conflict.
 * - Does not follow draft deletion. Copies survive when their draft is deleted, because a
 *   paragraph lost in a draft deleted on another device may be here. Cascading the delete would
 *   hide that it existed. The screen says the original is gone and lets the user read the content.
 */

/**
 * Converts stored rows into typed copies. Rows that cannot be read are silently dropped. One
 * corrupt row, or a row using vocabulary this app does not know, must not fail the whole list.
 * Otherwise intact copies beside it would be hidden too, and a feature meant to recover data would
 * block recovery.
 */
const parseAll = (
	rows: readonly Parameters<typeof parseDraftConflictRecovery>[0][],
): DraftConflictRecovery[] => {
	const parsed: DraftConflictRecovery[] = [];
	for (const row of rows) {
		const recovery = parseDraftConflictRecovery(row);
		if (recovery) parsed.push(recovery);
	}
	return parsed;
};

/** Sorted by most recent observation. The top of the list is the value lost most recently. */
const byRecency = (
	a: DraftConflictRecovery,
	b: DraftConflictRecovery,
): number =>
	a.observedAt === b.observedAt
		? a.id < b.id
			? 1
			: -1
		: a.observedAt < b.observedAt
			? 1
			: -1;

export function createDraftRecoveryStore(db: LocalDb): DraftRecoveryStore {
	return {
		async list() {
			return parseAll(await db.syncRecoveries.toArray()).sort(byRecency);
		},

		async listForDraft(draftId: string) {
			/**
			 * Uses the recordId index. Reading all rows and filtering in memory would parse every copy in
			 * the account each time the editor opens, just to draw one notice.
			 */
			return parseAll(
				await db.syncRecoveries.where("recordId").equals(draftId).toArray(),
			).sort(byRecency);
		},

		/**
		 * Permanently discards this local copy. The canonical draft is never touched. A missing id counts
		 * as success. Two tabs discarding the same copy at once is normal, and failing the second would
		 * show an error for a line that is already gone.
		 */
		async discard(id: string) {
			await db.syncRecoveries.delete(id);
		},
	};
}
