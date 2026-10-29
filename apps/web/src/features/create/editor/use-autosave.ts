import type {
	AuthoringStore,
	AutosaveQueue,
	DraftLoreEntryPatch,
	DraftRuntimeFilePatch,
	DraftSceneImagePatch,
	DraftStartScenePatch,
	PendingEntry,
	PendingKind,
	StoryDraftPatch,
} from "@rowcat/authoring";
import { commitQueue, createAutosaveQueue } from "@rowcat/authoring";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";

/**
 * Autosave layer. IndexedDB is the source of truth for persistence; this hook keeps the screen in
 * step with it.
 *
 * - Typed input lives in React state, because writing to the database on every keystroke breaks
 *   typing. The local record must still exist soon after each keystroke, with no Save button.
 * - Any field change is worth saving, including the title. The legacy editor required a title
 *   before saving, which lost work written title-last. There is no such gate here.
 * - No second copy in localStorage. A backup would create two sources of truth with no way to
 *   tell which is newer. The draft record is the autosave.
 * - No reliance on `beforeunload`, whose async writes are not guaranteed to finish.
 *   `visibilitychange` (hidden) and `pagehide` flush early instead. They also fire on mobile app
 *   switches, where `beforeunload` often never fires.
 * - Pending changes survive write failures. The queue and its rules live in `@rowcat/authoring`,
 *   which the mobile editor also calls. This hook decides when to flush (debounce, hide, retry) and
 *   maps the result onto screen state.
 * - Save state is a subscription, not a value. Returning a status string would re-render the
 *   whole editor tree on each transition, and layout-measured children would re-measure. Only the
 *   status label subscribes (`useAutosaveState`). The returned handle keeps its identity across
 *   record changes, so `memo` on children works.
 * - After automatic retries fail, a person can still act: a manual retry (`flush`) and an
 *   explicit discard. Navigation blocking (`draft-leave.ts`) rests on these. A confirmed failure
 *   does not trap the user in the editor, and it does not silently lose the text either.
 */

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * The two facts the screen subscribes to. `status` alone cannot answer whether edits are still
 * queued and unwritten. The queue knows that (`queue.size`), and guessing it from the label is
 * wrong: there are real cases where status is `error` but nothing is pending, such as when
 * ownership moved to another session and the changes were discarded. In that case retry does
 * nothing and there is no reason to block navigation. So the code asks rather than guesses. Only
 * when both are true is there a risk of irreversible loss.
 */
export interface AutosaveSnapshot {
	status: AutosaveStatus;
	pending: boolean;
}

/**
 * Debounce length. Shorter means frequent writes during typing, and IndexedDB writes are not free.
 * Longer means a bigger loss window if the tab closes. 500 ms is roughly one write per sentence: it
 * saves soon after the hand stops, and batches while typing continues.
 */
const DEBOUNCE_MS = 500;

/**
 * Delay before the one automatic retry after a failure.
 *
 * Some IndexedDB failures clear themselves, for example a transaction aborted while another tab is
 * upgrading the schema. Waiting for the user to type again would leave 'save failed' on screen even
 * though a write would now succeed.
 *
 * Retries are not repeated indefinitely, because some failures never clear: quota exceeded, or
 * storage refused in private mode. Background retries there would fill the console without changing
 * the state. Pending changes stay queued, so the next keystroke, screen hide, or publish is the
 * next chance.
 */
const RETRY_MS = 3_000;

/**
 * The channel for reading save state. A subscription is passed instead of a value, for the reason
 * in point 5 of the header. `useSyncExternalStore` accepts this shape directly, so no adapter is
 * needed.
 *
 * `get()` is also called outside render, for example by the leave check (`draft-leave.ts`). There
 * the current fact is needed, not the value that was last rendered.
 */
export interface AutosaveStateSource {
	subscribe: (listener: () => void) => () => void;
	get: () => AutosaveSnapshot;
}

export interface DraftAutosave {
	state: AutosaveStateSource;
	patchDraft: (patch: StoryDraftPatch) => void;
	patchLore: (id: string, patch: DraftLoreEntryPatch) => void;
	patchStartScene: (id: string, patch: DraftStartScenePatch) => void;
	/**
	 * The trigger for scene images. Asset identity does not change through this path. Choosing an
	 * image is an operation that creates a record after the upload finishes (`addSceneImage`), not a
	 * value to debounce. Only the typed trigger word goes through here.
	 */
	patchSceneImage: (id: string, patch: DraftSceneImagePatch) => void;
	/**
	 * One line of runtime source. This is the only save path the studio uses.
	 *
	 * Code editing is also typing, so it goes through the same queue as the other fields. If the
	 * studio called the store directly, it would bypass the flush on screen hide, the account-switch
	 * check, and the leave block. The cost would show as users who close the tab losing their last few
	 * seconds.
	 */
	patchRuntimeFile: (id: string, patch: DraftRuntimeFilePatch) => void;
	/**
	 * Writes pending changes now. Callers that need the latest value, such as right before publishing,
	 * call this.
	 *
	 * Returning a promise is part of the contract. Publishing re-reads from the store and assembles
	 * from there (`publishDraft`), so reading before the write finishes would publish without the last
	 * typed sentence.
	 *
	 * The resolved value is whether no pending changes remain. `false` means some edits are still
	 * unwritten. Publishing in that state would upload a snapshot different from what the user sees.
	 */
	flush: () => Promise<boolean>;
	/**
	 * Discards pending changes without writing them. It is called from one place only: the leave
	 * confirmation shown when a save has failed (`draft-leave-guard.tsx`). A failure cannot trap the
	 * user in the editor, but silently letting them leave would drop text they were looking at. This
	 * function is the third option: say so, let the user choose, and carry out that choice.
	 *
	 * Clearing the queue is the point. If it were kept, the final flush on unmount would try to write
	 * it again, and a successful write would bring back the edit the user chose to discard.
	 */
	discard: () => void;
}

function commit(entry: PendingEntry): Promise<unknown> {
	const store = entry.store;
	switch (entry.kind) {
		case "draft":
			return store.updateDraft(entry.id, entry.patch as StoryDraftPatch);
		case "lore":
			return store.updateLore(entry.id, entry.patch as DraftLoreEntryPatch);
		case "startScene":
			return store.updateStartScene(
				entry.id,
				entry.patch as DraftStartScenePatch,
			);
		case "sceneImage":
			return store.updateSceneImage(
				entry.id,
				entry.patch as DraftSceneImagePatch,
			);
		case "runtimeFile":
			return store.updateRuntimeFile(
				entry.id,
				entry.patch as DraftRuntimeFilePatch,
			);
	}
}

export function useDraftAutosave(draftId: string): DraftAutosave {
	const { store, ownsStore } = useAuthoringScope();

	/**
	 * Save state is a small store, not React state (see point 5 of the header). The same value is not
	 * announced twice. A single save passes through `pending` several times, since each keystroke
	 * schedules one. Without this filter, every subscriber would re-render per character.
	 */
	const statusRef = useRef<AutosaveStatus>("idle");
	const listenersRef = useRef(new Set<() => void>());
	/** Pending changes. All merging and rollback rules live in the queue. */
	const queueRef = useRef<AutosaveQueue>(createAutosaveQueue());
	/**
	 * The last emitted snapshot is cached. `useSyncExternalStore` treats a `getSnapshot()` that
	 * returns a new object on every call as an infinite render loop and throws. A new object is
	 * created only when the value actually changes.
	 */
	const snapshotRef = useRef<AutosaveSnapshot>({
		status: "idle",
		pending: false,
	});
	const publish = useCallback(() => {
		const previous = snapshotRef.current;
		const status = statusRef.current;
		const pending = queueRef.current.size > 0;
		if (previous.status === status && previous.pending === pending) return;
		snapshotRef.current = { status, pending };
		for (const listener of listenersRef.current) listener();
	}, []);
	const setStatus = useCallback(
		(next: AutosaveStatus) => {
			statusRef.current = next;
			publish();
		},
		[publish],
	);
	const stateSource = useMemo<AutosaveStateSource>(
		() => ({
			subscribe: (listener) => {
				const listeners = listenersRef.current;
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			get: () => snapshotRef.current,
		}),
		[],
	);

	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/**
	 * The current store, read outside render. A timer that fires later may otherwise see stale render
	 * values.
	 */
	const storeRef = useRef<AuthoringStore | null>(store);
	const ownsRef = useRef(ownsStore);
	/**
	 * Whether the automatic retry has already been used in this failure streak (see `RETRY_MS` above).
	 */
	const retriedRef = useRef(false);

	useEffect(() => {
		storeRef.current = store;
		ownsRef.current = ownsStore;
	}, [store, ownsStore]);

	/**
	 * The write in progress. Before publishing, `flush()` must wait for that write to finish, and a
	 * debounce timer may already have woken up and started one by then.
	 */
	const inflightRef = useRef<Promise<unknown>>(Promise.resolve());

	const flush = useCallback(async (): Promise<boolean> => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		// Wait for any earlier write still running to finish before deciding. If the order flipped, an
		// old value would win.
		await inflightRef.current;

		const queue = queueRef.current;
		if (queue.size === 0) return true;

		/**
		 * If the store does not exist yet, pending changes are kept, not discarded. The scope may still
		 * be opening, or a transient failure may have occurred. Discarding the text the user typed is
		 * exactly what this hook exists to prevent. The effect below flushes again once the store
		 * appears.
		 */
		if (!storeRef.current) return false;

		setStatus("saving");
		const writing = commitQueue({
			queue,
			ownsStore: (target) => ownsRef.current(target),
			commit,
		});
		inflightRef.current = writing;
		const result = await writing;

		if (result.status === "failed") {
			/**
			 * The failure is shown to the user. Swallowing it silently would let the user assume the work
			 * was saved, close the tab, and find it missing later. The pending changes are already put back
			 * in the queue.
			 */
			console.error("[create] couldn't save the draft", result.error);
			setStatus("error");
			// Schedule a retry only when no timer is set. Do not push back a debounce scheduled during the
			// write.
			if (!retriedRef.current && timerRef.current === null) {
				retriedRef.current = true;
				timerRef.current = setTimeout(() => void flush(), RETRY_MS);
			}
			return false;
		}

		retriedRef.current = false;
		const remaining = queue.size > 0;
		/**
		 * `empty` means nothing was written: every pending change belonged to a previous session and was
		 * discarded. Showing `Saved` here would claim work that was never done.
		 */
		setStatus(
			remaining ? "pending" : result.status === "empty" ? "idle" : "saved",
		);
		return !remaining;
	}, [setStatus]);

	/**
	 * Discards pending changes without writing them. Clearing the queue is the substance of this
	 * choice. The pending timer is cancelled too. Otherwise one more flush would run right after the
	 * discard, writing nothing but briefly moving the state to `saving`.
	 *
	 * The state becomes `idle`. Not `saved`, because nothing was saved. Not `error`, because the
	 * failure ended by the user's choice. Staying in `error` would keep `Couldn't save` on screen until
	 * the next keystroke, and the message would then refer to nothing.
	 */
	const discard = useCallback(() => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		queueRef.current.drain();
		retriedRef.current = false;
		setStatus("idle");
	}, [setStatus]);

	/**
	 * No write skips the debounce. There once was one (`commitDraft`), because structural changes such
	 * as switching the authoring mode should not feel unresponsive while waiting 500 ms. Those
	 * controls have since left this screen, when the authoring body folded into the prompt. Every
	 * remaining edit is now either typing or a structural change with its own transaction
	 * (`useDraftActions`). A handle with no caller would tend to get used later, on the reasoning that
	 * it already exists.
	 */
	const schedule = useCallback(
		(kind: PendingKind, id: string, patch: Record<string, unknown>) => {
			const target = storeRef.current;
			// Without a store there is nothing to schedule into, and the change cannot be bound to a
			// specific scope.
			if (!target) return;
			queueRef.current.push({ kind, id, patch, store: target });
			setStatus("pending");

			// A new edit is a new opportunity. Reopen the automatic retry that an earlier failure closed.
			retriedRef.current = false;
			if (timerRef.current !== null) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => void flush(), DEBOUNCE_MS);
		},
		[flush, setStatus],
	);

	/**
	 * The moments the browser hides the page. Chosen over `beforeunload` for delivery guarantees:
	 * async writes started in `beforeunload` may not finish, and on mobile that event often never
	 * fires (app switch, going home). `visibilitychange` and `pagehide` do fire on those paths.
	 */
	useEffect(() => {
		const onHide = () => {
			if (document.visibilityState === "hidden") void flush();
		};
		const onPageHide = () => void flush();
		document.addEventListener("visibilitychange", onHide);
		window.addEventListener("pagehide", onPageHide);
		return () => {
			document.removeEventListener("visibilitychange", onHide);
			window.removeEventListener("pagehide", onPageHide);
			// Also flush when leaving the screen. Navigating to another route also counts as the end of
			// editing.
			void flush();
		};
	}, [flush]);

	/** If the scope opened late, write any changes that were queued in the meantime. */
	useEffect(() => {
		if (store && queueRef.current.size > 0) void flush();
	}, [store, flush]);

	/**
	 * This handle does not change for the life of the editor; all its dependencies are stable. If the
	 * save state were included, it would be a new object on every save, and `memo` on child lists
	 * would filter nothing, since their props would differ each time.
	 */
	return useMemo(
		() => ({
			state: stateSource,
			patchDraft: (patch) => schedule("draft", draftId, patch),
			patchLore: (id, patch) => schedule("lore", id, patch),
			patchStartScene: (id, patch) => schedule("startScene", id, patch),
			patchSceneImage: (id, patch) => schedule("sceneImage", id, patch),
			patchRuntimeFile: (id, patch) => schedule("runtimeFile", id, patch),
			flush,
			discard,
		}),
		[stateSource, draftId, schedule, flush, discard],
	);
}

/**
 * On the server this must be a module-level constant. A new object per call would make
 * `useSyncExternalStore` loop forever during server render. The editor renders only after a draft
 * opens, so this is rarely reached. When it is reached, a wrong value would fail silently, which is
 * why it is a constant.
 */
const SERVER_SNAPSHOT: AutosaveSnapshot = { status: "idle", pending: false };

/**
 * Subscribes to one save-state line. Only the component that draws that text should call this. If
 * the editor body called it, the whole tree would re-render with each update, defeating the
 * purpose.
 */
export function useAutosaveState(autosave: DraftAutosave): AutosaveSnapshot {
	return useSyncExternalStore(
		autosave.state.subscribe,
		autosave.state.get,
		// Nothing is saved on the server, so the server snapshot is always the idle value.
		() => SERVER_SNAPSHOT,
	);
}
