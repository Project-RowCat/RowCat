import type { SyncController, SyncSnapshot } from "@rowcat/sync";
import { createSyncController } from "@rowcat/sync";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from "react";
import { getRowCatClient } from "#/lib/api.ts";
import { nowIso } from "#/lib/local-data/clock.ts";
import { useLocalDataScope } from "#/lib/local-data/scope.tsx";
import { createSubtleAead } from "./aead.ts";
import {
	type AutoSyncSnapshot,
	createWebAutoSync,
	type WebAutoSync,
} from "./auto-sync.ts";
import { syncCodecRegistry } from "./registry.ts";
import { createSyncTransport, createSyncWakeStream } from "./transport.ts";
import { createWebSyncWake, type WebSyncWake } from "./wake.ts";

/**
 * Lifetime of the sync runtime: one controller, one auto-sync, and one wake stream per scope,
 * mounted once at the root. Per-screen instances would each request a start-up sync, so one login
 * would send about five round trips, and which one won would depend on mount order.
 *
 * No module singleton. The runtime is rebuilt whole when the LocalDataStores instance changes, and
 * discarding the old controller is what locks it. A legacy web build created its controller at
 * module load, and sync died after logout and re-login.
 *
 * Abort signals are deliberately not passed. The port's signal slot is left empty. An
 * AbortController created in render and aborted in the effect cleanup gets cut by StrictMode's
 * double mount (the cleanup runs, but the memo is not recomputed). Every later request then aborts
 * at once, and the screen shows only `Sync failed`. Cancellation was only ever an optimization.
 * Correctness belongs to ownsStore, which the engine checks before each local write and the
 * coordinator checks around each run. A response that arrives after logout is discarded and written
 * nowhere.
 *
 * The auto-sync instance starts in an effect, not in render. Creation is pure (no timers or
 * listeners), so start → stop → start is safe.
 *
 * The context carries only the instance, which changes only when the scope changes. Putting the
 * phase (syncing, backoff) into the context would re-render the whole app on every background run.
 * Subscribers use useSyncExternalStore instead, so only the components that read it re-render.
 */

interface SyncRuntime {
	controller: SyncController;
	autoSync: WebAutoSync;
	/**
	 * One wake stream per runtime, not per screen, for the same reason as auto-sync. Per-screen
	 * streams would open one SSE connection per screen on every login, and the server's subscriber
	 * ledger would grow by that much. The context still carries only the instance, so connection-state
	 * changes do not re-render the app.
	 */
	wake: WebSyncWake;
	viewerId: string;
}

const SyncRuntimeContext = createContext<SyncRuntime | null>(null);

const IDLE_SYNC: SyncSnapshot = {
	state: "idle",
	trusted: false,
	initialSyncDone: false,
	lastSyncedAt: null,
	lastError: null,
};

const IDLE_AUTO: AutoSyncSnapshot = {
	phase: "idle",
	lastSuccessAt: null,
	errorCategory: null,
	reason: null,
	enabled: true,
};

export function SyncRuntimeProvider({ children }: { children: ReactNode }) {
	const scope = useLocalDataScope();
	const { stores, viewerId, ownsStore } = scope;

	const runtime = useMemo<SyncRuntime | null>(() => {
		if (!stores || !viewerId) return null;
		const store = stores.sync;
		const controller = createSyncController({
			owner: viewerId,
			registry: syncCodecRegistry,
			store,
			transport: createSyncTransport(getRowCatClient()),
			/**
			 * Browser-accelerated AEAD path. It uses the same byte format as noble, so the two can decrypt
			 * each other's output.
			 */
			aead: createSubtleAead(),
			deviceKey: stores.deviceKey,
			clock: { nowIso, nowMs: () => Date.now() },
			/**
			 * Asked again before every local write. Alice → logout → Alice keeps the same member id while a
			 * new connection opens, so an id comparison alone would let an old job through.
			 */
			ownsStore: () => ownsStore("sync", store),
		});
		const autoSync = createWebAutoSync({
			controller,
			viewerId,
			mutations: stores.mutations,
			preference: stores.autoSyncPreference,
			ownsStore: () => ownsStore("sync", store),
		});
		return {
			controller,
			viewerId,
			autoSync,
			wake: createWebSyncWake({
				controller,
				autoSync,
				open: createSyncWakeStream(getRowCatClient()),
				/**
				 * Read-only. The cursor from SSE is not written back here. Only pull plus the applyPull
				 * transaction may move the local cursor. Breaking that rule would skip records that were never
				 * downloaded, permanently.
				 */
				readLocalCursor: async () => (await store.readState()).cursor,
				ownsStore: () => ownsStore("sync", store),
			}),
		};
	}, [stores, viewerId, ownsStore]);

	useEffect(() => {
		if (!runtime) return;
		runtime.autoSync.start();
		/**
		 * The wake starts after auto-sync. Order is not the reason, since both do nothing until
		 * conditions are met. The order shows the dependency direction to readers: wake hands work to the
		 * coordinator, never the reverse.
		 */
		runtime.wake.start();
		/**
		 * Cleanup is final. On account switch, logout, or account deletion, the old instance stops here
		 * and never revives. The new scope gets a new runtime from the useMemo above. The stream is
		 * stopped first: if a wake arrives after the coordinator has stopped, the request has nowhere to
		 * go.
		 */
		return () => {
			runtime.wake.stop();
			runtime.autoSync.stop();
		};
	}, [runtime]);

	return <SyncRuntimeContext value={runtime}>{children}</SyncRuntimeContext>;
}

/** Null when no scope is open (a guest, or while activating). */
export const useSyncRuntime = (): SyncRuntime | null =>
	useContext(SyncRuntimeContext);

/** The controller's lock state. Only components that subscribe to it re-render. */
export function useSyncSnapshot(): SyncSnapshot {
	const runtime = useSyncRuntime();
	return useSyncExternalStore(
		(listener) => runtime?.controller.subscribe(listener) ?? (() => {}),
		() => runtime?.controller.snapshot() ?? IDLE_SYNC,
		() => IDLE_SYNC,
	);
}

export function useAutoSyncSnapshot(): AutoSyncSnapshot {
	const runtime = useSyncRuntime();
	return useSyncExternalStore(
		(listener) => runtime?.autoSync.subscribe(listener) ?? (() => {}),
		() => runtime?.autoSync.snapshot() ?? IDLE_AUTO,
		() => IDLE_AUTO,
	);
}
