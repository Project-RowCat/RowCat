/**
 * Erase this device's data: the action the user takes directly from settings.
 *
 * It sits next to purge.ts but is not merged with it. The two share what they delete but differ in
 * intent:
 * - Withdrawal: the account is gone, so the scope is abandoned (it must never reopen) and the
 *   query cache is cleared.
 * - Reset: the account stays, so the scope must reopen immediately. Server state is untouched.
 *
 * Merged into one function, the difference becomes one flag (abandon: boolean). A wrong flag in a
 * reset would lock the user out of their own account for the life of the tab (`abandon` in
 * activation.ts).
 *
 * Not deleted: the server. Published works, comments and the ciphertext held in sync are outside
 * this function. Re-adding the key brings the copies back down, and the confirmation dialog says so
 * first (features/settings/local-data-reset-dialog.tsx). Other members' databases are untouched:
 * only this member's name is deleted (deleteLocalDbForViewer in db.ts).
 */

export interface ResetLocalDataOptions {
	/** Currently signed-in member. Must match the scope owner. */
	viewerId: string;
	/**
	 * Reload after the wipe. Reopening the scope in place is not done because the store instance the
	 * screen holds is permanently dead (disableAutoOpen), and liveQuery subscriptions, pending
	 * autosaves and the auto-sync coordinator still reference it. Reopening in place would add a
	 * second reactivation path beside the "only one database open at a time" rule, which is too much
	 * machinery for an irreversible operation.
	 *
	 * It is a parameter so tests can stub it. With the default, the test runner would reload itself.
	 */
	reload?: () => void;
}

export async function resetLocalDataForViewer({
	viewerId,
	reload = () => window.location.reload(),
}: ResetLocalDataOptions): Promise<void> {
	/**
	 * Dynamic import. The settings screen also renders on the server, and a static import of db.ts
	 * would pull Dexie into the server bundle. Same reason as purge.ts.
	 */
	const { deleteLocalDbForViewer } = await import("./db.ts");
	await deleteLocalDbForViewer(viewerId);
	reload();
}
