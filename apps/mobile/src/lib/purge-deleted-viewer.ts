/**
 * This device's cleanup after an account is deleted. The order in this file is the whole design.
 *
 * It lives outside `lib/local-data/` because the procedure spans several owners: scope activation
 * (ownership), the SQLite file, the SecureStore key and the query cache. Each piece keeps its own
 * rules (`deleteLocalDataForViewer` owns the file and key names, `resetViewerState` owns the
 * private cache list).
 *
 * ## The server goes first
 *
 * This runs only after the server deletion succeeds. Reversed, a wrong password that makes the
 * server refuse would already have removed this device's conversations and drafts, leaving the
 * account intact with its data gone, and no retry could recover it.
 *
 * ## Each step is in its position for a reason
 *
 * ```text
 * 1  abandon the scope (ownership is revoked synchronously)  From this line on, in-flight autosave,
 *                                                           sync and generation lose ownership, and
 *                                                           re-activating the same member is blocked
 *                                                           for good. No new write lands and no
 *                                                           emptied file is resurrected while step 2 runs.
 * 2  delete the file and the key                            One SQLite file plus one SecureStore
 *                                                           entry. One function knows both places
 *                                                           (`purge.ts`).
 * 3  clear the private query cache                          Runs even if 2 fails. A deleted account's
 *                                                           email and other private values have no
 *                                                           reason to stay on screen because cleanup
 *                                                           failed.
 * ```
 *
 * ## Failure does not roll back
 *
 * File deletion can fail, and the account cannot be revived then, so **the deletion still
 * succeeds**; only this device's cleanup failed. The function rethrows, but only after step 3.
 * Retrying needs no auth: it needs only the member id, which the caller holds from before the
 * deletion.
 */
export interface PurgeDeletedViewerPorts {
	/** Revokes scope ownership and blocks re-activation (`MobileLocalScopeValue.abandonViewer`). */
	abandonViewer: (viewerId: string) => Promise<void>;
	/** SQLite file and SecureStore key (wiring of `deleteLocalDataForViewer`). */
	deleteLocalData: (viewerId: string) => Promise<void>;
	/** Resets the private query cache (wiring of `resetViewerState(queryClient)`). */
	resetPrivateState: () => Promise<void>;
}

export async function purgeDeletedViewer(
	viewerId: string,
	ports: PurgeDeletedViewerPorts,
): Promise<void> {
	await ports.abandonViewer(viewerId);
	try {
		await ports.deleteLocalData(viewerId);
	} finally {
		await ports.resetPrivateState();
	}
}
