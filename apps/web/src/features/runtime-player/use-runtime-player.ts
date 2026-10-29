import {
	authorizeRuntimeAssetResolver,
	bindRuntimeAssetResolver,
	EMPTY_MANAGED_ASSET_BINDINGS,
	EMPTY_REMOTE_ASSET_ALLOWLIST,
	type RuntimeManagedAssetBindings,
	type RuntimeRemoteAssetAllowlist,
	runtimeManagedAssetBindings,
} from "@rowcat/runtime/asset";
import {
	createRuntimePlayerLifecycle,
	createRuntimePlayerPersistence,
	type RuntimePlayerLifecycle,
	type RuntimePlayerPersistence,
	type RuntimePlayerSessionStart,
	type RuntimeSaveState,
} from "@rowcat/runtime-persistence";
import {
	createWebRuntimeRenderer,
	type WebRuntimeRenderer,
} from "@rowcat/runtime-renderer-web";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { RuntimePreviewGenerationAdapter } from "#/features/runtime-preview/runtime-preview-generation.ts";
import { createPreviewGenerationRouter } from "#/features/runtime-preview/runtime-preview-generation-router.ts";
import { useRuntimeSaveScope } from "#/lib/local-runtime-save/scope.ts";
import type { WebResolvedAssetResolver } from "#/lib/runtime-assets/web-asset-resolver.ts";
import type { PlayerWorkerMessage } from "./protocol.ts";
import type { RuntimePlayerClient } from "./runtime-player-client.ts";
import {
	initialRuntimePlayerState,
	type RuntimePlayerState,
	runtimePlayerReducer,
} from "./runtime-player-state.ts";

/**
 * Lifetime of product playback. It connects the member-scoped save store, the worker (QuickJS), and
 * the web renderer.
 *
 * - Input is the published artifact, not source, so this hook knows nothing about the compiler.
 * - Saves go to the product store (Dexie, then E2EE sync), not to worker memory.
 * - AI use is an explicit user approval, not default-off. The trusted notice comes first.
 * - No session starts while load() answers sync-required. A freshly paired device would read that
 *   as a new game, and the first commit would overwrite the real saves (§57).
 * - Transitions (restart, reset, leave) are serialized by RuntimePlayerLifecycle in
 *   @rowcat/runtime-persistence. Order: abort in-flight generation, stop (runs cleanup), flush
 *   saves, dispose, terminate the worker, and only then read or clear the next scope. An explicit
 *   transition has no flush deadline; if it cannot finish, no session starts (failed, with save
 *   retry).
 * - Every message carries a generation number, so messages from a replaced session cannot reach
 *   the current screen.
 * - Leaving the page stops the session: cancel generation, stop, flush saves (capped so
 *   navigation is not blocked), terminate the worker. No orphan worker or unsaved write remains.
 */

export interface RuntimePlayerOptions {
	storyId: string;
	/**
	 * The artifact served by the server. Validation before execution happens in the runtime host
	 * inside the worker.
	 */
	artifact: unknown;
	/**
	 * Whether useGeneration() opens in this session. This is the user's choice. null means the user
	 * has not chosen yet and the notice is showing. The session is not started until then (§73): there
	 * is no window where the capability is granted without notice.
	 */
	generationAllowed: boolean | null;
	/** Trusted generation adapter. Without it, generation cannot run on this device. */
	adapter: RuntimePreviewGenerationAdapter | null;
	/**
	 * Resolves a destination into an address the browser may open. This is the same function the
	 * preview uses (`#/lib/runtime-assets`).
	 *
	 * Remote references become RowCat proxy addresses. The creator's address never lands in src, so
	 * the player's browser never reaches the creator's host.
	 */
	resolveAsset: WebResolvedAssetResolver;
	/**
	 * Comes together with the artifact, not from a separate lookup: same response, same authorization.
	 * A separate lookup would turn that address into a route for listing a private work's assets
	 * without play permission. The two values could also come from different publish moments, and the
	 * screen would draw old images with new code.
	 *
	 * The list is empty while the response is pending or for conversation works. undefined is not
	 * used, because the hook already expresses the wait through `artifact`.
	 */
	/**
	 * `kind` is optional because snapshots published before this axis existed still exist. Those had
	 * only managed images, so absence means image; runtimeManagedAssetBindings fills that slot with
	 * `image`.
	 */
	managedAssets: readonly {
		path: string;
		assetId: string;
		kind?: "image" | "audio";
	}[];
}

export interface RuntimePlayer {
	state: RuntimePlayerState;
	/** Save-layer state. A failure is one line on screen, not a runtime failure (§64). */
	save: RuntimeSaveState | null;
	attachSurface: (element: HTMLDivElement | null) => void;
	/**
	 * Restarts only the VM with the same save. This is a different action from `Reset play` (§62).
	 */
	restart: () => void;
	/** Clears only this playthrough's progress. Long progress is left alone (§61). */
	resetPlaythrough: () => void;
	/** Retries the failed save write. If a transition is blocked, this also resumes it. */
	retrySave: () => void;
	/**
	 * Whether the browser's autoplay policy is blocking sound. This is a fact the host draws. The
	 * renderer only reports the observation and draws nothing, since its package has no React. If
	 * nothing connects the two, the creator sets `playing` and nothing happens, with no error.
	 */
	audioActivationRequired: boolean;
	/**
	 * Must be called synchronously from the user's press. If it is deferred past an await, the browser
	 * does not treat the call as a user gesture and playback is rejected again. This is why the
	 * signature returns no Promise.
	 */
	activateAudio: () => void;
}

/**
 * The flush cap when leaving. It does not apply to explicit restart or reset; for those, order is
 * correctness, so they wait for completion.
 */
const TEARDOWN_FLUSH_TIMEOUT_MS = 2_000;

/**
 * Upper bound for waiting on the worker's `stopped`. This is the VM's time limit, not the save's.
 * It applies when the worker died (onCrash arrives first) or the cleanup function used up its
 * budget. Saves are still flushed to the end afterwards: commits already received are in the
 * coordinator, and the worker has nothing more to send.
 */
const STOP_GRACE_MS = 5_000;

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** The execution host of this session: one worker and that generation's generation router. */
interface Session {
	generation: number;
	client: RuntimePlayerClient;
	abortGeneration: () => void;
}

export function useRuntimePlayer(options: RuntimePlayerOptions): RuntimePlayer {
	/**
	 * The renderer is created once, when the surface attaches, so the resolver is held in a ref and
	 * always read as the latest one.
	 */
	const resolveAssetRef = useRef(options.resolveAsset);
	resolveAssetRef.current = options.resolveAsset;
	/**
	 * Remote addresses this session authorizes. The value is the worker's `started` answer and differs
	 * per generation. It is held in a ref because the renderer is created only once; a value captured
	 * at creation would keep the first session's list for later sessions, with no visible symptom
	 * since images still load. Cleared when a transition starts, so no authorized addresses exist
	 * between sessions.
	 */
	const remoteAssetsRef = useRef<RuntimeRemoteAssetAllowlist>(
		EMPTY_REMOTE_ASSET_ALLOWLIST,
	);
	/**
	 * This session's logical name table. It comes from the published snapshot and is fixed when the
	 * session starts. Unlike the remote list, it does not go through the worker. Its authority is the
	 * authorized play response, which main holds. The VM emits logical names and never needs
	 * identities, so a round trip would cross the isolation boundary twice for nothing.
	 *
	 * Cleared when a transition starts. If it survived a restart into another work, that work's images
	 * would appear on the new screen with no visible symptom.
	 */
	const managedAssetsRef = useRef<RuntimeManagedAssetBindings>(
		EMPTY_MANAGED_ASSET_BINDINGS,
	);
	const { storyId, artifact, generationAllowed, adapter, managedAssets } =
		options;
	const { store, status: scopeStatus } = useRuntimeSaveScope();

	const [state, dispatch] = useReducer(
		runtimePlayerReducer,
		initialRuntimePlayerState,
	);
	const [save, setSave] = useState<RuntimeSaveState | null>(null);

	/**
	 * Created during render and disposed in an effect. Doing this the other way around would let
	 * StrictMode's double mount permanently stop a live instance (automatic sync hit the same
	 * incident).
	 */
	const rendererRef = useRef<WebRuntimeRenderer | null>(null);
	const [audioActivationRequired, setAudioActivationRequired] = useState(false);
	const surfaceRef = useRef<HTMLDivElement | null>(null);
	/**
	 * Current owner. It accepts messages for its generation until the stop finishes and the session is
	 * released.
	 */
	const sessionRef = useRef<Session | null>(null);
	/**
	 * The generation the screen is showing. It advances the moment a transition starts, so messages
	 * from an old generation do not reach state.
	 */
	const generationRef = useRef(0);
	/** The save-state coordinator the screen draws. Only the most recently created one is kept. */
	const persistenceRef = useRef<RuntimePlayerPersistence | null>(null);
	/**
	 * Values read when a transition runs. Effect dependencies can change, but the lifecycle instance
	 * stays one.
	 */
	const inputsRef = useRef({
		store,
		storyId,
		artifact,
		generationAllowed,
		adapter,
		managedAssets,
	});
	inputsRef.current = {
		store,
		storyId,
		artifact,
		generationAllowed,
		adapter,
		managedAssets,
	};

	const attachSurface = useCallback((element: HTMLDivElement | null) => {
		surfaceRef.current = element;
		if (element === null) {
			rendererRef.current?.dispose();
			rendererRef.current = null;
			return;
		}
		if (rendererRef.current !== null) return;
		rendererRef.current = createWebRuntimeRenderer({
			container: element,
			onAudioActivationChange: setAudioActivationRequired,
			dispatchEvent: (handlerId, payload) => {
				const session = sessionRef.current;
				if (session === null || session.generation !== generationRef.current)
					return;
				session.client.dispatchEvent(session.generation, handlerId, payload);
			},
			/**
			 * The resolver comes from outside, and both branches end up as drawing.
			 *
			 * Logical names become media identities through this play's binding table
			 * (bindRuntimeAssetResolver). Remote addresses become RowCat proxy addresses only if they pass
			 * the list the artifact declares (authorizeRuntimeAssetResolver). Names missing from the table
			 * and addresses outside the list produce no address at all. This is assembly-level absence, not
			 * filtering.
			 *
			 * The renderer rule is unchanged: only the resolver's answer can reach src, and no path lets
			 * creator-written text land there.
			 */
			resolveAsset: authorizeRuntimeAssetResolver(
				() => remoteAssetsRef.current,
				bindRuntimeAssetResolver(
					() => managedAssetsRef.current,
					(target) => resolveAssetRef.current(target),
				),
			),
			onFailure: (error) => {
				dispatch({
					type: "failed",
					generation: generationRef.current,
					failure: { stage: "renderer", message: error.message },
				});
			},
		});
	}, []);

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
						/**
						 * The last state change from a superseded coordinator is not drawn; the next one already
						 * holds its place.
						 */
						if (persistenceRef.current === persistence) setSave(next);
					},
				});
				persistenceRef.current = persistence;
				return persistence;
			},
			startSession: (start) => startWorkerSession(start),
			teardownFlushTimeoutMs: TEARDOWN_FLUSH_TIMEOUT_MS,
			onEvent(event) {
				switch (event.type) {
					case "transition":
						generationRef.current = event.token;
						/**
						 * Clears the authorized list when a transition starts. The new session's list arrives with
						 * its `started` message. If it were not cleared, commits in between (the old tree's last
						 * images) would draw with the old list, and on a restart into a different work that list
						 * would belong to someone else.
						 */
						remoteAssetsRef.current = EMPTY_REMOTE_ASSET_ALLOWLIST;
						/**
						 * Clears the logical name table too, then refills it with this transition's values.
						 *
						 * Unlike the remote list, which arrives later, these values are already in hand, so they are
						 * fixed here: the published snapshot at the moment the session starts. Republishing later
						 * does not change a running session. As with code, a running session is not swapped out; new
						 * images reach only the next session.
						 */
						managedAssetsRef.current = runtimeManagedAssetBindings(
							inputsRef.current.managedAssets,
						);
						dispatch({ type: "start", generation: event.token });
						return;
					case "sync-required":
						dispatch({ type: "sync-required" });
						return;
					case "load-failed":
						dispatch({
							type: "failed",
							generation: event.token,
							failure: {
								stage: "start",
								error: {
									kind: "host",
									name: "RuntimePersistenceError",
									message: event.error.message,
									code: event.error.code,
									componentStack: [],
									frames: [],
								},
							},
						});
						return;
					case "blocked":
						/**
						 * The previous save could not finish, so the session is not started. The screen shows
						 * `failed`, and the `Save again` line on the save-failure row resumes this transition (retrySave).
						 */
						dispatch({
							type: "failed",
							generation: event.token,
							failure: { stage: "persistence", message: event.message },
						});
						return;
					case "start-failed":
						dispatch({
							type: "failed",
							generation: event.token,
							failure: { stage: "worker", message: event.message },
						});
						return;
					case "started":
					case "idle":
						return;
				}
			},
		});

	/**
	 * Starts one worker. Called only after the lifecycle has fully ended the previous owner.
	 *
	 * The returned owner's stop() waits for the worker's `stopped` (or its death). No save commit
	 * arrives after that: postMessage keeps order, and `stopped` is the last message after cleanup, so
	 * the lifecycle's flush captures the final value.
	 */
	async function startWorkerSession(start: RuntimePlayerSessionStart) {
		const generation = start.token;
		const { artifact: startArtifact, generationAllowed: allowed } =
			inputsRef.current;
		const router = createPreviewGenerationRouter({
			adapter: () => inputsRef.current.adapter,
			/**
			 * Answers a request only if its generation is still the current owner's. Otherwise it returns
			 * -1, which matches no request.
			 */
			currentGeneration: () =>
				sessionRef.current?.generation === generation ? generation : -1,
			send: (gen, requestId, result) =>
				sessionRef.current?.client.generationResult(gen, requestId, result),
		});

		let stopped = false;
		let resolveStopped: () => void = () => undefined;
		const stoppedPromise = new Promise<void>((resolve) => {
			resolveStopped = resolve;
		});
		const settleStop = (): void => {
			stopped = true;
			resolveStopped();
		};

		const onMessage = (message: PlayerWorkerMessage): void => {
			/**
			 * A message from this worker with a different generation comes from the worker's old session. It
			 * goes nowhere.
			 */
			if (message.generation !== generation) return;
			switch (message.type) {
				case "commit":
					if (generationRef.current !== generation) return;
					try {
						rendererRef.current?.apply(message.batch);
					} catch (error) {
						dispatch({
							type: "failed",
							generation,
							failure: {
								stage: "renderer",
								message: error instanceof Error ? error.message : String(error),
							},
						});
					}
					return;
				/**
				 * Control commands (scroll, focus). The renderer compares revisions and silently discards
				 * mismatches. Unlike commits, a command failure does not halt the screen. A command expresses
				 * intent, not tree state, and one missed scroll is no reason to end playback.
				 */
				case "commands":
					if (generationRef.current !== generation) return;
					rendererRef.current?.applyCommands(message.batch);
					return;
				case "hydrated":
					/**
					 * Persists the migration (§59). If hydration bumped the version, this is the current state. If
					 * it is not written, the next session runs the same migration again.
					 */
					start.persistence.sessionHydrated({
						storyState: message.storyState,
						persistentState: message.persistentState,
					});
					return;
				case "story-state":
					start.persistence.storyStateCommitted(message.snapshot);
					return;
				case "persistent-state":
					start.persistence.persistentStateCommitted(message.snapshot);
					return;
				case "generation-request":
					router.handle({
						generation,
						requestId: message.requestId,
						request: message.request,
					});
					return;
				case "remote-assets":
					/**
					 * The session's authorized list. It arrives before the first commit. The generation is
					 * checked: the outgoing session's worker can still send this message, and without the check
					 * its list would draw the new session's first commit. This is the same check as the commit and
					 * command branches.
					 */
					if (generationRef.current !== generation) return;
					remoteAssetsRef.current = new Set(message.remoteAssets);
					return;
				case "started":
					dispatch({ type: "started", generation });
					return;
				case "root-error":
					dispatch({ type: "root-error", generation, error: message.error });
					return;
				case "failed":
					dispatch({ type: "failed", generation, failure: message.failure });
					return;
				case "stopped":
					settleStop();
					return;
				default:
					return;
			}
		};

		const { createRuntimePlayerClient } = await import(
			"./runtime-player-client.ts"
		);
		const client = await createRuntimePlayerClient({
			onMessage,
			onCrash: (message) => {
				settleStop();
				dispatch({
					type: "failed",
					generation,
					failure: { stage: "worker", message },
				});
			},
		});

		const session: Session = {
			generation,
			client,
			abortGeneration: () => router.abort(),
		};
		sessionRef.current = session;
		/** Resets to an empty root so the new session's first batch (revision 1) can be accepted. */
		rendererRef.current?.reset();
		client.start({
			generation,
			artifact: startArtifact,
			storyState: start.storyState,
			persistentState: start.persistentState,
			generationEnabled: allowed === true,
		});

		return {
			async stop() {
				/**
				 * Order is the rule (§65). Cut off the paid request still running, send stop so cleanup runs,
				 * and wait until the worker reports the end. The save flush comes after that; the lifecycle
				 * handles it.
				 */
				session.abortGeneration();
				if (!stopped) {
					client.stop(generation);
					await Promise.race([stoppedPromise, delay(STOP_GRACE_MS)]);
				}
			},
			release() {
				client.terminate();
				if (sessionRef.current === session) sessionRef.current = null;
			},
		};
	}

	const lifecycle = lifecycleRef.current;

	// biome-ignore lint/correctness/useExhaustiveDependencies: storyId and artifact are signals, not values. The transition reads them from refs, and the session is torn down and started again when they change.
	useEffect(() => {
		/** The scope is still opening, or the user is a guest. Do not start a session. */
		if (store === null) return;
		/**
		 * The user has not answered the AI notice yet. Do not open a window in which the capability is
		 * granted.
		 */
		if (generationAllowed === null) return;
		lifecycle.start();
		return () => {
			lifecycle.teardown();
		};
	}, [lifecycle, store, storyId, artifact, generationAllowed]);

	/** The scope ended as a guest, so the playback screen cannot open. */
	useEffect(() => {
		if (scopeStatus === "unavailable") dispatch({ type: "unavailable" });
	}, [scopeStatus]);

	return {
		state,
		save,
		attachSurface,
		/**
		 * Creator code cannot create or clear this state. It reflects an observation that `<Audio
		 * playing>` is on while the browser refused playback, so the host button shows only while that
		 * observation holds.
		 *
		 * Retrying playback on a timer to get around the policy is not done: such an attempt either fails
		 * or plays sound the user never allowed.
		 */
		audioActivationRequired,
		activateAudio: () => rendererRef.current?.activateAudio(),
		restart: () => lifecycle.restart(),
		resetPlaythrough: () => lifecycle.resetPlaythrough(),
		retrySave: () => lifecycle.retrySave(),
	};
}
