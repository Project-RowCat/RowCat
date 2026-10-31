import type { RuntimeConsoleLevel } from "@rowcat/runtime-host/capabilities";
import { RUNTIME_HOST_ERROR_CODE } from "@rowcat/runtime-host/errors";
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
	NATIVE_RUNTIME_LIVENESS_POLICY,
	type NativeRuntimeLivenessPolicy,
	nativeRuntimeLivenessVerdict,
} from "./liveness.ts";
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
import type {
	NativeRuntimeTransport,
	NativeRuntimeTransportEvent,
} from "./transport.ts";

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
 *
 * ## A silent harness is dropped, not waited on
 *
 * The VM budget cannot interrupt a single long native builtin call, so a story can keep the
 * WebView's thread busy indefinitely while every turn it eventually finishes reports success. With
 * `liveness`, this coordinator pings a quiet document and, past the bound (`liveness.ts`), fails the
 * session with the budget code and gives up that bridge. `renewTransport` hands over a fresh one, so
 * the screen remounts the WebView and the next start lands in a new realm. A clock that paused (the
 * app in the background, a locked screen) is not silence: `liveness.ts` asks again instead.
 *
 * ## A bridge is renewed only where that can help, and not without end
 *
 * The view keys the WebView on the transport, so every renewal mounts a WebView and loads the
 * harness. A host that fails on load (Android without the port features, a missing asset, an iOS
 * document that cannot load) fails each one it is given, and renewing on every failure re-created
 * WebViews for as long as the screen stayed open. So:
 *
 * ```text
 * unresponsive                         renewed now — that bridge stood; the hung realm must go
 * died after it stood, session live    renewed now — the session dies with it, a restart needs a realm
 * died after it stood, nothing live    renewed by the next start, not before
 * died before it ever stood            not renewed now: the bridge is unavailable and the session
 *                                      fails at the transport stage (a press may retry, below)
 * ```
 *
 * A start may renew a bridge that never stood, but only while fewer than
 * `UNSTOOD_BRIDGE_LIMIT` bridges in a row failed that way; past it the start fails at once with the
 * last reason. Without `renewTransport` (the diagnostic labs) a start on a dead bridge fails the same
 * way instead of waiting in `starting` forever.
 *
 * ## Commits are acknowledged after the tree holds them
 *
 * `commit-ack` is the harness's backpressure (`commit-window.ts`). It goes out after `apply`, for
 * this generation only, and never for a batch the tree refused.
 *
 * ## A stopping session takes no new paid request
 *
 * Restart and reset emit their transition before the old owner stops, and a press that reached the
 * VM just before can post its generation request afterwards — under the old generation number,
 * which the number check alone accepted. Only a `starting` or `running` session of that generation
 * reaches the adapter; anything later is answered `cancelled` and never leaves the device.
 */

export interface NativeRuntimeConsoleLine {
	level: RuntimeConsoleLevel;
	args: RuntimeWireValue[];
}

/** The console is a capped list: it drops from the front and counts what it dropped (same rule as the web preview). */
const CONSOLE_LIMIT = 200;

/**
 * Consecutive bridges that may fail before ever standing: the first, and one renewal a press asks
 * for. A device that cannot stand the port answers the same every time, and each try is a WebView.
 */
const UNSTOOD_BRIDGE_LIMIT = 2;

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
	 * The liveness watchdog's timer. Absent, there is no watchdog (the diagnostic labs). The product
	 * playback path always passes it: that is where someone else's code runs.
	 */
	liveness?: {
		policy?: NativeRuntimeLivenessPolicy;
		setInterval(callback: () => void, ms: number): unknown;
		clearInterval(handle: unknown): void;
		/**
		 * Whether the app is in the foreground. Away from it nothing is judged and the clock starts over
		 * on return: iOS can keep Hermes timers running briefly after backgrounding while the WebView
		 * content process is already suspended, so a ping there goes unanswered for a reason that says
		 * nothing about the harness. Absent, the app is taken to be in the foreground.
		 */
		foreground?: () => boolean;
	};
	/**
	 * A fresh bridge after this one died or was dropped as unresponsive. The view keys the WebView on
	 * the transport, so a new transport is a new realm — which is also why renewal is bounded (see
	 * the header): each call mounts a WebView.
	 */
	renewTransport?: () => NativeRuntimeTransport;
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
	/** The current bridge. It changes only when the previous one died or was dropped (`renewTransport`). */
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
	/**
	 * One press, or with `source: "media"` one event the platform raised by itself (a sound ending),
	 * which interaction-only capabilities refuse. `t0` is recorded here.
	 */
	dispatchEvent(
		handlerId: number,
		payload?: string,
		source?: "interaction" | "media",
	): void;
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
	let transport = options.transport;
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
		syncWatchdog();
		notify();
	};

	/* ── Liveness ─────────────────────────────────────────────────────────── */

	const liveness = options.liveness;
	const livenessPolicy = liveness?.policy ?? NATIVE_RUNTIME_LIVENESS_POLICY;
	let watchdog: unknown = null;
	let lastHeardAt = 0;
	let lastPingAt: number | null = null;
	let firstPingAt: number | null = null;
	let lastTickAt = 0;
	let lastReceived = 0;
	/** Since when this session has waited, foregrounded and ticking, for its document to stand. */
	let unreadySince: number | null = null;

	/** Heard from (or starting over): the silence and the pings that asked about it are gone. */
	function heard(at: number): void {
		lastHeardAt = at;
		lastPingAt = null;
		firstPingAt = null;
	}

	function ping(at: number): void {
		lastPingAt = at;
		firstPingAt ??= at;
		transport.send({ type: "hello" });
	}

	/** Something can hang only while a session is alive in the harness. */
	const watched = (): boolean =>
		state.status === "starting" ||
		state.status === "running" ||
		state.status === "stopping";

	function syncWatchdog(): void {
		if (liveness === undefined) return;
		const armed = watchdog !== null;
		if (watched() && !disposed && !armed) {
			const at = now();
			heard(at);
			lastTickAt = at;
			lastReceived = transport.received;
			watchdog = liveness.setInterval(
				tick,
				Math.max(1, Math.floor(livenessPolicy.pingAfterMs / 2)),
			);
		} else if ((!watched() || disposed) && armed) {
			liveness.clearInterval(watchdog);
			watchdog = null;
		}
	}

	function tick(): void {
		if (disposed || !watched()) return;
		const at = now();
		const previousTick = lastTickAt;
		lastTickAt = at;
		/**
		 * Not judged before the document stands (a cold WebView parsing the harness is not a hung VM,
		 * and nothing could answer a ping before `ready` anyway), nor away from the foreground.
		 */
		const foreground = liveness?.foreground?.() !== false;
		if (!transport.ready) {
			lastReceived = transport.received;
			heard(at);
			const paused =
				!foreground || at - previousTick >= livenessPolicy.gapAfterMs;
			unreadySince = paused ? at : (unreadySince ?? at);
			if (at - unreadySince >= livenessPolicy.standAfterMs) unstandable();
			return;
		}
		unreadySince = null;
		if (transport.received !== lastReceived || !foreground) {
			lastReceived = transport.received;
			heard(at);
			return;
		}
		const verdict = nativeRuntimeLivenessVerdict(
			at,
			{ lastHeardAt, lastPingAt, firstPingAt, lastTickAt: previousTick },
			livenessPolicy,
		);
		switch (verdict) {
			case "quiet":
				return;
			case "resume":
				heard(at);
				ping(at);
				return;
			case "ping":
				ping(at);
				return;
			case "unresponsive":
				unresponsive();
				return;
		}
	}

	/**
	 * The harness stopped answering. Its thread is stuck in something the VM budget cannot interrupt,
	 * so the realm itself is dropped: the bridge first (so the screen's next render already holds the
	 * fresh one), then the failure, carrying the budget code the VM would have reported had it been
	 * able to.
	 */
	function unresponsive(): void {
		const failedGeneration = generation;
		abortGenerations();
		recorder.abandon();
		retireTransport();
		closedReason = "runtime_unresponsive";
		/** This bridge stood (the watchdog judges only a ready one), so the renewal is not a load loop. */
		unstoodBridges = 0;
		renewTransport();
		dispatch({
			type: "failed",
			generation: failedGeneration,
			failure: {
				stage: "runtime",
				error: {
					kind: "host",
					name: "RuntimeHostError",
					message: "the runtime stopped responding",
					code: RUNTIME_HOST_ERROR_CODE.executionBudgetExceeded,
					componentStack: [],
				},
			},
		});
	}

	/**
	 * The document never stood within `standAfterMs`. It is a bridge that never stood, so it is not
	 * renewed (renewing is what loops when the realm cannot be had): the session fails at the transport
	 * stage, and a press may retry within `UNSTOOD_BRIDGE_LIMIT`.
	 */
	function unstandable(): void {
		unreadySince = null;
		unstoodBridges += 1;
		closedReason = "runtime_harness_unready";
		recorder.abandon();
		abortGenerations();
		retireTransport();
		dispatch({ type: "transportFailed", reason: closedReason });
	}

	let unsubscribe: () => void = () => {};
	/** Bridges in a row that failed before ever standing (`UNSTOOD_BRIDGE_LIMIT`). */
	let unstoodBridges = 0;
	/** Why the current bridge is closed, for a start that cannot renew it. */
	let closedReason = "transport_closed";

	/** Gives up the current bridge. It stays `transport` (closed) until something renews it. */
	function retireTransport(): void {
		unsubscribe();
		unsubscribe = () => {};
		transport.close();
	}

	function canRenew(): boolean {
		return (
			options.renewTransport !== undefined &&
			unstoodBridges < UNSTOOD_BRIDGE_LIMIT
		);
	}

	/** The next bridge takes the retired one's place; the view mounts a new WebView for it. */
	function renewTransport(): void {
		const renew = options.renewTransport;
		if (renew === undefined) return;
		transport = renew();
		unsubscribe = transport.subscribe(onTransportEvent);
	}

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
		transport.send({
			type: "commit-ack",
			generation: commitGeneration,
			revision: batch.revision,
		});
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
		/** Stopping, stopped or failed: the request is answered and never reaches a provider. */
		if (
			(state.status !== "starting" && state.status !== "running") ||
			state.generation !== requestGeneration
		) {
			send({ ok: false, reason: "cancelled", message: "player stopped" });
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

	function onTransportEvent(event: NativeRuntimeTransportEvent): void {
		if (disposed) return;
		if (event.type === "transport-failed") {
			/** `ready` outlives `fail`: it says whether this bridge ever stood. */
			const stood = transport.ready;
			unstoodBridges = stood ? 0 : unstoodBridges + 1;
			closedReason = event.reason;
			const live = watched();
			recorder.abandon();
			abortGenerations();
			retireTransport();
			if (stood && live && canRenew()) renewTransport();
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
	}
	unsubscribe = transport.subscribe(onTransportEvent);

	return {
		store,
		controls,
		get transport() {
			return transport;
		},
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
			/** Renewed before the transition, so the render it causes already mounts the new WebView. */
			if (transport.closed && canRenew()) {
				retireTransport();
				renewTransport();
			}
			if (transport.closed) {
				/** Nothing would ever answer: fail now rather than wait in `starting`. */
				dispatch({ type: "start", generation });
				dispatch({ type: "transportFailed", reason: closedReason });
				return;
			}
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
			/** Already asked: restart's transition and the lifecycle's retire both reach here. */
			if (state.status === "stopping" && state.generation === generation)
				return;
			abortGenerations();
			recorder.abandon();
			dispatch({ type: "stop", generation });
			transport.send({ type: "stop", generation });
		},
		dispatchEvent(handlerId, payload, source) {
			if (disposed) return;
			if (state.status !== "running" || store.failed) return;
			recorder.begin(now());
			transport.send({
				type: "event",
				generation,
				handlerId,
				...(payload === undefined ? {} : { payload }),
				...(source === "media" ? { source } : {}),
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
			syncWatchdog();
			abortGenerations();
			unsubscribe();
			transport.close();
			controls.dispose();
			store.dispose();
			listeners.clear();
		},
	};
}
