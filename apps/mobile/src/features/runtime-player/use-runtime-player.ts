import type { StoryPlaybackDto } from "@rowcat/contracts";
import { storyPlaybackQueryOptions } from "@rowcat/query";
import {
	createRuntimePlayerLifecycle,
	createRuntimePlayerPersistence,
	type RuntimePlayerLifecycle,
	type RuntimePlayerPersistence,
	type RuntimeSaveState,
} from "@rowcat/runtime-persistence";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getRowCatClient } from "../../lib/api.ts";
import { useRuntimeSaveScope } from "../../lib/local-data/scope.tsx";
import {
	createHostTransport,
	describeNativeRuntimeHost,
} from "../../lib/runtime-native/host-bridge.ts";
import {
	createNativeRuntimeSession,
	type NativeRuntimeSession,
} from "../../lib/runtime-native/session.ts";
import type { NativeRuntimeState } from "../../lib/runtime-native/session-state.ts";
import { stopNativeSession } from "../../lib/runtime-native/session-stop.ts";
import { runtimeArtifactIncompatible } from "./runtime-player-status.ts";
import { useRuntimeGeneration } from "./use-runtime-generation.ts";

/**
 * **The lifetime of product playback** (native). It ties the store, the bridge and the session
 * together in one place.
 *
 * ```text
 * RuntimeSaveStore (member-scoped · SQLite)
 *       ↓ createRuntimePlayerPersistence
 * load() → two snapshots, or sync-required
 *       ↓ session.start(artifact, { storyState, persistentState, generationEnabled })
 * hidden trusted WebView (QuickJS) ── commit ──▶ NativeRuntimeTreeStore ──▶ RN surface
 *       ▲                                       └ press → dispatchEvent
 *       └── hydrated · story-state · persistent-state ──▶ RuntimePlayerPersistence
 * ```
 *
 * It follows the same rules as the web's counterpart: a missing save is not treated as a new game,
 * late news from a stale generation is discarded, and leaving cuts generation and flushes saves.
 * Only the execution environment (worker ↔ WebView) and the renderer (shadow DOM ↔ RN tree) differ.
 *
 * ## Transitions are serial: one owner for the save scope
 *
 * Restart, reset and leave are ordered by **the same object** as on the web
 * (`RuntimePlayerLifecycle` in `@rowcat/runtime-persistence`). The old session is stopped, its
 * bridge's `stopped` is awaited, the save is flushed to completion and disposed, and **only then**
 * is the next scope read or cleared. When the next session was created directly in the effect's
 * cleanup, the old coordinator's last write overlapped the new coordinator's `load()`, and on reset
 * a late-finishing write won.
 *
 * The session object has the screen's lifetime (one bridge, several generations). What this hook
 * changes is only **when** the session's generation advances: after the previous one has finished.
 */

/** Runtime branch of the playback response. Narrowing is pinned by name. */
type RuntimePlaybackDto = Extract<StoryPlaybackDto, { kind: "runtime" }>;

export type RuntimePlayerStatus =
	| "loading"
	| "syncing"
	| "starting"
	| "running"
	/**
	 * This app cannot run that artifact. **Restarting is not the answer** (same meaning as the web's
	 * equivalent). Restarting on the same app would hit the same failure, so the screen does not
	 * suggest a retry and points to an app update.
	 */
	| "incompatible"
	| "failed"
	| "unavailable";

export interface MobileRuntimePlayer {
	status: RuntimePlayerStatus;
	/** Bridge and session state: the basis on which the screen chooses the failure copy. */
	native: NativeRuntimeState;
	session: NativeRuntimeSession | null;
	save: RuntimeSaveState | null;
	/** Whether this work uses generation. The trusted AI notice is decided by this value. */
	usesGeneration: boolean;
	/** Whether this work is runtime playback. When false, it is not this screen's concern. */
	isRuntime: boolean;
	/**
	 * Kind of playback response that has passed the entitlement gate. **`null` until one arrives.**
	 *
	 * This is a different axis from `isRuntime`. That value is true even before the response arrives
	 * (so the screen does not draw "not this screen's concern" too early), so it cannot be the
	 * condition for listing the library entry. The condition must be the single response the server
	 * returns after deciding entitlement.
	 */
	playbackKind: "chat" | "runtime" | null;
	/**
	 * The images this publication calls by logical name. **They come from the same response as the
	 * artifact.**
	 *
	 * They are not fetched separately, for two reasons: that address would open the asset list without
	 * playback entitlement, and if the two values came from publications at different times, new code
	 * would draw old images.
	 */
	managedAssets: readonly { path: string; assetId: string }[];
	restart: () => void;
	resetPlaythrough: () => void;
	retrySave: () => void;
}

/**
 * The table for when there is no response yet or the work is a chat work. A module constant, so no
 * new array is created each render.
 */
const EMPTY_MANAGED_ASSETS: readonly { path: string; assetId: string }[] = [];

/** Flush timeout on leaving. Not applied to explicit restart or reset. */
const TEARDOWN_FLUSH_TIMEOUT_MS = 2_000;

/** Timeout when the bridge does not answer `stopped`. This is the VM's deadline, not the save's. */
const STOP_GRACE_MS = 5_000;

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export function useRuntimePlayer({
	storyId,
	aiDecision,
}: {
	storyId: string;
	/**
	 * The user's answer to the trusted AI notice; `null` if not yet chosen.
	 *
	 * **For a work that does not use generation, this value decides nothing.** This hook makes that
	 * decision, since only here is the response's `capabilities` known. If the screen re-wrote it, a
	 * work that needs no notice would wait for an answer forever and never appear.
	 */
	aiDecision: boolean | null;
}): MobileRuntimePlayer {
	const client = getRowCatClient();
	const playback = useQuery(storyPlaybackQueryOptions(client, storyId));
	const { store } = useRuntimeSaveScope();
	const adapter = useRuntimeGeneration({
		storyId,
		/** Nothing runs before the playback response arrives, so `false` there is never read for a real request. */
		adult: playback.data?.kind === "runtime" ? playback.data.adult : false,
	});
	const adapterRef = useRef(adapter);
	adapterRef.current = adapter;

	const [save, setSave] = useState<RuntimeSaveState | null>(null);
	const [status, setStatus] = useState<RuntimePlayerStatus>("loading");
	/**
	 * The current owner's save. Session commits go here until the stop completes and it is released.
	 */
	const ownerPersistenceRef = useRef<RuntimePlayerPersistence | null>(null);
	/** The coordinator that draws save state: always the most recently created one. */
	const latestPersistenceRef = useRef<RuntimePlayerPersistence | null>(null);

	/**
	 * The bridge and session **have the screen's lifetime.** When the work changes, the route remounts
	 * (the same axis as `remountDeps`), so there is no need to bind the identity to `storyId` here.
	 */
	const descriptor = useMemo(() => describeNativeRuntimeHost(), []);
	const transport = useMemo(
		() => createHostTransport(descriptor),
		[descriptor],
	);
	const session = useMemo(
		() =>
			createNativeRuntimeSession({
				transport,
				onHydrated: (snapshots) =>
					ownerPersistenceRef.current?.sessionHydrated(
						snapshots as Parameters<
							RuntimePlayerPersistence["sessionHydrated"]
						>[0],
					),
				onStoryState: (snapshot) =>
					ownerPersistenceRef.current?.storyStateCommitted(
						snapshot as Parameters<
							RuntimePlayerPersistence["storyStateCommitted"]
						>[0],
					),
				onPersistentState: (snapshot) =>
					ownerPersistenceRef.current?.persistentStateCommitted(
						snapshot as Parameters<
							RuntimePlayerPersistence["persistentStateCommitted"]
						>[0],
					),
				onGenerationRequest: (request, context) =>
					adapterRef.current(request, context),
			}),
		[transport],
	);

	const [native, setNative] = useState(session.getState);
	useEffect(
		() => session.subscribe(() => setNative(session.getState())),
		[session],
	);

	/**
	 * Extracts only the runtime branch. `useMemo` because it is a dependency of the effect below.
	 *
	 * Creating a new object on each render would rerun that effect, and the session would be rebuilt
	 * every time.
	 */
	const runtime = useMemo<RuntimePlaybackDto | null>(() => {
		const data = playback.data;
		return data !== undefined && data.kind === "runtime" ? data : null;
	}, [playback.data]);
	const usesGeneration = runtime?.capabilities.includes("generation") === true;
	/**
	 * The value handed to the session. A work that does not use generation **closes at once**: the
	 * capability is absent from the table, so `useGeneration()` returns
	 * `runtime_generation_unavailable`, and how the creator handles that reason is up to that code.
	 */
	const generationAllowed =
		runtime === null ? null : usesGeneration ? aiDecision : false;

	/**
	 * Values read **when a transition runs**. Dependencies may change, but the lifecycle instance
	 * stays one.
	 */
	const inputsRef = useRef({ store, storyId, runtime, generationAllowed });
	inputsRef.current = { store, storyId, runtime, generationAllowed };

	const lifecycleRef = useRef<RuntimePlayerLifecycle | null>(null);
	if (lifecycleRef.current === null)
		lifecycleRef.current = createRuntimePlayerLifecycle({
			scope: () => {
				const { store: scopeStore, storyId: scopeStoryId } = inputsRef.current;
				if (scopeStore === null)
					throw new Error("runtime player scope is not open");
				return { store: scopeStore, storyId: scopeStoryId };
			},
			createPersistence(scope) {
				const persistence = createRuntimePlayerPersistence({
					store: scope.store,
					storyId: scope.storyId,
					clock: { now: () => new Date().toISOString(), delay },
					onStateChange: (next) => {
						if (latestPersistenceRef.current === persistence) setSave(next);
					},
				});
				latestPersistenceRef.current = persistence;
				return persistence;
			},
			startSession(start) {
				const { runtime: current, generationAllowed: allowed } =
					inputsRef.current;
				if (current === null) throw new Error("playback is not available");
				ownerPersistenceRef.current = start.persistence;
				session.start(current.artifact, {
					storyState: start.storyState,
					persistentState: start.persistentState,
					generationEnabled: allowed === true,
				});
				return {
					/**
					 * Order is the rule. `stop()` cuts a running generation (the generation's abort handle) and
					 * sends the stop, and here it waits for the bridge's `stopped`: the cleanup function's final
					 * commit crosses before that. Flushing saves comes after, handled by the lifecycle.
					 */
					stop: () =>
						stopNativeSession(session, { graceMs: STOP_GRACE_MS, delay }),
					release() {
						if (ownerPersistenceRef.current === start.persistence)
							ownerPersistenceRef.current = null;
					},
				};
			},
			teardownFlushTimeoutMs: TEARDOWN_FLUSH_TIMEOUT_MS,
			onEvent(event) {
				switch (event.type) {
					case "transition":
						setStatus("starting");
						return;
					case "sync-required":
						setStatus("syncing");
						return;
					case "load-failed":
					case "blocked":
					case "start-failed":
						/**
						 * `blocked` means the earlier save did not finish, so nothing is started. The screen's
						 * save-failure line (`Save again`) and `Restart` both connect to this same transition.
						 */
						setStatus("failed");
						return;
					case "started":
					case "idle":
						return;
				}
			},
		});
	const lifecycle = lifecycleRef.current;

	useEffect(() => {
		if (store === null) return;
		if (runtime === null) return;
		if (generationAllowed === null) return;
		lifecycle.start();
		return () => {
			lifecycle.teardown();
		};
	}, [lifecycle, store, runtime, generationAllowed]);

	/**
	 * Disposing the session is the screen's unmount. It comes **after** the effect above. The leave
	 * transition runs asynchronously, and when the bridge is already closed the stop wait is skipped
	 * (`session-stop.ts`). Commits that already arrived are held by the coordinator, so the flush
	 * includes them.
	 */
	useEffect(() => () => session.dispose(), [session]);

	useEffect(() => {
		if (native.status === "running") {
			setStatus("running");
			return;
		}
		if (native.status !== "failed") return;
		/**
		 * A version-mismatch failure has its own state: that screen does not offer `Restart`, because
		 * rebuilding the same artifact in the same app gets the same failure.
		 */
		setStatus(
			runtimeArtifactIncompatible(native.failure) ? "incompatible" : "failed",
		);
	}, [native]);

	useEffect(() => {
		if (playback.isError) setStatus("unavailable");
	}, [playback.isError]);

	/**
	 * **This work plays as a conversation: it is not this address's.**
	 *
	 * It starts no conversation here and only shows guidance (the web's same screen made the same
	 * call). If a room were created automatically, someone who opened the wrong address would get a
	 * conversation they never made.
	 */
	useEffect(() => {
		if (playback.data?.kind === "chat") setStatus("unavailable");
	}, [playback.data]);

	return {
		status,
		native,
		session,
		save,
		usesGeneration,
		isRuntime: playback.data === undefined || playback.data.kind === "runtime",
		playbackKind: playback.data?.kind ?? null,
		managedAssets: runtime?.managedAssets ?? EMPTY_MANAGED_ASSETS,
		restart: () => lifecycle.restart(),
		resetPlaythrough: () => lifecycle.resetPlaythrough(),
		retrySave: () => lifecycle.retrySave(),
	};
}
