import type {
	DraftLoreEntry,
	DraftRuntimeAsset,
	DraftRuntimeFile,
	DraftRuntimeProject,
	DraftSceneImage,
	DraftStartScene,
	StoryDraft,
} from "@rowcat/authoring";
import { useLiveQuery } from "dexie-react-hooks";
import { useAuthoringScope } from "./scope.ts";

/**
 * Hook that subscribes to local drafts.
 *
 * The point of this file is that it does not use TanStack Query. That is a cache for remote server
 * state. The values here are the source, not a cache. Wrapping them in useQuery would create two
 * truths: one copy in IndexedDB and one in the query cache. Every autosave that changes the
 * database would then need the cache invalidated by hand, and missing that in a single place would
 * make the editor look as if it lost a character just typed.
 *
 * liveQuery does the opposite and listens to IndexedDB changes directly. So code that adds a child
 * or reorders items does not announce the screen update separately, and the list stays correct. The
 * same holds when sync later writes another device's edit.
 */

export type LocalDraftState =
	| { status: "loading"; draft: null }
	| { status: "missing"; draft: null }
	| { status: "ready"; draft: StoryDraft };

/**
 * Subscribes to one draft.
 *
 * If the scope is not open yet, the state is `loading`, not `missing`. Folding the two together
 * would flash `Draft not found` for a few tens of milliseconds, while the database opens right after
 * sign-in.
 *
 * This rule applies only to scopes that can open. `unavailable` means guest, and a guest has no
 * database to open at all. Folding it into `loading` would wait forever, so a user whose session
 * ended would see only the placeholder. A wait that never ends is worse than an error, because the
 * screen gives no hint of what to do (the chat screen uses the same rule for the same reason).
 * Guests are sent to login from the route anyway, but the session can still end while the screen is
 * being viewed, so there must be an answer here too.
 */
export function useLocalDraft(draftId: string): LocalDraftState {
	const { store, status } = useAuthoringScope();
	const draft = useLiveQuery(
		() => (store ? store.getDraft(draftId) : Promise.resolve(undefined)),
		[store, draftId],
	);

	if (status === "unavailable") return { status: "missing", draft: null };
	if (status !== "ready") return { status: "loading", draft: null };
	// liveQuery returns undefined until the first result arrives. That is distinct from null (absent).
	if (draft === undefined) return { status: "loading", draft: null };
	if (draft === null) return { status: "missing", draft: null };
	return { status: "ready", draft };
}

export interface LocalListState<T> {
	items: T[];
	/** First result has not arrived yet. Distinct from an empty list (`items.length === 0`). */
	loading: boolean;
}

/**
 * The common shape of list subscriptions.
 *
 * One layer, so the three child hooks do not each hold the same code. The named per-domain hooks
 * are kept because call sites must be able to say by name what they subscribe to. A generic form
 * such as `useDraftChildren(draftId, 'lore')` lets a typo survive until runtime.
 */
function useDraftChildren<T>(
	draftId: string,
	read: ((draftId: string) => Promise<T[]>) | null,
	deps: unknown[],
	ready: boolean,
): LocalListState<T> {
	const items = useLiveQuery(
		() => (read ? read(draftId) : Promise.resolve(undefined)),
		deps,
	);
	return { items: items ?? [], loading: !ready || items === undefined };
}

/** Draft list, most recently updated first. Soft-deleted drafts are excluded. */
export function useLocalDrafts(): LocalListState<StoryDraft> {
	const { store, status } = useAuthoringScope();
	const items = useLiveQuery(
		() => (store ? store.listDrafts() : Promise.resolve(undefined)),
		[store],
	);
	return {
		items: items ?? [],
		loading: status !== "ready" || items === undefined,
	};
}

export function useDraftLore(draftId: string): LocalListState<DraftLoreEntry> {
	const { store, status } = useAuthoringScope();
	return useDraftChildren(
		draftId,
		store && ((id: string) => store.listLore(id)),
		[store, draftId],
		status === "ready",
	);
}

export function useDraftStartScenes(
	draftId: string,
): LocalListState<DraftStartScene> {
	const { store, status } = useAuthoringScope();
	return useDraftChildren(
		draftId,
		store && ((id: string) => store.listStartScenes(id)),
		[store, draftId],
		status === "ready",
	);
}

export function useDraftSceneImages(
	draftId: string,
): LocalListState<DraftSceneImage> {
	const { store, status } = useAuthoringScope();
	return useDraftChildren(
		draftId,
		store && ((id: string) => store.listSceneImages(id)),
		[store, draftId],
		status === "ready",
	);
}

export function useDraftRuntimeFiles(
	draftId: string,
): LocalListState<DraftRuntimeFile> {
	const { store, status } = useAuthoringScope();
	return useDraftChildren(
		draftId,
		store && ((id: string) => store.listRuntimeFiles(id)),
		[store, draftId],
		status === "ready",
	);
}

/**
 * Assets grouped under logical names. They are the same kind as files: children of a draft, in path
 * order.
 *
 * The list hook's shape is used as is. An empty list here means exactly 'nothing grouped yet', and
 * the screen has only one thing to draw for that state, the empty state. Unlike projects, there is
 * no reason to tell `null` from `undefined` here.
 */
export function useDraftRuntimeAssets(
	draftId: string,
): LocalListState<DraftRuntimeAsset> {
	const { store, status } = useAuthoringScope();
	return useDraftChildren(
		draftId,
		store && ((id: string) => store.listRuntimeAssets(id)),
		[store, draftId],
		status === "ready",
	);
}

/**
 * One runtime project: distinguishes 'absent' from 'not known yet'.
 *
 * The shape differs from the list hooks. A list's empty array means 'no children', so `items: []`
 * is enough. For a project, `null` (never turned on) and `undefined` (before the first result)
 * produce different screens. Folding them together would flash `Turn on the runtime` for a frame as the
 * studio opens. For someone who had already turned it on, the screen would read as their code
 * having disappeared.
 */
export interface LocalRuntimeProjectState {
	project: DraftRuntimeProject | null;
	loading: boolean;
}

export function useDraftRuntimeProject(
	draftId: string,
): LocalRuntimeProjectState {
	const { store, status } = useAuthoringScope();
	const project = useLiveQuery(
		() =>
			store ? store.getRuntimeProject(draftId) : Promise.resolve(undefined),
		[store, draftId],
	);
	return {
		project: project ?? null,
		loading: status !== "ready" || project === undefined,
	};
}
