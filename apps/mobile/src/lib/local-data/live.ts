import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { LocalMutationSignal } from "./mutation-signal.ts";
import { useLocalMutations } from "./scope.tsx";

/**
 * Subscribes to a local store read. Web gets this from Dexie's `liveQuery` (`dexie-react-hooks`);
 * SQLite has no equivalent, only the single write signal the assembly point already wires up
 * (`mutation-signal.ts`). This file plugs that signal into React's subscription and re-runs the
 * handed-in read each time the signal fires.
 *
 * Why not polling or manual refresh: `setInterval` breaks the promise that an idle app makes no
 * requests (it shows up as battery drain). Re-reading after one's own write is worse: it only
 * reflects writes made locally, so when sync applies another device's changes the screen stays
 * stale. The signal covers both paths. User writes emit it from the store wrapper, and remote
 * changes are picked up by the screen's re-subscription that follows `applyPull`.
 *
 * `applyPull` deliberately emits no signal; that would feed back into an endless
 * pull-write-signal-pull loop (see the `stores.ts` header). So a remote change reaches this screen
 * at the next local write or remount, and reducing that delay belongs to the sync layer, not this
 * file.
 *
 * The source of truth is still SQLite. The value held here is the last read result, not a cache.
 * That is why it doesn't go into TanStack Query: that is a cache of server state, and putting local
 * records there would create a second source of truth (see the `lib/query.ts` header).
 */

export type LocalLiveStatus = "loading" | "ready" | "error";

export interface LocalLive<T> {
	value: T;
	status: LocalLiveStatus;
	error: Error | null;
	/** Re-reads without waiting for a signal; the way out of an error state. */
	reload: () => void;
}

/**
 * Subscribes to one store read.
 *
 * When `load` is `null`, nothing is read and the hook stays `loading`. This covers the store not
 * being open yet, or no target being chosen. Folding that into `ready` would render an **empty
 * result**, which the user reads as their conversation having disappeared.
 *
 * **Callers must memoize `load`.** If a new function is passed every render, this hook re-reads on
 * every render (and the result changes state, causing yet another render). Nothing inside the hook
 * can enforce that, so it is noted here.
 */
export function useLocalLive<T>(
	load: (() => Promise<T>) | null,
	initial: T,
): LocalLive<T> {
	return useLocalLiveOn(useLocalMutations(), load, initial);
}

/**
 * The same subscription, run **on a different signal**.
 *
 * The signal is an argument because the app has two axes. Chat and draft writes emit the signal
 * that wakes automatic sync (`stores.mutations`). Device generation preferences aren't synced, so
 * they can't ride that signal: doing so would make changing the response length wake a sync with
 * nothing to upload. Preferences therefore have their own signal (`stores.preferences`), and their
 * subscription passes through this same entry point.
 *
 * It is one hook wrapping both cases rather than two hooks, because the rules are identical: a slow
 * read that finishes late must not overwrite a newer result, and a failed background refresh must
 * not clear the value already shown. If split, one of those rules would get fixed on only one side.
 */
export function useLocalLiveOn<T>(
	signal: LocalMutationSignal | null,
	load: (() => Promise<T>) | null,
	initial: T,
): LocalLive<T> {
	const mutations = signal;

	const subscribe = useCallback(
		(onChange: () => void) => mutations?.subscribe(onChange) ?? noop,
		[mutations],
	);
	const snapshot = useCallback(() => mutations?.version() ?? 0, [mutations]);
	const version = useSyncExternalStore(subscribe, snapshot);

	/** Generation counter for manual retries. Changing it re-runs the effect below; it is separate from the signal. */
	const [attempt, setAttempt] = useState(0);
	const reload = useCallback(() => setAttempt((n) => n + 1), []);

	const [state, setState] = useState<{
		value: T;
		status: LocalLiveStatus;
		error: Error | null;
	}>({ value: initial, status: "loading", error: null });

	/**
	 * Keeps a slow read that finishes late from overwriting a newer result.
	 *
	 * Overlapping reads are normal (signals arrive back-to-back during streaming). Without ordering,
	 * an older list overwrites a newer one and a message just saved disappears from the screen.
	 */
	const sequence = useRef(0);

	/**
	 * `attempt` is a dependency that is **meant not to be read**; the fact that its value changed is
	 * the signal that re-runs this effect. Static analysis only sees that the body never uses it and
	 * calls it unnecessary.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt and version are re-run generations.
	useEffect(() => {
		if (!load) {
			setState({ value: initial, status: "loading", error: null });
			return;
		}
		const mine = ++sequence.current;
		let alive = true;
		load()
			.then((value) => {
				if (alive && mine === sequence.current)
					setState({ value, status: "ready", error: null });
			})
			.catch((error: unknown) => {
				if (alive && mine === sequence.current)
					setState((previous) => ({
						/**
						 * **Keep the held value.** If a background refresh fails and the conversation already drawn
						 * is cleared, the user sees their writing vanish even though the store is fine.
						 */
						value: previous.value,
						status: "error",
						error: error instanceof Error ? error : new Error(String(error)),
					}));
			});
		return () => {
			alive = false;
		};
	}, [load, version, attempt]);

	return { ...state, reload };
}

const noop = () => {};
