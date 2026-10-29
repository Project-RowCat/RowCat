import type { AuthoringStore, PlaytestSnapshot } from "@rowcat/authoring";
import { buildPlaytestSnapshot } from "@rowcat/authoring";

/**
 * The order of `Story test` — pulled out of the component because **the order itself is the rule**.
 *
 * ```text
 * 0. Lock out duplicate runs in the same tick   ← before the first `await`
 * 1. Flush pending autosave                      ← aligns the screen's values with storage
 * 2. Wait for the local scope to open            (storage whose member identity is settled)
 * 3. Read the draft and its children at once     (consistent snapshot)
 * 4. Pure assembly                               (@rowcat/authoring, the **same normalization** as publish)
 * 5. Check ownership                             ← right before navigating
 * 6. Only then navigate to /create/:draftId/test
 * ```
 *
 * **Step 1 is why this function exists.** The editor's input is React state, and it reaches storage
 * only after the debounce (`use-draft-autosave.ts`). If step 3 ran without flushing, the test would
 * run on a version missing the sentence just typed, and the creator would read that their edits are
 * not reflected — but since the save is still pending, there is no way to find the cause.
 * Publishing does the same job in the same place for the same reason
 * (`features/create/publish-draft.ts`).
 *
 * **Stop here if it could not be written.** Starting the test on a version different from the one
 * on screen silently produces wrong results, and the difference only surfaces after the response
 * goes wrong.
 *
 * **Unsaved React values are not copied here.** Persistence's owner is autosave. Assembling from
 * screen state here would make a second copy of that rule, and from then on each screen would have
 * to answer again what the stored value is.
 *
 * No request leaves the server during this sequence. It does not publish, does not create a story,
 * does not call `/play`, and does not record view history — a draft is a local-first resource, and
 * so is the test.
 *
 * ## Same name and same order on the web, different file
 *
 * `apps/web/src/features/playtest/start-draft-playtest.ts` has the same table. It is not moved to a
 * shared package because of layering: this function sees the `@rowcat/authoring` storage port and
 * the app's navigation **at once**, and no package in this repository sits above both (publishing
 * has the same shape for that reason). Only one thing differs: a log line. This app's product path
 * contains no `console` call (`lib/boundaries.test.ts`), so failure is returned as a value only.
 */

/**
 * The **internal** branches of failure. These are not one-to-one with the screen copy.
 *
 * `autosave` and `storage` are kept apart because the user has to do different things. The first
 * means the text just typed is not saved yet, so pressing again shortly will do. The second means
 * this account's storage did not open, so pressing again gives the same result.
 */
export type PlaytestStartFailureReason =
	/** The pending edit could not be written — the screen's value and storage's value differ. */
	| "autosave"
	/** Local storage did not open, or the draft disappeared in between. */
	| "storage"
	| "unknown";

export type StartDraftPlaytestOutcome =
	| { status: "started"; snapshot: PlaytestSnapshot }
	/** Already in progress. Not a failure, so the screen changes nothing. */
	| { status: "busy" }
	/**
	 * The scope that started is no longer active — the user signed out or switched accounts
	 * mid-flight.
	 *
	 * Kept apart from `failed` because **the draft itself has no problem**. It is a result of what the
	 * user just did (switching accounts), so it is not an error — the test simply did not start.
	 */
	| { status: "stale" }
	| { status: "failed"; reason: PlaytestStartFailureReason };

export interface StartDraftPlaytestInput {
	draftId: string;
	/**
	 * Synchronous lock against duplicate runs in the same tick.
	 *
	 * React state cannot do this. `setState` takes effect only at the next render, so two presses
	 * arriving in the same tick both see "not in progress" and pass. A ref is visible the moment it is
	 * assigned, so that window does not exist.
	 */
	lock: { current: boolean };
	/**
	 * Writes pending autosave now. Answers **whether any pending change remains**.
	 *
	 * It is received as an injection because this function does not know React (publishing uses the
	 * same shape). What is decided here is "when to call it" and "stop on failure", and both are part
	 * of this order regardless of platform.
	 */
	flushAutosave: () => Promise<boolean>;
	ensureStore: () => Promise<AuthoringStore | null>;
	/**
	 * Whether this store is **still** the active scope's.
	 *
	 * Taking a predicate is the point. How ownership is judged differs per platform, but **when to
	 * ask** is the same everywhere. It is synchronous on purpose: waiting again while judging would
	 * make the judgment itself stale. It compares the **instance**, not the member id, because of
	 * `Alice → sign out → Alice` (`lib/local-data/scope.tsx`).
	 */
	stillOwnsStore: (store: AuthoringStore) => boolean;
	/** Navigation. The contract is to return a promise — native stack navigation is asynchronous too. */
	navigate: (draftId: string) => Promise<unknown>;
}

/**
 * The snapshot built here is a **precondition check**.
 *
 * The test screen builds its own snapshot (it must be possible to arrive by direct address). It is
 * built once here anyway to **surface failures before leaving the editor**: navigating to a draft
 * deleted on another device would show "this draft is not in this account" on arrival, and the user
 * would read that the document they were just editing had vanished. Building twice looks wasteful
 * here, but the build rule is **one function**, so there is no place for two copies to diverge.
 */
export async function startDraftPlaytest({
	draftId,
	lock,
	flushAutosave,
	ensureStore,
	stillOwnsStore,
	navigate,
}: StartDraftPlaytestInput): Promise<StartDraftPlaytestOutcome> {
	if (lock.current) return { status: "busy" };
	// Lock before the first await — a second call in the same tick cannot get past this point.
	lock.current = true;

	try {
		/**
		 * ① Write the pending edit first. If that fails, **do not navigate** — staying in the editor lets
		 * the user know and retry.
		 */
		let flushed: boolean;
		try {
			flushed = await flushAutosave();
		} catch {
			return { status: "failed", reason: "autosave" };
		}
		if (!flushed) return { status: "failed", reason: "autosave" };

		const store = await ensureStore();
		if (!store) return { status: "failed", reason: "storage" };

		/**
		 * ② Read the draft and its children **at once**. Four separate reads could mix in an autosave
		 * that lands between them; the prompt would then come from the new version while the lore comes
		 * from the old one, and the test would run on that mixed snapshot. Publishing uses the same
		 * operation for the same reason.
		 */
		const source = await store.loadPublicationSource(draftId);
		// A deletion from another device arrived mid-edit. There is nothing to test.
		if (!source) return { status: "failed", reason: "storage" };

		/**
		 * ③ Pure assembly. **No validation** — a draft without a title or tags yet must still be
		 * runnable. Publish validation stays on the publish path (`buildStoryPublication`).
		 */
		const snapshot = buildPlaytestSnapshot(source);

		/**
		 * ④ Check just before navigating. If a logout or account switch arrived during the wait, the
		 * store this closure holds now belongs to another account or is a closed connection. Navigating
		 * in that state would open a draft that is not in the current account on arrival.
		 *
		 * Stopping here **leaves nothing behind.** The snapshot is in memory and is discarded, and
		 * nothing was ever sent to the server.
		 */
		if (!stillOwnsStore(store)) return { status: "stale" };

		await navigate(draftId);
		return { status: "started", snapshot };
	} catch {
		return { status: "failed", reason: "unknown" };
	} finally {
		lock.current = false;
	}
}
