import type { RuntimeConsoleLevel } from "@rowcat/runtime-host/capabilities";
import type { RuntimeWireValue } from "@rowcat/runtime-host/wire";
import {
	createNativeRuntimeControlDeck,
	type NativeRuntimeControlDeck,
} from "@rowcat/runtime-renderer-native/control-deck";
import {
	createNativeRuntimeTreeStore,
	type NativeRuntimeTreeStore,
} from "@rowcat/runtime-renderer-native/tree-store";
import {
	createInteractionRecorder,
	type InteractionLatencySummary,
	summarizeInteractionLatency,
} from "./metrics.ts";
import type {
	NativeRuntimeGeneration,
	NativeRuntimeGenerationRequest,
	NativeRuntimeGenerationResult,
} from "./protocol.ts";
import {
	initialNativeRuntimeState,
	type NativeRuntimeAction,
	type NativeRuntimeState,
	nativeRuntimeReducer,
} from "./session-state.ts";
import type { NativeRuntimeTransport } from "./transport.ts";

/**
 * The native runtime session: the coordinator between the bridge and the host tree.
 *
 * - `start(artifact)` allocates a generation, clears the tree, and sends the artifact over the
 *   bridge.
 * - `dispatchEvent(handlerId, payload?)` records `t0` and sends the handler number (and text)
 *   over the bridge.
 * - A commit arriving over the bridge is applied atomically to the tree, `t1` is recorded, and
 *   React renders once.
 *
 * ## What this file does not know
 *
 * Studio, Monaco, the authoring store, autosave and the compiler. The input is an artifact that has
 * already been emitted. Building it is not this app's job, because mobile is the playback side.
 *
 * ## A stale generation is dropped, and restarts do not overlap
 *
 * If A's late commit were applied to B's tree, that screen would be wrong with no error. Messages
 * with a different generation touch neither state nor tree.
 *
 * The number must not be a counter that starts at 1. The coordinator can be re-created (leaving the
 * screen and coming back, or Fast Refresh in development), and a counter would then return to 1,
 * while the document inside the WebView and its session keep living. The new coordinator's
 * generation 1 would match the old session's 1. The last batch that old session emits while being
 * replaced (the cleanup's remove patches) would then apply to the new tree. Revisions would not
 * continue, and the renderer halts. This was the first defect seen on a real device: `patch batch
 * revision 3 does not follow 0`.
 *
 * So the seed is a clock. It is passed in as an argument so tests can read 1, 2, 3. The only
 * property required of this value is that, even when re-created, it never goes back to a number
 * already used.
 *
 * ## The store is taken through a subpath
 *
 * Importing the root of `@rowcat/runtime-renderer-native` would pull React Native into this file's
 * graph. The coordinator neither draws nor needs to: the tree store is pure, and turning it into a
 * screen is the surface's job (`NativeRuntimeSurface`). That split lets this file be tested without
 * a simulator, which the app's rule that tests do not render screens also requires.
 *
 * ## A renderer failure is a session failure
 *
 * If a patch batch does not fit the tree (a skipped revision, a missing node), later batches would
 * draw over a mismatched tree. There is no backtracking protocol, so the session stops rather than
 * recovers. Rewriting needs a new session.
 */

export interface NativeRuntimeConsoleLine {
	level: RuntimeConsoleLevel;
	args: RuntimeWireValue[];
}

/** The console is a capped list: it drops from the front and counts what it dropped (same rule as the web preview). */
const CONSOLE_LIMIT = 200;

export interface NativeRuntimeSessionOptions {
	transport: NativeRuntimeTransport;
	/**
	 * The canonical snapshot produced by hydration. It arrives before mount.
	 *
	 * The playback screen persists this into the product store (§84, §121). The diagnostic harness
	 * does not pass this handle, because that screen has no storage.
	 */
	onHydrated?(snapshots: {
		storyState: unknown;
		persistentState: unknown;
	}): void;
	/** A committed playthrough. It goes to the product store (§85). */
	onStoryState?(snapshot: unknown): void;
	/** A committed long progress. This is a **different handle**, because the two lifetimes are separate. */
	onPersistentState?(snapshot: unknown): void;
	/**
	 * Generation requests from creator code. A **trusted adapter answers** (§86).
	 *
	 * Without it, a request is rejected at once as `unavailable`. Silently dropping requests is not
	 * allowed: the VM's promise would never settle and the creator's code would stop at `await`.
	 */
	onGenerationRequest?(
		request: NativeRuntimeGenerationRequest,
		context: { signal: AbortSignal },
	): Promise<NativeRuntimeGenerationResult>;
	/** One Hermes clock. Both ends of a latency measurement must share one realm, or the latency is meaningless (`metrics.ts`). */
	now?: () => number;
	/**
	 * The seed for generation numbers. It defaults to the clock: even if the coordinator is
	 * re-created, it must not return to a number already used. Only tests pass this value.
	 */
	generationSeed?: number;
}

export interface NativeRuntimeSession {
	readonly store: NativeRuntimeTreeStore;
	/**
	 * Where scroll and focus commands reach the real view. The surface receives this value.
	 *
	 * This coordinator owns it, together with the store. If the screen owned it, pending commands
	 * would vanish each time the surface remounts, and that loss has no error.
	 */
	readonly controls: NativeRuntimeControlDeck;
	readonly transport: NativeRuntimeTransport;
	getState(): NativeRuntimeState;
	subscribe(listener: () => void): () => void;
	/**
	 * Sets up one artifact. If a session is already running, the harness cleans it up first.
	 *
	 * The save snapshots are **passed in by the caller**. This coordinator does not know the store
	 * (neither SQLite nor Dexie is in this file's graph). The diagnostic harness omits them, and the
	 * session then starts with empty snapshots.
	 */
	start(
		artifact: unknown,
		options?: {
			storyState?: unknown;
			persistentState?: unknown;
			generationEnabled?: boolean;
		},
	): void;
	stop(): void;
	/** One press. `t0` is recorded here. */
	dispatchEvent(handlerId: number, payload?: string): void;
	latency(warmup?: number): InteractionLatencySummary | null;
	resetMetrics(): void;
	console(): readonly NativeRuntimeConsoleLine[];
	/** The number of console lines discarded. */
	consoleDropped(): number;
	dispose(): void;
}

export function createNativeRuntimeSession(
	options: NativeRuntimeSessionOptions,
): NativeRuntimeSession {
	const { transport } = options;
	const now = options.now ?? Date.now;
	const store = createNativeRuntimeTreeStore();
	const controls = createNativeRuntimeControlDeck({ store });
	const recorder = createInteractionRecorder();
	const listeners = new Set<() => void>();

	let state: NativeRuntimeState = initialNativeRuntimeState;
	let generation: NativeRuntimeGeneration =
		options.generationSeed ?? Date.now();
	const firstGeneration = generation;
	let consoleLines: NativeRuntimeConsoleLine[] = [];
	let consoleDropped = 0;
	let disposed = false;

	const notify = (): void => {
		for (const listener of [...listeners]) listener();
	};

	const dispatch = (action: NativeRuntimeAction): void => {
		const next = nativeRuntimeReducer(state, action);
		if (next === state) return;
		state = next;
		notify();
	};

	/** Applies a commit to the tree. On failure the session stops; there is no recovery path. */
	const applyCommit = (
		commitGeneration: NativeRuntimeGeneration,
		batch: Parameters<NativeRuntimeTreeStore["apply"]>[0],
	): void => {
		try {
			store.apply(batch);
		} catch (error) {
			recorder.abandon();
			dispatch({
				type: "failed",
				generation: commitGeneration,
				failure: {
					stage: "renderer",
					message: error instanceof Error ? error.message : String(error),
				},
			});
			transport.send({ type: "stop", generation: commitGeneration });
			return;
		}
		/** `t1` is recorded **after** applying: not when the bridge delivers, but when the screen holds that tree. */
		recorder.commit(now());
		dispatch({
			type: "committed",
			generation: commitGeneration,
			revision: batch.revision,
		});
	};

	/**
	 * Abort handles for running generation requests. **All of them are aborted when the generation
	 * changes** (§87).
	 *
	 * Dropping late answers is not enough: the paid request keeps running to produce an answer that
	 * will be discarded. Aborting alone is not enough either: the abort may arrive late, or the send
	 * may already have finished. An answer that comes back then carries a different generation and
	 * reaches nothing. Both are needed.
	 */
	const openGenerations = new Map<number, AbortController>();

	function abortGenerations(): void {
		const open = [...openGenerations.values()];
		openGenerations.clear();
		for (const controller of open) controller.abort();
	}

	/**
	 * Sends one request to the trusted adapter and returns the answer over the bridge.
	 *
	 * **Never creates a request that gets no answer.** A missing or throwing adapter still returns a
	 * named reason. Silently dropping it would leave the VM's promise unsettled forever.
	 */
	function handleGenerationRequest(
		requestGeneration: NativeRuntimeGeneration,
		requestId: number,
		request: NativeRuntimeGenerationRequest,
	): void {
		const send = (result: NativeRuntimeGenerationResult): void => {
			/** Answers from an older generation are not sent: their promise was already settled as cancelled. */
			if (requestGeneration !== generation || disposed) return;
			transport.send({
				type: "runtime-host-result",
				generation: requestGeneration,
				requestId,
				result,
			});
		};
		const adapter = options.onGenerationRequest;
		if (adapter === undefined || requestGeneration !== generation) {
			send({
				ok: false,
				reason: "unavailable",
				message: "generation is not available",
			});
			return;
		}
		const controller = new AbortController();
		openGenerations.set(requestId, controller);
		void adapter(request, { signal: controller.signal }).then(
			(result) => {
				openGenerations.delete(requestId);
				send(result);
			},
			() => {
				openGenerations.delete(requestId);
				/**
				 * The adapter ended in **rejection**, so the exception stops here. Not including
				 * `error.message` is what keeps the leak closed in Phase 6C from reopening (§88).
				 */
				send({
					ok: false,
					reason: "failed",
					message: "generation failed",
				});
			},
		);
	}

	const unsubscribe = transport.subscribe((event) => {
		if (disposed) return;
		if (event.type === "transport-failed") {
			recorder.abandon();
			dispatch({ type: "transportFailed", reason: event.reason });
			return;
		}
		const message = event.message;
		switch (message.type) {
			case "ready":
			case "poc-step":
			case "poc-report":
			case "poc-failure":
			case "host-call":
				/** This is the PoC diagnostic's conversation, not this session's. */
				return;
			case "started":
				dispatch({
					type: "started",
					generation: message.generation,
					remoteAssets: message.remoteAssets,
				});
				return;
			case "commit":
				if (message.generation !== generation) return;
				applyCommit(message.generation, message.batch);
				return;
			/**
			 * Control commands. The deck checks the revision and discards on mismatch. **It does not stop
			 * the session on failure**, which is where this differs from a commit: a command is intent, not
			 * tree state, and one missed scroll is no reason to end playback.
			 */
			case "commands":
				if (message.generation !== generation) return;
				controls.apply(message.batch);
				return;
			case "console": {
				if (message.generation !== generation) return;
				consoleLines = [
					...consoleLines,
					{ level: message.level, args: message.args },
				];
				if (consoleLines.length > CONSOLE_LIMIT) {
					consoleDropped += consoleLines.length - CONSOLE_LIMIT;
					consoleLines = consoleLines.slice(-CONSOLE_LIMIT);
				}
				notify();
				return;
			}
			case "diagnostic":
				if (message.generation !== generation) return;
				consoleLines = [
					...consoleLines,
					{
						level: message.diagnostic.kind === "warning" ? "warn" : "error",
						args: [message.diagnostic.code, message.diagnostic.message],
					},
				];
				if (consoleLines.length > CONSOLE_LIMIT) {
					consoleDropped += consoleLines.length - CONSOLE_LIMIT;
					consoleLines = consoleLines.slice(-CONSOLE_LIMIT);
				}
				notify();
				return;
			case "root-error":
				if (message.work === "event") recorder.abandon();
				dispatch({
					type: "rootError",
					generation: message.generation,
					error: message.error,
					work: message.work,
				});
				return;
			case "failed":
				recorder.abandon();
				dispatch({
					type: "failed",
					generation: message.generation,
					failure: message.failure,
				});
				return;
			case "stopped":
				dispatch({ type: "stopped", generation: message.generation });
				return;
			case "hydrated":
				if (message.generation !== generation) return;
				options.onHydrated?.({
					storyState: message.storyState,
					persistentState: message.persistentState,
				});
				return;
			case "story-state":
				if (message.generation !== generation) return;
				options.onStoryState?.(message.snapshot);
				return;
			case "persistent-state":
				if (message.generation !== generation) return;
				options.onPersistentState?.(message.snapshot);
				return;
			case "runtime-host-call":
				handleGenerationRequest(message.generation, message.requestId, {
					messages: message.request.messages,
					instructions: message.request.instructions,
					maxOutputCharacters: message.request.maxOutputCharacters,
				});
				return;
		}
	});

	return {
		store,
		controls,
		transport,
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		start(artifact, startOptions) {
			if (disposed) return;
			generation += 1;
			abortGenerations();
			recorder.abandon();
			consoleLines = [];
			consoleDropped = 0;
			/** The new session receives revision 1 on an empty tree: the id space starts over too. */
			store.reset();
			dispatch({ type: "start", generation });
			transport.send({
				type: "start",
				generation,
				artifact,
				...(startOptions?.storyState === undefined
					? {}
					: { storyState: startOptions.storyState }),
				...(startOptions?.persistentState === undefined
					? {}
					: { persistentState: startOptions.persistentState }),
				...(startOptions?.generationEnabled === undefined
					? {}
					: { generationEnabled: startOptions.generationEnabled }),
			});
		},
		stop() {
			if (disposed || generation === firstGeneration) return;
			abortGenerations();
			recorder.abandon();
			dispatch({ type: "stop", generation });
			transport.send({ type: "stop", generation });
		},
		dispatchEvent(handlerId, payload) {
			if (disposed) return;
			if (state.status !== "running" || store.failed) return;
			recorder.begin(now());
			transport.send({
				type: "event",
				generation,
				handlerId,
				...(payload === undefined ? {} : { payload }),
			});
		},
		latency(warmup = 0) {
			return summarizeInteractionLatency(recorder.samples, warmup);
		},
		resetMetrics() {
			recorder.reset();
			notify();
		},
		console: () => consoleLines,
		consoleDropped: () => consoleDropped,
		dispose() {
			if (disposed) return;
			disposed = true;
			abortGenerations();
			unsubscribe();
			transport.close();
			controls.dispose();
			store.dispose();
			listeners.clear();
		},
	};
}
