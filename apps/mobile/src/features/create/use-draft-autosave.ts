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
import { AppState } from "react-native";
import { useAuthoringScope } from "../../lib/local-data/scope.tsx";

/**
 * Autosave for the draft editor. SQLite is the source of truth for persisted data; this hook keeps
 * edits flowing there without a save button.
 *
 * Editor input is React state, since writing to the database on every keystroke would break typing.
 * That state is lost when the screen unmounts, so edits must become local records shortly after
 * typing even though the user never presses "save". This hook bridges that gap.
 *
 * There is no `Save` button, so no second hand-called write path exists: one would skip debouncing,
 * ownership checks and rollback of failed changes. Only a failure opens a retry the user presses
 * (`flush`).
 *
 * ## The queue lives in the shared package
 *
 * Where pending changes collect and what happens on failure is `autosave-queue.ts` in
 * `@rowcat/authoring`, which the web also calls. Per-app copies drift in known ways: one app fails
 * to roll back a failed change, or mixes entries whose store changed. The mismatch shows up only as
 * **data loss**.
 *
 * What stays here: when to flush (debounce, app backgrounding, retry), moving the result into
 * screen state, and `flush`, which publication calls.
 *
 * ## Save status is a subscription, not a value
 *
 * If the hook returned a `status` string, each save (`pending` → `saving` → `saved`) would
 * re-render the whole editor tree three times, including lore cards, scene cards and drawn images.
 * Only a few characters in the header change, so only that subscription should update
 * (`useAutosaveState`). For the same reason the handle this hook returns keeps its identity while
 * records change.
 *
 * ## Flush when the app backgrounds, but do not promise completion
 *
 * Flush once when `AppState` leaves `active`: that is the most common way mobile editing stops, and
 * the debounce window is short. However, the **completion of an async write started at that moment
 * is not guaranteed**: if the OS suspends or kills the process, the transaction never finishes.
 * This is best effort, not a promise, and no mechanism closes that window (none is possible).
 */

/** Save status the screen can show. */
export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * The **two facts** the screen subscribes to.
 *
 * `status` alone cannot answer whether unwritten edits remain. The queue knows that (`queue.size`),
 * and guessing from the label is wrong: `error` can occur with nothing pending (a change whose
 * ownership moved is discarded), and then "retry" does nothing.
 */
export interface AutosaveSnapshot {
	status: AutosaveStatus;
	/** Whether unwritten edits remain in the queue. */
	pending: boolean;
}

/**
 * Debounce interval. Shorter means frequent writes while typing (SQLite transactions are not free);
 * longer widens the loss window when the app is backgrounded. 500ms is about one write per typed
 * sentence. Same value as the web hook, with no reason for the two apps' save feel to differ.
 */
const DEBOUNCE_MS = 500;

/**
 * Delay before the single automatic retry after a failure.
 *
 * Some failures resolve on their own (a lock overlapping another transaction). Retries are not
 * repeated indefinitely because failures that never resolve (full disk, closed connection) would
 * keep the background retry running while only draining the battery. Pending changes stay in the
 * queue, so the next keystroke, app backgrounding or publication is the next chance.
 */
const RETRY_MS = 3_000;

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
	 * Trigger of a scene image. **Assets never change through this path.**
	 *
	 * Picking an image creates the record after the upload finishes, so it is not a value that belongs
	 * in the debounce. Only the typed trigger word travels here.
	 */
	patchSceneImage: (id: string, patch: DraftSceneImagePatch) => void;
	/**
	 * Writes pending changes now. Called where the latest values are required, such as just before
	 * publication.
	 *
	 * Resolves `true` only when no pending changes remain. `false` means some edits are still
	 * unwritten, and publishing in that state would upload a snapshot different from what the user
	 * sees.
	 */
	flush: () => Promise<boolean>;
	/**
	 * Discards pending changes, only when the user explicitly chooses that.
	 *
	 * Draining the queue is the point. Leaving entries behind lets the final flush on unmount write
	 * them, and if that succeeds the edits the user chose to discard come back.
	 */
	discard: () => void;
}

/** Applies one pending change to the store. */
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
		/**
		 * This app has no runtime studio, but this branch must exist anyway.
		 *
		 * The queue's kinds are shared by both apps (`@rowcat/authoring`), so omitting this case breaks
		 * compilation first. That check is what it protects: if a path ever opens that edits a child of a
		 * draft another device created, saves do not silently vanish, because this case is already there.
		 */
		case "runtimeFile":
			return store.updateRuntimeFile(
				entry.id,
				entry.patch as DraftRuntimeFilePatch,
			);
	}
}

export function useDraftAutosave(draftId: string): DraftAutosave {
	const { store, ownsStore } = useAuthoringScope();

	const statusRef = useRef<AutosaveStatus>("idle");
	const listenersRef = useRef(new Set<() => void>());
	/** Pending changes. Merge and rollback rules all belong to the queue. */
	const queueRef = useRef<AutosaveQueue>(createAutosaveQueue());
	/**
	 * Last exported snapshot.
	 *
	 * This object must be cached. `useSyncExternalStore` treats a `getSnapshot()` that returns a new
	 * object on every call as an infinite render loop and throws, so a new object is created only when
	 * the value actually changes.
	 */
	const snapshotRef = useRef<AutosaveSnapshot>({
		status: "idle",
		pending: false,
	});

	/**
	 * Copies the current facts into the snapshot and notifies subscribers **only when they changed**.
	 *
	 * Each save passes through `pending` several times on the normal path (it is scheduled per
	 * keystroke), so without this filter subscribers would re-render on every character.
	 */
	const announce = useCallback(() => {
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
			announce();
		},
		[announce],
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
	/** Current store read outside render; a timer waking up may see stale render values. */
	const storeRef = useRef<AuthoringStore | null>(store);
	const ownsRef = useRef(ownsStore);
	/** Whether the automatic retry was already spent in this failure window. */
	const retriedRef = useRef(false);

	useEffect(() => {
		storeRef.current = store;
		ownsRef.current = ownsStore;
	}, [store, ownsStore]);

	/**
	 * The write in flight. `flush()` just before publication must wait for **that write** too, and by
	 * then a timer may already have woken up and started another. Not waiting lets an older round that
	 * finishes late overwrite the newest state.
	 */
	const inflightRef = useRef<Promise<unknown>>(Promise.resolve());

	const flush = useCallback(async (): Promise<boolean> => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		// Let any running write finish first; deciding earlier lets an older value win.
		await inflightRef.current;

		const queue = queueRef.current;
		if (queue.size === 0) return true;

		/**
		 * If the store does not exist yet, **keep the entries instead of dropping them.** The scope may
		 * still be opening or may have failed briefly, and discarding what the user typed in that case is
		 * exactly what this hook exists to prevent. The effect below flushes again once a store appears.
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
			 * Surface the failure. Swallowing it silently makes the user think the edit saved and leave,
			 * then find it missing on next open. The queue has already restored the pending changes.
			 */
			setStatus("error");
			// Only arm when no timer is set; do not push back a debounce scheduled during the write.
			if (!retriedRef.current && timerRef.current === null) {
				retriedRef.current = true;
				timerRef.current = setTimeout(() => void flush(), RETRY_MS);
			}
			return false;
		}

		retriedRef.current = false;
		const remaining = queue.size > 0;
		/**
		 * `empty` means **nothing was written**: all pending changes belonged to a previous session and
		 * were discarded. Showing "saved" then would claim work that did not happen.
		 */
		setStatus(
			remaining ? "pending" : result.status === "empty" ? "idle" : "saved",
		);
		return !remaining;
	}, [setStatus]);

	/**
	 * Discards pending changes **without writing them**.
	 *
	 * The status becomes `idle` (not `saved`) because nothing was saved. It is not `error` either,
	 * because the failure ended by the user's choice. Leaving a "could not save" message would hang on
	 * screen pointing at nothing.
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

	const schedule = useCallback(
		(kind: PendingKind, id: string, patch: Record<string, unknown>) => {
			const target = storeRef.current;
			// Without a store nothing can be scheduled; the scope the change belongs to cannot be pinned.
			if (!target) return;
			queueRef.current.push({ kind, id, patch, store: target });
			setStatus("pending");

			// A new edit is a new chance; reopen the automatic retry that a previous failure closed.
			retriedRef.current = false;
			if (timerRef.current !== null) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => void flush(), DEBOUNCE_MS);
		},
		[flush, setStatus],
	);

	/**
	 * Flushes once when the app moves to the background.
	 *
	 * This is where the web's `visibilitychange` and `pagehide` sit, and for the same reason it is
	 * best effort: completion of a write started here is not guaranteed (see the header).
	 */
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (next) => {
			if (next !== "active") void flush();
		});
		return () => {
			subscription.remove();
			// Flush on leaving the screen too; navigating to another route also ends an edit.
			void flush();
		};
	}, [flush]);

	/** If the scope opened late, write what has accumulated then. */
	useEffect(() => {
		if (store && queueRef.current.size > 0) void flush();
	}, [store, flush]);

	/**
	 * This handle **does not change** while the editor lives (all dependencies are stable). If save
	 * state were included here, every save would produce a new object, and a `memo` on child lists
	 * would never filter anything because props change each time.
	 */
	return useMemo(
		() => ({
			state: stateSource,
			patchDraft: (patch) => schedule("draft", draftId, patch),
			patchLore: (id, patch) => schedule("lore", id, patch),
			patchStartScene: (id, patch) => schedule("startScene", id, patch),
			patchSceneImage: (id, patch) => schedule("sceneImage", id, patch),
			flush,
			discard,
		}),
		[stateSource, draftId, schedule, flush, discard],
	);
}

/** Subscribes to one line of save state; **only call from the component that draws that text.** */
export function useAutosaveState(autosave: DraftAutosave): AutosaveSnapshot {
	return useSyncExternalStore(autosave.state.subscribe, autosave.state.get);
}
