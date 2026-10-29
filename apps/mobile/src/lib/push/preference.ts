/**
 * This installation's **push receive decision**. Why the value has three states is the whole of
 * this file.
 *
 * ## Not the same value as the OS permission
 *
 * ```text
 * OS permission     whether this app may draw banners       owned by the OS · the app cannot revoke it
 * this decision    whether RowCat may send to this install  owned by us · the basis of the server registration
 * ```
 *
 * Folding the two into one brings back the most expensive bug in this slice: the user taps `Turn off on this
 * device` and the server registration is removed, but when the app is reopened the **OS permission is
 * still granted**, so automatic refresh quietly re-registers the installation. The screen goes back
 * to "receiving", and the user reads their action as having done nothing.
 *
 * ## Not a boolean
 *
 * ```text
 * unset      never chosen on this installation
 * enabled    the user explicitly turned it on on this installation
 * disabled   the user explicitly turned it off on this installation
 * ```
 *
 * A boolean would drop one of the first two: `false` would mean both *not yet chosen* and *turned
 * off*, and the exact state this file exists to prevent becomes unrepresentable again. The
 * automatic-registration gate must ask whether the value is **not `disabled`**, not whether it is
 * true. The third value also matters at upgrade time: installations coming from a build without
 * this feature are all `unset`, and folding that into `disabled` would switch off push for everyone
 * who had it on, with one update.
 *
 * ## Not synced
 *
 * It lives alongside the installation identity, in device key-value storage. It is not the member
 * database, not SecureStore, not the codec registry of `@rowcat/sync`, and not an account
 * preference on the server. Registration itself is tied to the **session**, but this decision is
 * tied to the **installation**, so it must survive an account switch.
 *
 * ## Only this vocabulary is stored
 *
 * The type accepted by `write` has no slot for a member id, session id or token. Those values are
 * carried by the registration; mixing them in here would put values that must be erased on account
 * change into this installation-scoped store.
 */

/** Key name in device storage. The `rowcat.` prefix is that storage's convention. */
export const PUSH_PREFERENCE_KEY = "rowcat.push.preference";

export type PushPreference = "unset" | "enabled" | "disabled";

/** The two values a user can actually pick. **`unset` is never written**; see the header. */
export type ExplicitPushPreference = Exclude<PushPreference, "unset">;

export interface PushPreferenceStorage {
	/** Never throws; failure reads as `null`. */
	read(): string | null;
	write(value: string): Promise<void>;
}

export interface PushPreferenceStore {
	/**
	 * The decision for this installation right now. **Synchronous**: the value must exist before the
	 * first render judges automatic refresh. If it arrived late, that one frame's judgement would read
	 * `unset` and re-register an installation that had been turned off.
	 */
	read(): PushPreference;
	/**
	 * Records the value the user picked.
	 *
	 * **Does not accept `unset`.** That value means "not yet chosen", and this product has no
	 * operation that reverts a choice once made. If it were accepted, a logout or account-deletion
	 * path could eventually call it, and an installation that was turned off would become a candidate
	 * for automatic registration again.
	 *
	 * **Does not throw.** If the save fails, the picked value still applies for this run (the memory
	 * copy below), and the next run reads the storage again.
	 */
	write(value: ExplicitPushPreference): Promise<void>;
}

/**
 * Stored string → vocabulary.
 *
 * **An unknown value reads as `unset`.** Reading a corrupted value or a string left by an older
 * build as "turned off" would put a decision the user never made on this installation, and that
 * state does not heal itself. The opposite mistake (being switched on once more) is visible on
 * screen and reversible.
 */
export function parsePushPreference(
	stored: string | null | undefined,
): PushPreference {
	return stored === "enabled" || stored === "disabled" ? stored : "unset";
}

export function createPushPreferenceStore(
	storage: PushPreferenceStorage,
): PushPreferenceStore {
	/**
	 * The memory copy serves two purposes: it avoids opening the storage on every judgement, and **if
	 * the save fails, this run still uses the value the user picked** (the same judgement as the
	 * installation identity). If the process dies, that failure reverts to `unset`; that cost is the
	 * only limit the header of this file records.
	 */
	let cached: PushPreference | null = null;

	return {
		read() {
			if (cached !== null) return cached;
			let stored: string | null = null;
			try {
				stored = storage.read();
			} catch {
				stored = null;
			}
			cached = parsePushPreference(stored);
			return cached;
		},
		async write(value) {
			cached = value;
			try {
				await storage.write(value);
			} catch {
				// A failed write still uses the value for this run (see the header).
			}
		},
	};
}
