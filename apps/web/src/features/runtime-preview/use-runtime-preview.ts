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
	emptyPersistentStateSnapshot,
	type RuntimePersistentStateSnapshot,
} from "@rowcat/runtime-host/persistent-state";
import {
	emptyStoryStateSnapshot,
	type RuntimeStoryStateSnapshot,
} from "@rowcat/runtime-host/story-state";
import {
	createWebRuntimeRenderer,
	type WebRuntimeRenderer,
} from "@rowcat/runtime-renderer-web";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { runtimeProjectSignature } from "#/features/runtime-studio/compile/signature.ts";
import type { RuntimeProjectSnapshot } from "#/features/runtime-studio/compile/source-snapshot.ts";
import type { WebResolvedAssetResolver } from "#/lib/runtime-assets/web-asset-resolver.ts";
import type { PreviewGeneration, PreviewWorkerMessage } from "./protocol.ts";
import type { RuntimePreviewClient } from "./runtime-preview-client.ts";
import {
	appendConsoleEntry,
	diagnosticConsoleEntry,
	emptyRuntimePreviewConsole,
	formatConsoleArgs,
	type RuntimePreviewConsole,
} from "./runtime-preview-console.ts";
import type { RuntimePreviewDebugSink } from "./runtime-preview-debug-sink.ts";
import type { RuntimePreviewGenerationAdapter } from "./runtime-preview-generation.ts";
import {
	createPreviewGenerationRouter,
	type PreviewGenerationRouter,
} from "./runtime-preview-generation-router.ts";
import {
	initialRuntimePreviewState,
	type RuntimePreviewState,
	runtimePreviewReducer,
	runtimePreviewResetPlan,
} from "./runtime-preview-state.ts";

/**
 * Preview lifecycle: links the worker, renderer and state in one place.
 * - The source snapshot is the editor's current state, not the saved copy. Autosave updates the
 *   record 500 ms later and the live query later still. If `run` sent the stored copy, it would
 *   execute an old version and only then show `Changes pending`. If `run` flushed the save and waited, a
 *   save failure would become a run failure. The editor and autosave are therefore two independent
 *   consumers of the same edit. This hook reads only the editor side and writes nothing.
 * - `run` captures one snapshot. The staleness signal and the file sent to the worker come from
 *   that same object. The staleness signal is a comparison, not a marker: reverting the source to
 *   its run-time value also clears staleness.
 * - The renderer lives with the surface element. `attachSurface` creates the renderer when the
 *   element arrives and disposes it when the element goes. Before a new generation's first batch,
 *   `reset()` creates an empty root. Late batches from the old session do not match the generation
 *   and never reach it.
 * - Leaving the screen stops the preview. Unmount sends `stop` so cleanup runs; if no answer
 *   arrives, the worker is terminated. No orphan workers remain.
 * - The worker owns the saved state. `storyState` and `persistentState` are copies it sent, and
 *   this hook never writes them. Restart carries both over: the VM is rebuilt, `useState` starts
 *   over, and saved state continues. `resetPlaythrough` clears only the first,
 *   `resetPersistentState` only the second. Keeping these three operations distinct is the most
 *   important property of this hook.
 * - AI is off by default. Turning on the preview must not make it able to send paid requests
 *   (§36). Editing and rerunning is the normal loop, and if every rerun were billed, creators would
 *   fear the run button. Enabling is an explicit action, and the choice is fixed when a run starts.
 * - Even when AI is on, requests start only from user interaction. The host decides that
 *   (`RuntimeHostCallContext.origin`); this file does not restate it.
 */

/**
 * Upper bound on waiting for the cleanup reply. After it, the worker is force-terminated, since
 * cleanup may hang.
 */
const STOP_GRACE_MS = 3_000;

export interface RuntimePreviewInput {
	/** The current editor project: plain `{ path, content }` entries plus the entry path. */
	snapshot: RuntimeProjectSnapshot;
	/**
	 * Early eligibility from the studio's check state. The worker's full compile is the final
	 * authority.
	 */
	eligible: boolean;
	/**
	 * Adapter connecting the worker's generation requests to the real RowCat stack. Without it, AI
	 * cannot be turned on in this preview and no toggle is drawn. This hook does not import the
	 * generation stack directly: preview lifecycle and generation wiring are separate concerns, and
	 * merging them would make this file aware of the SDK, credentials and payment cache.
	 */
	generation?: RuntimePreviewGenerationAdapter | null;
	/**
	 * Maps a resolved destination to an address the browser may open. Pass the same function the
	 * playback surface uses (`#/lib/runtime-assets`). If preview and playback used different address
	 * rules, a creator would see their work change after publishing. This hook does not know that
	 * rule. The logical-name to media-identity conversion happens in this hook, using the binding
	 * table frozen when the run started. If that table came from outside, the running session would
	 * follow edits made elsewhere, which this screen deliberately does not do for source.
	 */
	resolveAsset: WebResolvedAssetResolver;
	/**
	 * Observation sink. If absent, nothing happens. The studio does not pass one, since its screen
	 * already has a bottom panel. The work-test debugger does; its records live only in memory and
	 * vanish with the screen. No protocol field was added. The hook reads messages that already flow
	 * past, so the worker, the VM and commit order are unchanged by this.
	 */
	debug?: RuntimePreviewDebugSink | null;
}

export interface RuntimePreview {
	state: RuntimePreviewState;
	console: RuntimePreviewConsole;
	/** This preview's playthrough, drawn in the first section of the `State` panel. */
	storyState: RuntimeStoryStateSnapshot;
	/**
	 * This preview's long progress, drawn in the second section of the same panel. It is not merged
	 * into one list.
	 */
	persistentState: RuntimePersistentStateSnapshot;
	eligible: boolean;
	/** Whether AI can be turned on in this preview. Same meaning as having an adapter. */
	generationSupported: boolean;
	/** The choice for the next run. A running session's capabilities do not change. */
	generationEnabled: boolean;
	setGenerationEnabled(enabled: boolean): void;
	/**
	 * Whether the running session actually started with AI capability. The screen states that fact.
	 */
	generationActive: boolean;
	run(): void;
	restart(): void;
	/**
	 * Playthrough reset, a different operation from restart. Restart rebuilds only the VM and carries
	 * saved state over. Here the snapshot is cleared and a new session is set up, so every
	 * `defineStoryState` starts from `initial`. When stopped, only the snapshot is cleared, and the
	 * next run starts from the beginning.
	 */
	resetPlaythrough(): void;
	/**
	 * Long-progress reset: for creators and debugging only. It is absent from the product's playback
	 * surface. It exists for testing: reproducing a first-time player's screen requires clearing long
	 * progress too. Without it, creators learn to refresh the browser instead. It is not folded into
	 * the `Reset play` button, because merging them would erase unlocks worth several chapters whenever
	 * someone replays a chapter.
	 */
	resetPersistentState(): void;
	stop(): void;
	clearConsole(): void;
	/** Callback ref that receives the surface element. Everything below it belongs to the renderer. */
	attachSurface(element: HTMLDivElement | null): void;
	/**
	 * Whether the browser's autoplay policy is blocking sound. This is a fact the host draws. The
	 * renderer only raises the observation and draws nothing, since that package has no React. If
	 * nothing connects the two, a creator sets `playing`, nothing happens, and the silence produces no
	 * error.
	 */
	audioActivationRequired: boolean;
	/**
	 * Call synchronously within the user's press. Deferring past an `await` makes the browser stop
	 * treating the call as a user gesture, and playback is refused again. That is why this returns no
	 * Promise.
	 */
	activateAudio: () => void;
}

export function useRuntimePreview({
	snapshot,
	eligible,
	generation: generationAdapter = null,
	resolveAsset,
	debug = null,
}: RuntimePreviewInput): RuntimePreview {
	/**
	 * The sink is held in a ref so that `onMessage`'s identity does not depend on it. Otherwise the
	 * client would be recreated on every sink change, and recreation would lose the running worker.
	 * Observation is exactly where it could disturb execution.
	 */
	const debugRef = useRef(debug);
	debugRef.current = debug;
	const [state, dispatch] = useReducer(
		runtimePreviewReducer,
		initialRuntimePreviewState,
	);
	const [console, setConsole] = useState(emptyRuntimePreviewConsole);
	const [storyState, setStoryState] = useState<RuntimeStoryStateSnapshot>(
		emptyStoryStateSnapshot,
	);
	const [persistentState, setPersistentState] =
		useState<RuntimePersistentStateSnapshot>(emptyPersistentStateSnapshot);
	const generationRef = useRef<PreviewGeneration>(0);
	/**
	 * The renderer is created once at mount, so the asset resolver is also held in a ref rather than
	 * rebuilt on each render.
	 */
	const resolveAssetRef = useRef(resolveAsset);
	resolveAssetRef.current = resolveAsset;
	/**
	 * Remote addresses this session is authorized to load: the value the worker's `started` provided.
	 * This is how the preview uses the same authorization model as product playback. Looser rules here
	 * would let images drawn while authoring disappear after publishing, and creators would discover
	 * the difference only after publishing. Cleared on every run; `started` refills it.
	 */
	const remoteAssetsRef = useRef<RuntimeRemoteAssetAllowlist>(
		EMPTY_REMOTE_ASSET_ALLOWLIST,
	);
	/**
	 * The logical-name table this run uses: a copy of the draft at the moment `run` was pressed. It is
	 * frozen by the same rule as the source (§34). If the live draft's bindings were read during a
	 * running preview, an image could change under the VM when a creator swaps an asset, and nobody
	 * could say what is running. A changed binding shows `Changes pending` and applies from the next run. The
	 * table is not sent to the worker, which is also the point. The VM emits logical names as is
	 * (`{"$asset": …}`) and the trusted renderer converts them to identities. Neither media bytes nor
	 * addresses need to cross the isolation boundary.
	 */
	const managedAssetsRef = useRef<RuntimeManagedAssetBindings>(
		EMPTY_MANAGED_ASSET_BINDINGS,
	);
	/**
	 * The next run's choice. It does not affect a running session; the capability table is fixed when
	 * the session is set up.
	 */
	const [generationEnabled, setGenerationEnabled] = useState(false);
	/** Whether the running session started with that capability. Frozen at run time. */
	const [generationActive, setGenerationActive] = useState(false);
	const adapterRef = useRef(generationAdapter);
	adapterRef.current = generationAdapter;
	/**
	 * Owner of the running generation: aborted when the generation changes or the hook unmounts. It is
	 * created during render and not stopped in an effect; auto-sync makes the same decision at the
	 * same place. The object holds no state, so stopping is a single `abort()` call.
	 */
	const generationRouterRef = useRef<PreviewGenerationRouter | null>(null);
	if (generationRouterRef.current === null)
		generationRouterRef.current = createPreviewGenerationRouter({
			adapter: () => adapterRef.current,
			currentGeneration: () => generationRef.current,
			send: (generation, requestId, result) => {
				debugRef.current?.generationResult({
					requestId,
					ok: result.ok,
					reason: result.ok ? null : result.reason,
				});
				void clientRef.current?.then((client) =>
					client.generationResult(generation, requestId, result),
				);
			},
		});
	const generationRouter = generationRouterRef.current;
	const clientRef = useRef<Promise<RuntimePreviewClient> | null>(null);
	const rendererRef = useRef<WebRuntimeRenderer | null>(null);
	const [audioActivationRequired, setAudioActivationRequired] = useState(false);
	const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const snapshotRef = useRef(snapshot);
	snapshotRef.current = snapshot;
	/**
	 * The current state read by the reset branch. A ref keeps the callbacks' identity from depending
	 * on state.
	 */
	const stateRef = useRef(state);
	stateRef.current = state;

	/**
	 * The current editor's signal, built by the same function as the run snapshot's signal. A
	 * different representation would give the same source two signals, and the screen would report
	 * staleness when nothing had changed.
	 */
	const signature = useMemo(
		() => runtimeProjectSignature(snapshot),
		[snapshot],
	);
	const signatureRef = useRef(signature);
	signatureRef.current = signature;
	useEffect(() => {
		dispatch({ type: "sourceChanged", signature });
	}, [signature]);

	const clearStopTimer = useCallback((): void => {
		if (stopTimerRef.current !== null) {
			clearTimeout(stopTimerRef.current);
			stopTimerRef.current = null;
		}
	}, []);

	const onMessage = useCallback(
		(message: PreviewWorkerMessage) => {
			/** Messages from old generations reach neither state nor screen. */
			if (message.generation !== generationRef.current) return;
			/**
			 * Observation is recorded before any state transition, and this call changes no branch below.
			 * Without a sink, the call simply does nothing. Exceptions are swallowed here. If one escaped,
			 * that message's transitions and rendering would not happen at all, and the screen would freeze
			 * with no error. Observation is exactly where it could disturb execution.
			 */
			try {
				debugRef.current?.message(message);
			} catch {
				// Recording is a side concern. The preview must keep running regardless of this try/catch.
			}
			switch (message.type) {
				case "status":
					if (message.stage === "starting")
						dispatch({ type: "starting", generation: message.generation });
					return;
				case "remote-assets":
					/**
					 * This session's remote-asset authorization list. It arrives before the first commit. The
					 * generation was already checked above.
					 */
					remoteAssetsRef.current = new Set(message.remoteAssets);
					return;
				case "started":
					/**
					 * The editor signal at the moment the session is set up is sent along. Edits made during
					 * compile and start produced no transition, since no session was running. Without this
					 * comparison, the session would start while calling old code current. Even if an effect
					 * corrected it later, a stale frame would appear in between.
					 */
					dispatch({
						type: "started",
						generation: message.generation,
						signature: signatureRef.current,
					});
					return;
				case "commit": {
					const renderer = rendererRef.current;
					if (renderer === null) return;
					try {
						renderer.apply(message.batch);
						dispatch({
							type: "committed",
							generation: message.generation,
							revision: message.batch.revision,
						});
					} catch (error) {
						/** A renderer failure is not the creator's. Stop the preview and discard the session. */
						dispatch({
							type: "failed",
							generation: message.generation,
							failure: {
								stage: "renderer",
								message: error instanceof Error ? error.message : String(error),
							},
						});
						void clientRef.current?.then((client) =>
							client.stop(message.generation),
						);
					}
					return;
				}
				/**
				 * A control command: the renderer compares revisions and silently drops mismatches. Unlike a
				 * commit, it does not stop the preview on failure. A missed scroll is no reason to end a
				 * session. If the renderer has already failed, the call does nothing.
				 */
				case "commands":
					rendererRef.current?.applyCommands(message.batch);
					return;
				case "story-state":
					setStoryState(message.snapshot);
					return;
				case "persistent-state":
					setPersistentState(message.snapshot);
					return;
				case "generation-request":
					/**
					 * Generation checks, cancellation and missing-adapter answers all live inside the router.
					 * Those three are races; keeping them in the hook would leave no value to check against.
					 */
					generationRouter.handle(message);
					return;
				case "console":
					setConsole((previous) =>
						appendConsoleEntry(previous, {
							kind: message.level,
							text: formatConsoleArgs(message.args),
							code: null,
							component: null,
						}),
					);
					return;
				case "diagnostic":
					setConsole((previous) =>
						appendConsoleEntry(
							previous,
							diagnosticConsoleEntry(message.diagnostic),
						),
					);
					return;
				case "root-error":
					dispatch({
						type: "rootError",
						generation: message.generation,
						error: message.error,
						work: message.work,
					});
					return;
				case "failed":
					dispatch({
						type: "failed",
						generation: message.generation,
						failure: message.failure,
					});
					return;
				case "stopped":
					clearStopTimer();
					dispatch({ type: "stopped", generation: message.generation });
					return;
			}
		},
		[clearStopTimer, generationRouter],
	);

	const ensureClient = useCallback((): Promise<RuntimePreviewClient> => {
		if (clientRef.current === null)
			clientRef.current = import("./runtime-preview-client.ts").then((module) =>
				module.createRuntimePreviewClient({
					onMessage,
					onCrash: (message) => {
						dispatch({
							type: "failed",
							generation: generationRef.current,
							failure: { stage: "worker", message },
						});
					},
				}),
			);
		return clientRef.current;
	}, [onMessage]);

	const run = useCallback(
		(options: { resetStory?: boolean; resetPersistent?: boolean } = {}) => {
			/**
			 * The run snapshot is captured here, once. Signal and worker input both come from this object.
			 * Later typing creates a new snapshot and leaves this one alone. The worker runs the code as it
			 * was when the creator pressed run; any edits in between are reported as staleness by `started`.
			 */
			const captured = snapshotRef.current;
			const generation = generationRef.current + 1;
			generationRef.current = generation;
			/**
			 * The new session's list starts empty and is not inherited from the previous run. The list
			 * arrives with that session's `started`.
			 */
			remoteAssetsRef.current = EMPTY_REMOTE_ASSET_ALLOWLIST;
			/**
			 * The logical-name table is frozen here, at the same moment and from the same snapshot as the
			 * source. Not waiting for the worker's `started` is where it differs from the remote list, and
			 * the reason holds: the remote list's authority is the verified artifact, so the side that set
			 * up the session should report it. This table's authority is the creator's draft, which the main
			 * thread holds. A round trip through the worker would cross the isolation boundary twice for
			 * nothing.
			 */
			managedAssetsRef.current = runtimeManagedAssetBindings(captured.assets);
			/**
			 * Abort any running generation here. The generation number alone already discards its reply, but
			 * without aborting, a paid request already sent would run to completion with no one reading it.
			 */
			generationRouter.abort();
			debugRef.current?.run({
				generation,
				resetStory: options.resetStory === true,
				resetPersistent: options.resetPersistent === true,
			});
			const aiEnabled = adapterRef.current !== null && generationEnabled;
			setGenerationActive(aiEnabled);
			clearStopTimer();
			rendererRef.current?.reset();
			setConsole(emptyRuntimePreviewConsole());
			dispatch({
				type: "run",
				generation,
				signature: runtimeProjectSignature(captured),
			});
			void ensureClient().then((client) => {
				if (generationRef.current !== generation) return;
				client.start({
					generation,
					entry: captured.entry,
					files: captured.files.map((file) => ({
						path: file.path,
						content: file.content,
					})),
					...(options.resetStory === true ? { resetStory: true } : {}),
					...(options.resetPersistent === true
						? { resetPersistent: true }
						: {}),
					...(aiEnabled ? { generationEnabled: true } : {}),
				});
			});
		},
		[ensureClient, clearStopTimer, generationEnabled, generationRouter],
	);

	/**
	 * The reset branch depends on one question: is a session running? If so, setting up a new session
	 * and clearing the snapshot must be one action (the worker's `start` carries `resetStory`).
	 * Splitting them would let a commit in between restore the cleared snapshot. If none is running,
	 * clearing is the whole job; the next `Run` starts from the beginning.
	 */
	const resetPlaythrough = useCallback(() => {
		if (runtimePreviewResetPlan(stateRef.current) === "clear-only") {
			const generation = generationRef.current;
			void ensureClient().then((client) => client.resetStory(generation));
			return;
		}
		run({ resetStory: true });
	}, [ensureClient, run]);

	/**
	 * Long-progress reset: the same shape as the playthrough reset, with a different snapshot. The two
	 * are not folded into one function taking a lifetime argument. A call site passing the wrong
	 * argument would compile and pass tests while clearing the wrong lifetime.
	 */
	const resetPersistentState = useCallback(() => {
		if (runtimePreviewResetPlan(stateRef.current) === "clear-only") {
			const generation = generationRef.current;
			void ensureClient().then((client) => client.resetPersistent(generation));
			return;
		}
		run({ resetPersistent: true });
	}, [ensureClient, run]);

	/**
	 * The screen passes this function. Putting `run` itself on `onClick` would pass the browser's
	 * `MouseEvent` into the options slot. That object has no `resetStory`, so it is harmless today,
	 * but if the options grow, a field could silently become true.
	 */
	const runFresh = useCallback(() => run(), [run]);

	const stop = useCallback(() => {
		const generation = generationRef.current;
		generationRouter.abort();
		setGenerationActive(false);
		dispatch({ type: "stop", generation });
		const pending = clientRef.current;
		if (pending === null) return;
		void pending.then((client) => client.stop(generation));
		clearStopTimer();
		/** If cleanup hangs, terminate the worker. The next run creates a new one. */
		stopTimerRef.current = setTimeout(() => {
			stopTimerRef.current = null;
			void pending.then((client) => client.terminate());
			clientRef.current = null;
			dispatch({ type: "stopped", generation });
		}, STOP_GRACE_MS);
	}, [clearStopTimer, generationRouter]);

	useEffect(
		() => () => {
			const generation = generationRef.current;
			generationRef.current = generation + 1;
			generationRouter.abort();
			clearStopTimer();
			const pending = clientRef.current;
			clientRef.current = null;
			if (pending === null) return;
			void pending.then((client) => {
				client.stop(generation);
				setTimeout(() => client.terminate(), STOP_GRACE_MS);
			});
		},
		[clearStopTimer, generationRouter],
	);

	const attachSurface = useCallback((element: HTMLDivElement | null) => {
		rendererRef.current?.dispose();
		rendererRef.current = null;
		if (element === null) return;
		rendererRef.current = createWebRuntimeRenderer({
			container: element,
			onAudioActivationChange: setAudioActivationRequired,
			dispatchEvent: (handlerId, payload, source) => {
				const generation = generationRef.current;
				void clientRef.current?.then((client) =>
					client.dispatchEvent(generation, handlerId, payload ?? null, source),
				);
			},
			/**
			 * The asset resolver comes from outside (`#/lib/runtime-assets`). This folder does not know the
			 * SDK, and the address rule must match the playback surface. If an image drawn in preview
			 * resolved to a different address after publishing, the creator would read their work as
			 * changed.
			 */
			resolveAsset: authorizeRuntimeAssetResolver(
				() => remoteAssetsRef.current,
				bindRuntimeAssetResolver(
					() => managedAssetsRef.current,
					(target) => resolveAssetRef.current(target),
				),
			),
		});
	}, []);

	const clearConsole = useCallback(
		() => setConsole(emptyRuntimePreviewConsole()),
		[],
	);

	return {
		state,
		console,
		storyState,
		persistentState,
		eligible,
		generationSupported: generationAdapter !== null,
		generationEnabled,
		setGenerationEnabled,
		generationActive,
		/**
		 * The two screen buttons pass the same function. Restart is a run that carries saved state over.
		 */
		run: runFresh,
		restart: runFresh,
		resetPlaythrough,
		resetPersistentState,
		stop,
		clearConsole,
		attachSurface,
		/**
		 * Whether the browser's autoplay policy is blocking sound: a fact the host draws. The renderer
		 * only computes this state and draws nothing, since that package has no React. It is carried up
		 * here because otherwise a creator sets `playing` and nothing happens, with no error. Creator
		 * code cannot set or clear this. It is an observation that `<Audio playing>` is on while the
		 * browser refused playback, and the host's button appears only while that holds. There is no
		 * timer-based retry to get around the policy. Such a retry either fails, or it succeeds and makes
		 * sound the user never allowed.
		 */
		audioActivationRequired,
		/**
		 * Called synchronously in the press. Moving it behind an async step would stop it counting as a
		 * user gesture.
		 */
		activateAudio: () => rendererRef.current?.activateAudio(),
	};
}
