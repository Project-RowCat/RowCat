import { viewerQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getRowCatClient } from "#/lib/api.ts";
import {
	createLocalDataActivation,
	type LocalDataActivation,
	type LocalDataDomain,
	type LocalDataStores,
} from "./activation.ts";

/**
 * Lifetime of the local database scope. This is web infrastructure, not shared code: session timing
 * comes from this app's authentication (Better Auth cookie plus /me). The shared package owns only
 * the rule that stores are readable while the scope is open.
 * - unavailable: guest, no scope. activating: member confirmed, database still opening. ready:
 *   database open.
 * - activating is separate from ready because finishing the viewer lookup does not mean the
 *   database is open. During an account switch, the previous member's database may still be
 *   closing.
 * - unavailable means only guest. Folding a confirmed member into it would show a storage failure
 *   the user did not cause.
 * - Domains share one scope rather than each having one. Chat and authoring share one database,
 *   and separate activations would fight over the same connection. Each domain gets a narrow
 *   adapter.
 */

export type LocalDataScopeStatus = "unavailable" | "activating" | "ready";

export interface LocalDataScope {
	status: LocalDataScopeStatus;
	/** Non-null only when status is "ready". Otherwise there is no store to access. */
	stores: LocalDataStores | null;
	/** Owner of the current scope (RowCat member id). null for a guest. */
	viewerId: string | null;
	/**
	 * Waits until the scope opens, then returns the store. Returns null for a guest or on failure.
	 *
	 * Render state alone is not enough. A user can press the button right after hydration, while the
	 * scope is still opening. A disabled button in that window would show a logged-in user a CTA that
	 * does not work on the first screen. Waiting gives the same guarantee without the flicker, since
	 * nothing is read before the scope opens.
	 *
	 * When a member is confirmed, calling this is always valid. If the activation effect has not run
	 * yet, this call starts activation itself, so there is no window where the button works but no
	 * store exists. It does not reject, because a failure is null. The caller usually needs a yes or
	 * no answer to "can I write?"
	 */
	ensureStores: () => Promise<LocalDataStores | null>;
	/**
	 * ensureStores guarantees ownership only at the moment it finishes. Later waits (snapshot fetch,
	 * publish round trip, local writes) can overlap a logout or account switch. The stale closure's
	 * store then belongs to someone else or is closed. Writing a room or a publish result into it
	 * would add device data for an account that is no longer current.
	 *
	 * So ownership is checked again before every irreversible step. The check only judges and does not
	 * repair. If ownership has moved, the old scope must not be reopened. The operation simply ends,
	 * which keeps the "one database open" rule intact.
	 *
	 * Both the member id and the store instance are checked. After Alice logs out and back in, the id
	 * matches but the connection was closed and reopened, so only the instance check catches the stale
	 * operation. The domain is passed because callers hold only their own store.
	 */
	ownsStore: <K extends LocalDataDomain>(
		domain: K,
		store: LocalDataStores[K],
	) => boolean;
	/**
	 * Permanently abandons this member's scope. Call only after the server has confirmed the account
	 * deletion.
	 *
	 * This is synchronous on purpose. With any await between the server success and this call, a
	 * running autosave or sync could still be judged the owner in that gap. From the moment this
	 * returns, ownsStore is false and ensureStores returns null.
	 *
	 * It does not delete data. deleteLocalDbForViewer does that, and it must be retryable because the
	 * account is gone and cannot be restored. That is why the deletion function lives outside React
	 * (local-data/purge.ts). It runs once while the scope is alive. Retries call only the deletion
	 * function. In a guest scope this does nothing.
	 */
	abandonViewer: (viewerId: string) => void;
}

const noStores = async (): Promise<LocalDataStores | null> => null;
const noOwnership = (): boolean => false;
/** A guest has no scope to abandon. Retries after the account deletion take this branch. */
const noAbandon = (): void => {};

export const UNAVAILABLE_LOCAL_DATA_SCOPE: LocalDataScope = {
	status: "unavailable",
	stores: null,
	viewerId: null,
	ensureStores: noStores,
	ownsStore: noOwnership,
	abandonViewer: noAbandon,
};

const LocalDataScopeContext = createContext<LocalDataScope>(
	UNAVAILABLE_LOCAL_DATA_SCOPE,
);

/**
 * Mounted once at the app shell, and it only publishes. Activation order and account isolation live
 * in activation.ts. Per-component activation would scatter the same decision across the app, and a
 * component that does not wait for the viewer could open another account's database.
 */
export function LocalDataScopeProvider({ children }: { children: ReactNode }) {
	/**
	 * The identity source is `/me`, not the Better Auth session hook. Authorization and local data
	 * ownership both use the RowCat member id, and the auth account id never enters product code.
	 * Partitioning databases by the auth account id would make switching login methods lose
	 * conversations and manuscripts.
	 */
	const viewer = useQuery(viewerQueryOptions(getRowCatClient())).data ?? null;
	const viewerId = viewer?.id ?? null;

	/**
	 * Holds the open stores together with their owner. Holding only the stores would leave one render
	 * after an account change showing the previous member's stores. Keeping the owner alongside lets
	 * the render filter it out, without depending on the order of state updates.
	 */
	const [opened, setOpened] = useState<{
		viewerId: string;
		stores: LocalDataStores;
	} | null>(null);

	/**
	 * The same value, held outside render. Ownership is asked by in-flight async work between awaits,
	 * not by render, so it needs the currently open store immediately. Case: the user presses `Start conversation`
	 * on the first screen before the activation effect runs. Acquisition can finish before the state
	 * commits, and comparing against state would treat the store just opened as not mine.
	 *
	 * onOpen sets the state and this ref at the same moment. They diverge only on logout, and the
	 * effect below clears both.
	 */
	const openedRef = useRef<{
		viewerId: string;
		stores: LocalDataStores;
	} | null>(null);

	/**
	 * The activation owner outlives the component. Recreating it every render would discard
	 * in-progress activation each time and reopen the same member's database repeatedly.
	 */
	const [activation] = useState<LocalDataActivation>(() =>
		createLocalDataActivation({
			onOpen: (id, stores) => {
				openedRef.current = { viewerId: id, stores };
				setOpened({ viewerId: id, stores });
			},
		}),
	);

	useEffect(() => {
		/**
		 * If the session drops to guest, release the open connection. Data is not deleted: logout closes
		 * access, it does not abandon ownership. Logging in again as the same account reopens the
		 * same-named database.
		 */
		if (!viewerId) {
			/*
			 * The ref is cleared first, and this ordering is the crux of the Alice → logout → Alice path. If
			 * it were not cleared, logging in again would restore the same member id, and work started
			 * before the logout would pass as if it belonged to the new scope. The reopened connection is a
			 * new instance, and nobody should hold a reference to the old one.
			 */
			openedRef.current = null;
			setOpened(null);
			activation.release();
			return;
		}

		/**
		 * The effect may start activation or adopt one already in progress. If the user pressed `Start conversation`
		 * before the effect ran, that press is already opening the same member's database. The same
		 * promise comes back, so the database opens only once.
		 *
		 * The result is intentionally not awaited. When the database opens, onOpen updates the state.
		 */
		void activation.ensure(viewerId);
	}, [viewerId, activation]);

	const ensureStores =
		useCallback(async (): Promise<LocalDataStores | null> => {
			// A guest has no database to open. Starting activation here would create data with no owner.
			if (!viewerId) return null;
			const stores = await activation.ensure(viewerId);
			/**
			 * The account may have changed while waiting. Then this store belongs to someone else, so it is
			 * not returned. The caller creates rooms or drafts with it, and that cannot be undone.
			 */
			if (!stores || activation.owner() !== viewerId) return null;
			return stores;
		}, [viewerId, activation]);

	/**
	 * Identity must stay fixed. The caller holds a click-time closure. If the function were recreated
	 * each render, the closure would keep a function that remembers the scope of that moment, so "is
	 * this still mine?" would become "was it mine then?" and block nothing. Everything it reads is
	 * outside render (the ref and activation), so activation is the only dependency.
	 */
	const ownsStore = useCallback(
		<K extends LocalDataDomain>(
			domain: K,
			expected: LocalDataStores[K],
		): boolean => {
			const current = openedRef.current;
			if (!current) return false;
			/*
			 * Both axes are checked. The instance must match, since a closed and reopened connection is
			 * different. The owner must be the member the activation currently intends. The owner is read
			 * from activation rather than state, because during an account switch the next member's owner()
			 * changes at once, while the previous member's store stays open until the next one opens.
			 *
			 * One window cannot be removed. Between the commit that changed the viewer and its effect, both
			 * values still belong to the previous member. That gap is one microtask. Operations that matter
			 * (startStoryChat, publishDraft) wait again before each irreversible step, so the second check
			 * catches it. Closing the gap entirely would mean judging against the viewer cache directly,
			 * which would tie local scope ownership to the query layer.
			 */
			return (
				current.stores[domain] === expected &&
				current.viewerId === activation.owner()
			);
		},
		[activation],
	);

	/**
	 * Identity must stay fixed for the same reason as ownsStore. The deletion flow holds the
	 * click-time closure and calls this after the server round trip finishes.
	 */
	const abandonViewer = useCallback(
		(id: string): void => {
			/*
			 * Clear the out-of-render copy first. ownsStore reads this value, and state updates wait for
			 * commit, while a server round trip really can finish in between.
			 */
			openedRef.current = null;
			setOpened(null);
			activation.abandon(id);
		},
		[activation],
	);

	const scope = useMemo<LocalDataScope>(() => {
		if (!viewerId) return UNAVAILABLE_LOCAL_DATA_SCOPE;
		/**
		 * Ignore the stored instance if it belongs to a different viewer. Otherwise a render right after
		 * an account change would show the previous member's rooms and drafts.
		 */
		const stores = opened?.viewerId === viewerId ? opened.stores : null;
		return {
			status: stores ? "ready" : "activating",
			stores,
			viewerId,
			ensureStores,
			ownsStore,
			abandonViewer,
		};
	}, [viewerId, opened, ensureStores, ownsStore, abandonViewer]);

	return (
		<LocalDataScopeContext value={scope}>{children}</LocalDataScopeContext>
	);
}

/**
 * The raw scope that domain adapters use. Screens should rarely call it directly. Chat screens use
 * useChatScope() and authoring screens use useAuthoringScope(), and those narrow interfaces are the
 * boundary of what a screen may touch. Passing everything would let a chat component eventually
 * delete a draft.
 */
export const useLocalDataScope = (): LocalDataScope =>
	useContext(LocalDataScopeContext);
