/**
 * Resets this device's local data. This is the operation the user triggers directly from settings.
 *
 * It sits next to the post-deletion cleanup (`purge-deleted-viewer.ts`) but is deliberately not
 * merged with it. The two share targets but have opposite meaning:
 *
 * ```text
 * account deletion  the account is gone → the scope is **discarded** (it must never reopen) and private query cache is emptied
 * reset             the account remains → the scope must **reopen immediately**. Server state is not touched at all
 * ```
 *
 * Folding them into one function would reduce the difference to one argument (`abandon: boolean`),
 * and a reset that passes that flag by mistake would lock the user out of their own account: the
 * member's scope would never reopen while this process lives (`abandon` in `activation.ts`). The
 * web makes the same call at its equivalent spot (`apps/web/src/lib/local-data/reset.ts`).
 *
 * ## What this function does not do
 *
 * ```text
 * sign out              the session stays. The user keeps using the same account right after reset
 * account deletion      no request goes to the server — it finishes even without a network
 * private query reset   the account is alive. No reason to empty nickname, balance or notifications
 * discard the scope     that finality belongs to deletion (table above)
 * other members' data   the operation removes one name only — it does not sweep by prefix
 * device appearance     lives outside member scope (`lib/appearance/`), so brightness does not revert with it
 * ```
 *
 * ## Ordering belongs to the controller
 *
 * The one structural decision in this file is that the actual deletion is **passed into**
 * `resetScope` and runs from there. If it were called in sequence here (revoke ownership, then
 * delete), an activation already queued in the controller could run in between and recreate the
 * file being deleted. That race does not reproduce, and what remains is an empty database nobody
 * opens. So the deletion runs **inside** that queue (`activation.ts`'s `resetViewer`).
 */

export interface ResetLocalDataPorts {
	/**
	 * Revoke ownership → close the connection → `erase()` → **reactivate**. The controller's serial
	 * queue runs these four as one unit (`MobileLocalScopeValue.resetViewerData`).
	 */
	resetScope: (viewerId: string, erase: () => Promise<void>) => Promise<void>;
	/** SQLite file and SecureStore keys. Only `purge.ts` knows both locations. */
	deleteLocalData: (viewerId: string) => Promise<void>;
}

/**
 * Throws on failure. The confirm dialog receives the error and renders it inside itself, and the
 * user retries. Silently folding to success would have the user leave believing the data was
 * erased.
 */
export function resetViewerLocalData(
	viewerId: string,
	ports: ResetLocalDataPorts,
): Promise<void> {
	return ports.resetScope(viewerId, () => ports.deleteLocalData(viewerId));
}
