import type { AuthoringStore, DraftRecoveryStore } from "@rowcat/authoring";
import type { ChatStore, GenerationPreferenceStore } from "@rowcat/chat";
import type {
	RuntimeConversationStore,
	RuntimeSaveStore,
} from "@rowcat/runtime-persistence";
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
import { expoDraftCoverFiles } from "../draft-cover-files.ts";
import type {
	ProviderConnectionStore,
	ProviderCredentialAccess,
} from "../local-provider/store.ts";
import { expoSecureKeyStorage } from "../local-sync/secure-store.ts";
import {
	createLocalScopeController,
	type MobileLocalScope,
	type MobileLocalScopeStatus,
	openScopeWith,
	type ScopeOpener,
} from "./activation.ts";
import type { DraftCoverStore } from "./draft-cover-store.ts";
import { openExpoSqliteDriver } from "./expo-driver.ts";
import type { LocalMutationSignal } from "./mutation-signal.ts";

/**
 * React wiring for the local scope. No rules live here: activation and release are all in
 * `activation.ts`, and this file only attaches that controller to the render tree. The split keeps
 * the rules checkable without rendering, which would require a simulator.
 *
 * The controller is owned by one root. Per-screen controllers would open one connection per screen
 * on login and leave no way to say which one owns writes.
 *
 * Create during render, open and close in effects. Closing in an effect cleanup something created
 * during render lets StrictMode's double mount permanently close a live connection (the web hit
 * this with `AbortController`).
 *
 * `viewerId` arrives as a prop. This provider does not decide who is signed in; that answer comes
 * from `/v2/me` (`lib/session-state.ts`), and what arrives here is only the member id derived from
 * it. Passing the auth account id here would bind this file to the auth implementation's
 * identifier.
 */
export type { MobileLocalScopeStatus };

export interface MobileLocalScopeValue {
	status: MobileLocalScopeStatus;
	viewerId: string | null;
	scope: MobileLocalScope | null;
	error: Error | null;
	/**
	 * Retries opening. The only way out of `error`: signing out would not help, because the cause
	 * (disk, permissions, lock) has nothing to do with the member. The member does not change, so the
	 * controller simply reopens the same scope.
	 */
	retry: () => void;
	/**
	 * Waits until this member's scope is open; `null` for guests.
	 *
	 * Differs from reading `scope` directly. That reads what the render saw, which is still `null`
	 * while `opening`. Users do press `Start conversation` on the first screen, and then the button would fail with
	 * "no store" and the user would have to press again. Does not start a new open: the controller
	 * serializes activation per member (`activation.ts`), so an open the effect already started is
	 * joined.
	 */
	ensureScope: () => Promise<MobileLocalScope | null>;
	/**
	 * Whether this scope is **still** the open one, checked right before an irreversible step.
	 *
	 * Not judged by member id alone. In `Alice → sign out → Alice` the id is the same, but the
	 * connection was closed and reopened in between, and writes aimed at the old instance go to a
	 * closed connection.
	 */
	ownsScope: (candidate: MobileLocalScope) => boolean;
	/**
	 * Drops the scope of a member whose deletion has been confirmed. Called only after the server
	 * deletion succeeds. Ownership is revoked synchronously, so `ownsScope` and `ensureScope` close
	 * for that member, and reactivating the same member is refused for the provider's lifetime. A late
	 * callback during physical deletion therefore cannot resurrect the deleted database. The rule
	 * lives in the controller (`abandon` in `activation.ts`).
	 */
	abandonViewer: (viewerId: string) => Promise<void>;
	/**
	 * Erases this device's local data and opens a fresh scope for the same member. Called by the reset
	 * in settings.
	 *
	 * Same target as `abandonViewer` with the opposite meaning. There the account is gone, so
	 * reactivation is refused permanently; here the account lives on, so an empty database must open
	 * right after erasure, or the user is locked out of their own account.
	 *
	 * The actual erase is passed in. It must run inside the controller's serial queue so a late
	 * activation cannot resurrect the file being erased (`resetViewer` in `activation.ts`). This
	 * wiring adds only the reactivation afterwards.
	 */
	resetViewerData: (
		viewerId: string,
		erase: () => Promise<void>,
	) => Promise<void>;
}

const noopRetry = () => {};
const noScope = async (): Promise<MobileLocalScope | null> => null;
const noOwnership = (): boolean => false;
/** Guests have no scope to drop; the post-deletion cleanup retry takes this branch. */
const noAbandon = async (): Promise<void> => {};
/** Guests have no local data to erase; the reset section is not drawn at all. */
const noReset = async (): Promise<void> => {};

const IDLE: MobileLocalScopeValue = {
	status: "idle",
	viewerId: null,
	scope: null,
	error: null,
	retry: noopRetry,
	ensureScope: noScope,
	ownsScope: noOwnership,
	abandonViewer: noAbandon,
	resetViewerData: noReset,
};

const LocalScopeContext = createContext<MobileLocalScopeValue>(IDLE);

/** The device's default assembly: the SQLite file and the Keychain. */
const defaultOpener: ScopeOpener = openScopeWith(
	openExpoSqliteDriver,
	expoSecureKeyStorage,
	expoDraftCoverFiles,
);

export function MobileLocalDataProvider({
	viewerId,
	opener = defaultOpener,
	children,
}: {
	viewerId: string | null;
	/** Where tests and the dev harness plug in a different assembly. Product code uses the default. */
	opener?: ScopeOpener;
	children: ReactNode;
}) {
	const controller = useMemo(
		() => createLocalScopeController(opener),
		[opener],
	);
	const [value, setValue] = useState<MobileLocalScopeValue>(IDLE);
	/** Retry generation. Changing the value re-runs the effect below; the member stays the same. */
	const [attempt, setAttempt] = useState(0);
	const retry = useCallback(() => setAttempt((n) => n + 1), []);

	/**
	 * Out-of-render copy of the member that should be open now.
	 *
	 * `ensureScope` reads this value. If it closed over the prop, the function would remember the
	 * member it was created with, and a button pressed after an account switch would reopen the
	 * previous member's file. The effect below syncs this on its first line. A short window between
	 * commit and effect remains, but the check before an irreversible step (`ownsScope`) covers it.
	 */
	const wantedRef = useRef<string | null>(viewerId);

	/**
	 * Must be a stable function. Whoever captures it holds the closure from press time, and recreating
	 * it every render would make that closure keep "the scope at that time", so "is it still mine"
	 * would become "was it mine then".
	 */
	const ensureScope =
		useCallback(async (): Promise<MobileLocalScope | null> => {
			const wanted = wantedRef.current;
			// Guests have nothing to open. Opening here would create unowned data.
			if (!wanted) return null;
			const opened = await controller.activate(wanted).catch(() => null);
			if (!opened) return null;
			/**
			 * The account may have changed while waiting. Then this scope now belongs to someone else, so it
			 * is not returned: the caller creates rooms with it, which cannot be undone.
			 */
			return controller.current() === opened ? opened : null;
		}, [controller]);

	const ownsScope = useCallback(
		(candidate: MobileLocalScope): boolean =>
			controller.current() === candidate,
		[controller],
	);

	/**
	 * Must be a stable function (same reason as `ensureScope`). The caller is the account-deletion
	 * flow's closure, and that flow runs to completion regardless of render.
	 */
	const abandonViewer = useCallback(
		(viewerId: string): Promise<void> => controller.abandon(viewerId),
		[controller],
	);

	/**
	 * Reopens the same member's scope after erasing.
	 *
	 * Calling `retry()` is that reactivation. The member prop does not change, so the effect below
	 * does not re-run on its own. Without this line the screen would stay in `error` (or a closed
	 * scope) forever after erasing, and the user would have to relaunch the app to recover their
	 * account.
	 *
	 * Reopens even when the erase fails. What remains then is undeleted data, and keeping the scope
	 * closed on top would cost the user access without losing anything.
	 */
	const resetViewerData = useCallback(
		async (viewerId: string, erase: () => Promise<void>): Promise<void> => {
			try {
				await controller.resetViewer(viewerId, erase);
			} finally {
				retry();
			}
		},
		[controller, retry],
	);

	/**
	 * `attempt` is a dependency meant to go unread. Its change alone is the signal that re-runs this
	 * effect (the member is unchanged), and it is the only way out of `error`. Static analysis sees
	 * that the body never reads it and reports it as unneeded.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry generation.
	useEffect(() => {
		wantedRef.current = viewerId;
		if (!viewerId) {
			/**
			 * Dropping to guest still keeps `abandonViewer` on the controller, because cleanup retries after
			 * account deletion run in this state (the cache reset clears the viewer first).
			 */
			setValue({ ...IDLE, abandonViewer, resetViewerData });
			void controller.release();
			return;
		}
		let alive = true;
		setValue({
			status: "opening",
			viewerId,
			scope: null,
			error: null,
			retry,
			ensureScope,
			ownsScope,
			abandonViewer,
			resetViewerData,
		});
		controller
			.activate(viewerId)
			.then((scope) => {
				if (alive)
					setValue({
						status: "ready",
						viewerId,
						scope,
						error: null,
						retry,
						ensureScope,
						ownsScope,
						abandonViewer,
						resetViewerData,
					});
			})
			.catch((error: unknown) => {
				if (alive)
					setValue({
						status: "error",
						viewerId,
						scope: null,
						error: error instanceof Error ? error : new Error(String(error)),
						retry,
						ensureScope,
						ownsScope,
						abandonViewer,
						resetViewerData,
					});
			});
		return () => {
			alive = false;
		};
	}, [
		controller,
		viewerId,
		retry,
		attempt,
		ensureScope,
		ownsScope,
		abandonViewer,
		resetViewerData,
	]);

	/**
	 * Closes the connection when the controller goes away. Member changes are already handled by the
	 * effect above (the controller closes the previous one internally), so only unmount matters here.
	 */
	useEffect(() => () => void controller.release(), [controller]);

	return (
		<LocalScopeContext.Provider value={value}>
			{children}
		</LocalScopeContext.Provider>
	);
}

export const useMobileLocalScope = (): MobileLocalScopeValue =>
	useContext(LocalScopeContext);

/**
 * The window chat sees: one store and its ownership check.
 *
 * Same role and narrowness as the web's `useChatScope()`. Passing the whole scope to the chat
 * screen would eventually let that component delete drafts or write SQL, and then transaction
 * boundaries would belong to the screen. Only sync sees the whole scope, because `applyPull` must
 * write every domain inside one transaction.
 *
 * `ensureStore` and `ownsStore` come together because of the order of `Start conversation`. That action performs
 * two irreversible steps (room creation, navigation) with waits in between, so "is it still mine"
 * must be asked again at each point (`features/story/start-story-chat.ts`).
 */
export interface MobileChatScope {
	/** The store open right now; `null` while opening or for guests. */
	store: ChatStore | null;
	viewerId: string | null;
	ensureStore: () => Promise<ChatStore | null>;
	ownsStore: (store: ChatStore) => boolean;
}

export function useChatScope(): MobileChatScope {
	const { scope, viewerId, ensureScope, ownsScope } = useMobileLocalScope();
	return useMemo(
		() => ({
			store: scope?.stores.chat ?? null,
			viewerId,
			ensureStore: async () => (await ensureScope())?.stores.chat ?? null,
			/**
			 * Compares the **scope**, not the store. When a member's scope reopens, the store inside is a
			 * new instance too, so the two checks agree. This one looks only at the controller, so it does
			 * not depend on the order in which render state updates.
			 */
			ownsStore: (candidate: ChatStore) =>
				scope !== null && scope.stores.chat === candidate && ownsScope(scope),
		}),
		[scope, viewerId, ensureScope, ownsScope],
	);
}

/**
 * The local write signal: the axis screen subscriptions read.
 *
 * The signal is one per scope. So switching accounts ends the previous member's subscriptions
 * naturally, and new subscriptions read the new store.
 */
export const useLocalMutations = (): LocalMutationSignal | null =>
	useMobileLocalScope().scope?.stores.mutations ?? null;

/**
 * The window authoring sees: one store and its ownership check.
 *
 * Same role and narrowness as the web's `useAuthoringScope()`. Passing the whole scope to the
 * editor would eventually let that component delete rooms or write SQL, and then transaction
 * boundaries would belong to the screen.
 *
 * `ensureStore` and `ownsStore` come together for the order of irreversible operations. Draft
 * creation navigates after creating; publication does a server write, then a local write, then
 * navigation; autosave wakes after a debounce. Each has a wait between "received the store" and
 * "writing with it". If the account changes in between, the store in the closure belongs to someone
 * else or is a closed connection (`features/create/publish-draft.ts`).
 */
export interface MobileAuthoringScope {
	/** The store open right now; `null` while opening or for guests. */
	store: AuthoringStore | null;
	viewerId: string | null;
	/** Waits until the store opens. `null` for guests. */
	ensureStore: () => Promise<AuthoringStore | null>;
	/** Whether this store belongs to the active scope **right now**. Compares the instance, not the member id. */
	ownsStore: (store: AuthoringStore) => boolean;
}

export function useAuthoringScope(): MobileAuthoringScope {
	const { scope, viewerId, ensureScope, ownsScope } = useMobileLocalScope();
	return useMemo(
		() => ({
			store: scope?.stores.authoring ?? null,
			viewerId,
			ensureStore: async () => (await ensureScope())?.stores.authoring ?? null,
			/**
			 * Compares the **scope**, not the store (same reason as `useChatScope`). When a member's scope
			 * reopens, the store inside is also a new instance, so both checks give the same answer. This
			 * one looks only at the controller, so it does not depend on the order of render-state updates.
			 */
			ownsStore: (candidate: AuthoringStore) =>
				scope !== null &&
				scope.stores.authoring === candidate &&
				ownsScope(scope),
		}),
		[scope, viewerId, ensureScope, ownsScope],
	);
}

/**
 * The window the recovery copy sees: one store and its value-change signal.
 *
 * The signal is `recoveries`, not `mutations`, and that is the point of this window (`stores.ts`).
 * Discarding a copy is not an event that should wake sync. Putting it on the mutation signal would
 * trigger a sync run each time the notice is dismissed.
 */
export interface MobileDraftRecoveryScope {
	store: DraftRecoveryStore | null;
	signal: LocalMutationSignal | null;
	ensureStore: () => Promise<DraftRecoveryStore | null>;
}

export function useDraftRecoveryScope(): MobileDraftRecoveryScope {
	const { scope, ensureScope } = useMobileLocalScope();
	return useMemo(
		() => ({
			store: scope?.stores.draftRecovery ?? null,
			signal: scope?.stores.recoveries ?? null,
			ensureStore: async () =>
				(await ensureScope())?.stores.draftRecovery ?? null,
		}),
		[scope, ensureScope],
	);
}

/**
 * The window generation preferences see: one store and its value-change signal.
 *
 * Same role and narrowness as the web's `useGenerationScope()`. The settings screen has no reason
 * to hold a `ChatStore`, and anything it holds will eventually be used.
 *
 * The signal is `preferences`, not `mutations`, and that is the point of this window (`stores.ts`).
 * Exporting both from one hook invites someone to pick the convenient one, and the mistake would
 * show up as a sync run going out for every settings change.
 */
export interface MobileGenerationScope {
	/** The preference store open right now; `null` while opening or for guests. */
	store: GenerationPreferenceStore | null;
	/** Change signal for this value. A **different instance** from the one that wakes sync. */
	signal: LocalMutationSignal | null;
	/** Whether the scope is still opening. Not the same as "unset"; the screen draws a placeholder. */
	loading: boolean;
}

export function useGenerationScope(): MobileGenerationScope {
	const { scope, status } = useMobileLocalScope();
	return useMemo(
		() => ({
			store: scope?.stores.generation ?? null,
			signal: scope?.stores.preferences ?? null,
			/**
			 * A guest (`idle`) is not loading: there is no store to open. Folding that into loading would
			 * leave the settings screen on its placeholder forever.
			 */
			loading: status === "opening",
		}),
		[scope, status],
	);
}

/**
 * The window the draft cover sees: one store and its change signal.
 *
 * Narrow for the same reason as above. The places that use this value (the cover field, preview,
 * and publication) have no reason to hold a `ChatStore` or the authoring store.
 *
 * `ownsStore` comes along because of publication. Uploading the cover goes through a server round
 * trip, during which the account can change, and then the previous account's cover would be
 * uploaded to the current account's work. It is the same axis as the authoring store's ownership
 * check.
 */
export interface MobileDraftCoverScope {
	/** The cover store open right now; `null` while opening or for guests. */
	store: DraftCoverStore | null;
	/** Change signal for this value. A **different instance** from the one that wakes sync. */
	signal: LocalMutationSignal | null;
	/** Whether the scope is still opening. Not the same as "no cover". */
	loading: boolean;
	/** Whether this store is still the current scope's; asked again right before an irreversible step. */
	ownsStore: (store: DraftCoverStore) => boolean;
}

export function useDraftCoverScope(): MobileDraftCoverScope {
	const { scope, status } = useMobileLocalScope();
	return useMemo(
		() => ({
			store: scope?.stores.draftCover ?? null,
			signal: scope?.stores.draftCovers ?? null,
			loading: status === "opening",
			/**
			 * Compares the **instance**, not the member id. In `Alice → sign out → Alice` the id is the
			 * same, but the connection was closed and reopened, and writes aimed at the old instance go to a
			 * closed connection.
			 */
			ownsStore: (store: DraftCoverStore) => scope?.stores.draftCover === store,
		}),
		[scope, status],
	);
}

/**
 * The window provider connections see: one summary store and its change signal.
 *
 * Same role and narrowness as the web's `useProviderScope()`. The settings screen has no reason to
 * hold a `ChatStore` or an open connection, and anything it holds will eventually be used.
 *
 * **The port that opens credentials is not here.** It lives in the separate hook below, and that
 * separation is the whole security boundary of this slice. The settings screen uses only this side
 * (a static scan enforces it).
 *
 * `ownsStore` comes along for the order of connection operations. They save **after** asking the
 * provider, so the account can change in between. Saving then would turn Alice's key into Bob's
 * Keychain entry (`features/settings/connect-provider.ts`).
 */
export interface MobileProviderScope {
	/** The summary store open right now; `null` while opening or for guests. */
	store: ProviderConnectionStore | null;
	viewerId: string | null;
	/** Change signal for this value. A **different instance** from the one that wakes sync. */
	signal: LocalMutationSignal | null;
	/** Whether the scope is still opening. Not the same as "no connections"; the screen draws a placeholder. */
	loading: boolean;
	/**
	 * Whether this store belongs to the active scope **right now**. Compares the instance, not the
	 * member id.
	 *
	 * In `Alice → sign out → Alice` the id is the same, but the scope was closed and reopened in
	 * between, so writes aimed at the old instance do not belong to this session.
	 */
	ownsStore: (store: ProviderConnectionStore) => boolean;
}

/**
 * The window the playback screen sees: one player save.
 *
 * Same role and narrowness as the web's `useRuntimeSaveScope()`. The screen that runs creator code
 * has no reason to hold the chat store or the authoring store, and anything it holds will
 * eventually be used.
 */
export interface MobileRuntimeSaveScope {
	/** The store open right now; `null` while opening or for guests. */
	store: RuntimeSaveStore | null;
	viewerId: string | null;
	/** Whether the scope is still opening. Distinct from a guest. */
	loading: boolean;
}

export function useRuntimeSaveScope(): MobileRuntimeSaveScope {
	const { scope, viewerId, status } = useMobileLocalScope();
	return useMemo(
		() => ({
			store: scope?.stores.runtimeSave ?? null,
			viewerId,
			/** A guest (`idle`) is not loading: there is no store to open. */
			loading: status === "opening",
		}),
		[scope, viewerId, status],
	);
}

/**
 * The window that sees runtime library rows: a **different window** from the save scope.
 *
 * The places that add and remove library rows (the first confirmation on the playback screen, and
 * `Remove from list` in the list) have no reason to hold the player save port, and anything they hold will
 * eventually be used. That is when library operations would reach progress. `ownsScope` is there
 * because writes are asynchronous: a response that arrives after the account changed must not write
 * a row into the previous person's database.
 */
export interface MobileRuntimeConversationScope {
	store: RuntimeConversationStore | null;
	viewerId: string | null;
	loading: boolean;
	/** Whether this store belongs to the active scope **right now**. */
	ownsStore: (store: RuntimeConversationStore) => boolean;
}

export function useRuntimeConversationScope(): MobileRuntimeConversationScope {
	const { scope, viewerId, status, ownsScope } = useMobileLocalScope();
	return useMemo(
		() => ({
			store: scope?.stores.runtimeConversation ?? null,
			viewerId,
			loading: status === "opening",
			ownsStore: (store) =>
				scope !== null &&
				ownsScope(scope) &&
				scope.stores.runtimeConversation === store,
		}),
		[scope, viewerId, status, ownsScope],
	);
}

export function useProviderScope(): MobileProviderScope {
	const { scope, viewerId, status, ownsScope } = useMobileLocalScope();
	return useMemo(
		() => ({
			store: scope?.stores.providers ?? null,
			viewerId,
			signal: scope?.stores.providerConnections ?? null,
			/** A guest (`idle`) is not loading: there is no store to open. */
			loading: status === "opening",
			ownsStore: (candidate: ProviderConnectionStore) =>
				scope !== null &&
				scope.stores.providers === candidate &&
				ownsScope(scope),
		}),
		[scope, viewerId, status, ownsScope],
	);
}

/**
 * **Runtime only.** The port that opens credentials when generation starts.
 *
 * The long name and the warning in this header are the only linguistic defence for this hook; the
 * type system cannot restrict where it is called. The rule is one line:
 *
 * > Do not call this hook from `features/settings/**`, `features/account/**`,
 * `features/persona/**`, > `features/create/**`, or `features/profile/**`.
 *
 * It is currently called only from the chat generation hook and the automatic maintenance wiring,
 * and neither sees plaintext. The port is passed to the transport router as-is, so the secret is
 * opened only when an adapter is invoked, and its lifetime ends within that call.
 *
 * If calls to this hook begin to multiply, the boundary is breaking. A static scan locks the list
 * by value (`features/settings/provider-boundaries.test.ts`).
 */
export interface MobileProviderCredentialScope {
	store: ProviderCredentialAccess | null;
}

export const useProviderCredentialScope =
	(): MobileProviderCredentialScope => ({
		store: useMobileLocalScope().scope?.stores.providerCredentials ?? null,
	});
