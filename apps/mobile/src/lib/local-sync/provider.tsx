import type { SyncSnapshot } from "@rowcat/sync";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from "react";
import { getRowCatClient } from "../api.ts";
import { useMobileLocalScope } from "../local-data/scope.tsx";
import type { AutoSyncSnapshot } from "./auto-sync.ts";
import { appStateLifecycleSource, expoNetworkSource } from "./expo-signals.ts";
import { createMobileSyncRuntime, type MobileSyncRuntime } from "./runtime.ts";
import { createSyncTransport } from "./transport.ts";

/**
 * React lifecycle of the sync runtime. Counterpart of the web's `local-sync/provider.tsx`.
 *
 * Placed once at the root (`app/_layout.tsx`, **below** the per-member local scope). If each screen
 * built its own, the account screen and the conversation screen would each request an initial sync
 * at login, multiplying round trips, and which one wins would depend on mount order. `SyncSection`
 * only **reads** this runtime; it does not create a controller.
 *
 * **Creation in render (useMemo), start and stop in an effect.** Stopping something created in
 * render from an effect's cleanup lets StrictMode's double mount permanently stop a live instance.
 * So `start()` is idempotent, and after `stop()` the same instance is never revived (the next scope
 * builds a new runtime). This is the opposite side of the wiring from the web's real incident with
 * `AbortController`.
 *
 * ## The owner is the scope chosen by `Viewer.id`
 *
 * This file does not judge identity. It takes the one `MobileLocalScope` that the scope provider
 * opened and binds the runtime to that instance. When the account changes, the scope instance
 * changes; the memo above builds a new runtime, and the effect cleanup stops the old one. A late
 * async operation falls outside the `ownsScope` check (a re-login with the same member id string
 * still yields a different instance).
 *
 * ## No remote wake-up — an intentional gap
 *
 * The web hears remote changes early over an SSE stream. Carrying the browser's lifetime model over
 * to Expo (keep the connection while the tab is visible) would mean holding connections in the
 * background or building push infrastructure, and neither was a decision this slice asked for. This
 * app's convergence is handled by startup, local writes, foreground return, network return and
 * manual sync. Native remote wake-up (push etc.) comes in its own slice, and the one line to change
 * then is `requestSync("remote-wake")`.
 *
 * ## State is not put in the context
 *
 * The context carries only the instance. Putting the phase (`syncing`, `backoff`) in it would
 * re-render the whole app on every background sync. Subscription is done by `useSyncExternalStore`,
 * and only subscribing components (the two lines of account → data) re-render.
 */

const SyncRuntimeContext = createContext<MobileSyncRuntime | null>(null);

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

export function MobileSyncRuntimeProvider({
	children,
}: {
	children: ReactNode;
}) {
	const { scope, ownsScope } = useMobileLocalScope();

	const runtime = useMemo<MobileSyncRuntime | null>(() => {
		if (!scope) return null;
		return createMobileSyncRuntime({
			scope,
			ownsScope,
			transport: createSyncTransport(getRowCatClient()),
			lifecycle: appStateLifecycleSource,
			network: expoNetworkSource,
		});
	}, [scope, ownsScope]);

	useEffect(() => {
		if (!runtime) return;
		runtime.autoSync.start();
		/**
		 * The cleanup is final. On account switch, sign-out or deletion the old instance stops here and
		 * does not come back. The new scope gets a new runtime from the memo above.
		 */
		return () => {
			runtime.autoSync.stop();
		};
	}, [runtime]);

	return (
		<SyncRuntimeContext.Provider value={runtime}>
			{children}
		</SyncRuntimeContext.Provider>
	);
}

/** Null if the scope has not opened (guest, or still opening). */
export const useMobileSyncRuntime = (): MobileSyncRuntime | null =>
	useContext(SyncRuntimeContext);

/** Lock state of the controller. Only subscribing components re-render. */
export function useMobileSyncSnapshot(): SyncSnapshot {
	const runtime = useMobileSyncRuntime();
	return useSyncExternalStore(
		(listener) => runtime?.controller.subscribe(listener) ?? (() => {}),
		() => runtime?.controller.snapshot() ?? IDLE_SYNC,
		() => IDLE_SYNC,
	);
}

/** Automatic sync phase and this device's toggle. */
export function useMobileAutoSyncSnapshot(): AutoSyncSnapshot {
	const runtime = useMobileSyncRuntime();
	return useSyncExternalStore(
		(listener) => runtime?.autoSync.subscribe(listener) ?? (() => {}),
		() => runtime?.autoSync.snapshot() ?? IDLE_AUTO,
		() => IDLE_AUTO,
	);
}
