import type { AuthoringStore, PlaytestSnapshot } from "@rowcat/authoring";
import { buildPlaytestSnapshot } from "@rowcat/authoring";

/**
 * The order of starting a playtest, pulled out of the component because the order itself is the
 * rule:
 *
 * 1. Flush pending autosave (aligns the on-screen values with storage).
 * 2. Wait until the local scope opens (the store whose member identity is settled).
 * 3. Read the draft and its children in one go (a consistent snapshot).
 * 4. Pure assembly (@rowcat/authoring, same normalization as publishing).
 * 5. Check ownership, immediately before navigating.
 * 6. Only then navigate to /create/:draftId/test.
 *
 * Step 1 is the reason this function exists. The editor's input is React state and reaches storage
 * only after a debounce (use-draft-autosave.ts). Without the flush, step 3 runs on a revision
 * missing the sentence just typed. The creator then reads their change as not reflected, but the
 * save has simply not happened, so the cause is impossible to find. Publishing does the same thing
 * at the same point (publish-draft.ts).
 *
 * If the write failed, stop here. Starting the test on a different revision than the one displayed
 * silently produces wrong results, and the difference only shows after responses look odd.
 *
 * Unsaved React values are not copied here. Persistence belongs to autosave; copying screen state
 * into this function would create a second copy of that rule, and each screen would have to
 * re-answer which value is saved.
 *
 * No request goes to the server in this sequence. Nothing is published, no work is created, and
 * `/play` is not called. Drafts are local-first resources, and so are playtests.
 */

/**
 * The internal failure categories, which do not map one-to-one to screen messages. `autosave` and
 * `storage` are split because the user's next step differs. `autosave` means the latest text is not
 * saved yet, so pressing again later can work. `storage` means this account's store could not be
 * opened, so pressing again gives the same result.
 */
export type PlaytestStartFailureReason =
	/** Pending edits could not be written: the on-screen values differ from storage. */
	| "autosave"
	/** The local store could not be opened, or the draft disappeared in the meantime. */
	| "storage"
	| "unknown";

export type StartDraftPlaytestOutcome =
	| { status: "started"; snapshot: PlaytestSnapshot }
	/** Already in progress. Not a failure, so the screen changes nothing. */
	| { status: "busy" }
	/**
	 * The scope that was started is no longer active: the user logged out or switched accounts midway.
	 * `failed` is kept separate because the draft has no problem. This is the result of what the user
	 * just did, not an error; the test simply did not start.
	 */
	| { status: "stale" }
	| { status: "failed"; reason: PlaytestStartFailureReason };

export interface StartDraftPlaytestInput {
	draftId: string;
	/**
	 * A synchronous lock against duplicate runs within the same tick. React state cannot do this:
	 * setState is reflected only at the next render, so two double-click events in the same tick would
	 * both see 'not in progress' and pass. A ref is visible the moment it is assigned, so that window
	 * does not exist.
	 */
	lock: { current: boolean };
	/**
	 * Writes pending autosave now and reports whether no pending change remains. It is injected
	 * because this function does not know React (publishing uses the same shape). What is decided
	 * here, when to call it and that failure stops the sequence, is part of this order and does not
	 * depend on the platform.
	 */
	flushAutosave: () => Promise<boolean>;
	ensureStore: () => Promise<AuthoringStore | null>;
	/**
	 * Whether this store still belongs to the active scope.
	 *
	 * It takes a predicate: how ownership is checked differs by platform, but when to ask is the same
	 * everywhere. It is synchronous on purpose; if the check awaited, the check itself would go stale
	 * while waiting.
	 */
	stillOwnsStore: (store: AuthoringStore) => boolean;
	/**
	 * Navigation. The contract is to return a promise, because router navigation is actually
	 * asynchronous; without awaiting it, the 'navigated' verdict would come before navigation
	 * finishes.
	 */
	navigate: (draftId: string) => Promise<unknown>;
}

/**
 * The snapshot built here is a precondition check.
 *
 * The playtest screen builds its own snapshot (it must be reachable by direct reload). It is built
 * here anyway so that failures surface before leaving the editor. If navigation went to a draft
 * deleted in another tab, the arriving screen would draw 'draft not found', and the user would read
 * that the document they were editing had vanished. Building it twice looks wasteful, but the rule
 * is one shared function, so there is no place for two versions to diverge.
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
	// Lock before the first `await`, so a second call in the same tick cannot get past this point.
	lock.current = true;

	try {
		/**
		 * Write pending edits first. If this fails, do not navigate: the user must stay in the editor to
		 * see the failure and retry.
		 */
		let flushed: boolean;
		try {
			flushed = await flushAutosave();
		} catch (error) {
			console.error("[playtest] couldn't write the pending edits", error);
			return { status: "failed", reason: "autosave" };
		}
		if (!flushed) return { status: "failed", reason: "autosave" };

		const store = await ensureStore();
		if (!store) return { status: "failed", reason: "storage" };

		/**
		 * Read the draft and its children at once. Reading three times separately could mix in an
		 * autosave that landed in between, so the prompt would come from the new revision while the lore
		 * came from the old one. Publishing uses the same single operation for the same reason.
		 */
		const source = await store.loadPublicationSource(draftId);
		// Deleted in another tab during editing: there is nothing to test.
		if (!source) return { status: "failed", reason: "storage" };

		/**
		 * Pure assembly. No validation here: a draft whose title or tags are not filled in yet must still
		 * be runnable. Publish validation stays on the publish path.
		 */
		const snapshot = buildPlaytestSnapshot(source);

		/**
		 * Check right before navigating. If logout or an account switch happened while this was running,
		 * the store captured by this closure now belongs to another account or is closed. Navigating then
		 * would open a draft that is not in the current account.
		 *
		 * Stopping here leaves nothing behind: the snapshot lived only in memory and is discarded, and
		 * nothing was sent to the server.
		 */
		if (!stillOwnsStore(store)) return { status: "stale" };

		await navigate(draftId);
		return { status: "started", snapshot };
	} catch (error) {
		console.error("[playtest] couldn't start the story test", error);
		return { status: "failed", reason: "unknown" };
	} finally {
		lock.current = false;
	}
}
