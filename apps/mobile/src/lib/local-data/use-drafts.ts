import type {
	AuthoringStore,
	DraftLoreEntry,
	DraftRuntimeProject,
	DraftSceneImage,
	DraftStartScene,
	StoryDraft,
} from "@rowcat/authoring";
import { useMemo } from "react";
import { type LocalLive, useLocalLive } from "./live.ts";
import { useAuthoringScope } from "./scope.tsx";

/**
 * Subscribes to **the drafts and their children** of this account and device. This is also where
 * they are read.
 *
 * Same place and reason as `use-rooms.ts`. If storage queries were called per screen, one would
 * apply the scope check and the other would forget the subscription, and the forgetful one goes
 * **silently stale**. The editor would never draw lore that synced from another device, or the list
 * would keep drawing a draft just deleted.
 *
 * ## The subscription's axis is the write signal: no polling, and no "read again after writing"
 *
 * The assembly point already wraps `AuthoringStore`'s write methods (`stores.ts`), and `live.ts`
 * plugs that signal into React's subscription. So this file has no code that prompts a refresh.
 * Autosave writes, child additions, and **the first local write after a remote change brought by
 * sync** all pass the same signal. A `setInterval` would break, per screen, the promise that a
 * quiet app makes no requests, and reading again directly would reflect only the writes this screen
 * made itself.
 *
 * ## The source of truth is SQLite: it is not held in TanStack Query
 *
 * That is the cache for **server state** (`lib/query.ts`). Holding drafts there would create two
 * truths, and the two inevitably diverge. If the editor drew the diverged copy, the user would read
 * the sentence they just wrote as lost. The fact that the neighbouring tabs on the same screen
 * (`published works`, `analytics`) use that cache is no reason to merge ownership.
 *
 * ## Memoizing the read function is part of the contract
 *
 * A new function per render would make the subscription re-read on every render, and that result
 * would change state and render again (`live.ts` records this rule). The hooks below do the
 * memoizing for the screen, which is also why screens should not call `useLocalLive` directly.
 */

/** Draft list: in the order the store chose, most recently modified first (not re-sorted). */
export interface LocalDrafts extends LocalLive<StoryDraft[]> {
	/**
	 * The owner of this list is the store **instance**, not the member id.
	 *
	 * Consumers attach their own state to this value, so it travels with the data. Comparing member
	 * ids would make `Alice → sign out → Alice` the same value, and a list from a newly opened scope
	 * would inherit the previous session's state.
	 */
	store: AuthoringStore | null;
}

export function useLocalDrafts(): LocalDrafts {
	const { store } = useAuthoringScope();
	const load = useMemo(
		() => (store ? () => store.listDrafts() : null),
		[store],
	);
	const live = useLocalLive<StoryDraft[]>(load, EMPTY_DRAFTS);
	return useMemo(() => ({ ...live, store }), [live, store]);
}

/**
 * One draft.
 *
 * A missing draft is **`null`, not an error**. It was deleted, or it was created on another device
 * and has not arrived yet, or it is a hand-edited deep link. All three are normal, and the screen's
 * job is to state that fact and offer a way out (**it does not create an empty draft**: that would
 * let one wrong address create a document).
 */
export function useLocalDraft(draftId: string): LocalLive<StoryDraft | null> {
	const { store } = useAuthoringScope();
	const load = useMemo(
		() => (store ? () => store.getDraft(draftId) : null),
		[store, draftId],
	);
	return useLocalLive<StoryDraft | null>(load, null);
}

export function useDraftLore(draftId: string): LocalLive<DraftLoreEntry[]> {
	const { store } = useAuthoringScope();
	const load = useMemo(
		() => (store ? () => store.listLore(draftId) : null),
		[store, draftId],
	);
	return useLocalLive<DraftLoreEntry[]>(load, EMPTY_LORE);
}

export function useDraftStartScenes(
	draftId: string,
): LocalLive<DraftStartScene[]> {
	const { store } = useAuthoringScope();
	const load = useMemo(
		() => (store ? () => store.listStartScenes(draftId) : null),
		[store, draftId],
	);
	return useLocalLive<DraftStartScene[]>(load, EMPTY_SCENES);
}

export function useDraftSceneImages(
	draftId: string,
): LocalLive<DraftSceneImage[]> {
	const { store } = useAuthoringScope();
	const load = useMemo(
		() => (store ? () => store.listSceneImages(draftId) : null),
		[store, draftId],
	);
	return useLocalLive<DraftSceneImage[]>(load, EMPTY_IMAGES);
}

/** A stable empty array: a new array per render would make consumers redraw every time. */
const EMPTY_DRAFTS: StoryDraft[] = [];
const EMPTY_LORE: DraftLoreEntry[] = [];
const EMPTY_SCENES: DraftStartScene[] = [];
const EMPTY_IMAGES: DraftSceneImage[] = [];

/**
 * One runtime project: **absent and not-yet-known are distinct.**
 *
 * This is why the shape differs from the list hooks. `null` (never turned on) and `loading` (before
 * the first result) produce **different screens**. If the conversation-material sections (prompt
 * and start scene) opened before the project was read, the typing of that one frame would pass
 * through autosave, and the text just typed would be mixed into the old value of a runtime-enabled
 * work (`resolveConversationAuthoringMode` in `@rowcat/authoring` holds that branch).
 *
 * This app has no runtime authoring screen. What this query answers is one thing, "what execution
 * model this draft uses", and that record arrives from another device through sync.
 */
export interface LocalRuntimeProjectState {
	project: DraftRuntimeProject | null;
	loading: boolean;
}

export function useDraftRuntimeProject(
	draftId: string,
): LocalRuntimeProjectState {
	const { store } = useAuthoringScope();
	const load = useMemo(
		() => (store ? () => store.getRuntimeProject(draftId) : null),
		[store, draftId],
	);
	const live = useLocalLive<DraftRuntimeProject | null>(load, null);
	return { project: live.value, loading: live.status === "loading" };
}
