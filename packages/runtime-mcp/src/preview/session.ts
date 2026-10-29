import {
	CreatorExecutionError,
	emptyPersistentStateSnapshot,
	emptyStoryStateSnapshot,
	RuntimeHostError,
	type RuntimePersistentStateSnapshot,
	type RuntimeStoryStateSnapshot,
	type RuntimeVmSession,
} from "@rowcat/runtime-host";
import type { RuntimeMcpCompileResult } from "../compile.ts";
import { compileRuntimeDraft, shapeCompileResult } from "../compile.ts";
import { RUNTIME_MCP_ERROR_CODE, RuntimeMcpError } from "../errors.ts";
import { RUNTIME_MCP_LIMITS } from "../limits.ts";
import type { RuntimeMcpContext } from "../ports.ts";
import { type RuntimeMcpAction, RuntimeMcpTree } from "./tree.ts";

/**
 * One preview session that the agent drives. It follows the same sequence as the studio worker:
 *
 * - start: clean up the previous session, full compile, artifact, session (with save snapshot),
 *   mountRoot, running
 * - press: dispatchEvent(handlerId), settle, new revision
 * - input: dispatchEvent(handlerId, text), settle
 * - stop: unmountRoot (cleanup), settle, dispose
 *
 * Execution is still inside QuickJS. This process does not run creator code: no eval, no new
 * Function. It hands the artifact to the host and applies the returned patch bundles to the tree.
 * The worker is not isolation, and neither is this process; the VM is.
 *
 * Compile comes first, and if it fails no VM is created. An old artifact is never run silently.
 * compile_failed is a session state, and the tree in that state is not the previous successful
 * tree, because that session was already torn down.
 *
 * Creator failures do not kill the session. If rendering throws, no new commit goes out, so the
 * previous tree stays authoritative. That is why creatorError is a value attached alongside the
 * state, not a state of its own: the session stays running and the agent can keep reading the tree.
 * A session dies only from budget, memory, or engine failures.
 */

export type RuntimeMcpPreviewStatus =
	| "idle"
	| "compiling"
	| "starting"
	| "running"
	| "stopped"
	| "compile_failed"
	| "failed";

export interface RuntimeMcpConsoleEntry {
	/** Monotonically increasing sequence number. Pass it as `since`. No timestamp is included. */
	readonly seq: number;
	readonly level: "log" | "warn" | "error";
	/** Whether this came from console.* or is a diagnostic emitted by the runtime. */
	readonly source: "console" | "runtime";
	readonly text: string;
}

export interface RuntimeMcpPreviewFailure {
	readonly kind: "creator" | "host";
	readonly code: string | null;
	readonly message: string;
	readonly componentStack: readonly string[];
}

export interface RuntimeMcpPreviewStatusView {
	readonly draftId: string;
	readonly status: RuntimeMcpPreviewStatus;
	readonly generation: number;
	readonly revision: number;
	/**
	 * The session is alive, but creator code threw during the last operation. The tree is the one from
	 * before that operation.
	 */
	readonly creatorError: RuntimeMcpPreviewFailure | null;
	/** The failure that ended the session. Present only when the status is failed. */
	readonly failure: RuntimeMcpPreviewFailure | null;
	readonly compile: RuntimeMcpCompileResult | null;
	readonly consoleEntries: number;
	readonly generationEnabled: boolean;
}

const failureOf = (error: unknown): RuntimeMcpPreviewFailure => {
	if (error instanceof CreatorExecutionError)
		return {
			kind: "creator",
			code: error.runtimeCode,
			message: error.message,
			componentStack: [...error.componentStack],
		};
	if (error instanceof RuntimeHostError)
		return {
			kind: "host",
			code: error.code,
			message: error.message,
			componentStack: [],
		};
	/**
	 * Unnamed failure messages are replaced with our own wording, for the same reason as
	 * toRuntimeMcpError in errors.ts. An adapter once leaked credentials through a raw exception
	 * message.
	 */
	return {
		kind: "host",
		code: null,
		message: "The preview ended with an unexpected failure.",
		componentStack: [],
	};
};

const textOf = (args: readonly unknown[]): string => {
	const joined = args
		.map((value) =>
			typeof value === "string"
				? value
				: (JSON.stringify(value) ?? "undefined"),
		)
		.join(" ");
	return joined.length > RUNTIME_MCP_LIMITS.consoleEntryChars
		? `${joined.slice(0, RUNTIME_MCP_LIMITS.consoleEntryChars)}…`
		: joined;
};

export interface RuntimeMcpPreviewStartOptions {
	/** Clears this chapter and starts over (same axis as `Reset play`). */
	readonly resetStory?: boolean;
	/**
	 * Also clears long-lived progress. A debugging tool only; the product playthrough has no such
	 * operation.
	 */
	readonly resetPersistent?: boolean;
}

export class RuntimePreviewSession {
	readonly draftId: string;
	private readonly context: RuntimeMcpContext;
	private tree = new RuntimeMcpTree();
	private session: RuntimeVmSession | null = null;
	private status: RuntimeMcpPreviewStatus = "idle";
	private generation = 0;
	private creatorError: RuntimeMcpPreviewFailure | null = null;
	private failure: RuntimeMcpPreviewFailure | null = null;
	private compile: RuntimeMcpCompileResult | null = null;
	/**
	 * A protocol invariant was broken during commit application. Do not change state inside the
	 * callback. `onCommit` is a synchronous callback that must not re-enter the VM. If it ended the
	 * session there, that decision would land in the middle of an in-progress call. It only records
	 * the failure here, and the session is promoted at the end of the operation.
	 */
	private patchRejected: RuntimeMcpPreviewFailure | null = null;
	private storyState: RuntimeStoryStateSnapshot = emptyStoryStateSnapshot();
	private persistentState: RuntimePersistentStateSnapshot =
		emptyPersistentStateSnapshot();
	private consoleBuffer: RuntimeMcpConsoleEntry[] = [];
	private consoleSeq = 0;
	private consoleDropped = 0;
	/** The chain that start and stop run through. This alone keeps two sessions from overlapping. */
	private chain: Promise<void> = Promise.resolve();
	private touchedAt: number;

	constructor(context: RuntimeMcpContext, draftId: string) {
		this.context = context;
		this.draftId = draftId;
		this.touchedAt = context.host.now();
	}

	get lastActivityAt(): number {
		return this.touchedAt;
	}

	private touch(): void {
		this.touchedAt = this.context.host.now();
	}

	private push(
		level: RuntimeMcpConsoleEntry["level"],
		source: RuntimeMcpConsoleEntry["source"],
		text: string,
	): void {
		this.consoleSeq += 1;
		this.consoleBuffer.push({ seq: this.consoleSeq, level, source, text });
		while (this.consoleBuffer.length > RUNTIME_MCP_LIMITS.consoleBuffer) {
			this.consoleBuffer.shift();
			this.consoleDropped += 1;
		}
	}

	statusView(): RuntimeMcpPreviewStatusView {
		return {
			draftId: this.draftId,
			status: this.status,
			generation: this.generation,
			revision: this.tree.revision,
			creatorError: this.creatorError,
			failure: this.failure,
			compile: this.compile,
			consoleEntries: this.consoleBuffer.length,
			/**
			 * This preview has no generation capability, so it is left out of the table. See the generation
			 * note in node/host.ts.
			 */
			generationEnabled: false,
		};
	}

	/**
	 * Whether the session can accept operations right now. If not, the reason is stated in a sentence.
	 */
	private requireRunning(): RuntimeVmSession {
		if (this.session === null || this.status !== "running")
			throw new RuntimeMcpError(
				RUNTIME_MCP_ERROR_CODE.previewNotRunning,
				this.status === "compile_failed"
					? "Compilation failed, so the preview did not start. Fix the diagnostics and call preview_start again."
					: this.status === "failed"
						? "The preview ended in failure. Start it again with preview_start."
						: "The preview is not running. Call preview_start first.",
				{ status: this.status },
			);
		return this.session;
	}

	async start(
		options: RuntimeMcpPreviewStartOptions = {},
	): Promise<RuntimeMcpPreviewStatusView> {
		this.touch();
		const run = this.chain.then(() => this.startInner(options));
		this.chain = run.then(
			() => undefined,
			() => undefined,
		);
		await run;
		return this.statusView();
	}

	private async startInner(
		options: RuntimeMcpPreviewStartOptions,
	): Promise<void> {
		await this.stopInner();
		this.generation += 1;
		this.creatorError = null;
		this.failure = null;
		this.tree = new RuntimeMcpTree();
		/**
		 * Initialization happens before the session is created. If it were deferred, the hydration in
		 * between would read the old progress once, and that value would show up in the first tree.
		 */
		if (options.resetStory === true)
			this.storyState = emptyStoryStateSnapshot();
		if (options.resetPersistent === true)
			this.persistentState = emptyPersistentStateSnapshot();

		this.status = "compiling";
		const { result } = await compileRuntimeDraft(this.context, this.draftId);
		this.compile = shapeCompileResult(result);
		if (!result.ok) {
			this.status = "compile_failed";
			return;
		}

		this.status = "starting";
		let session: RuntimeVmSession;
		try {
			session = await this.context.host.createSession({
				artifact: result.artifact,
				onConsole: (level, args) => this.push(level, "console", textOf(args)),
				storyState: this.storyState,
				persistentState: this.persistentState,
				onStoryStateCommit: (snapshot) => {
					this.storyState = snapshot;
				},
				onPersistentStateCommit: (snapshot) => {
					this.persistentState = snapshot;
				},
			});
		} catch (error) {
			this.status = "failed";
			this.failure = failureOf(error);
			return;
		}
		this.session = session;
		/**
		 * The hydration result is the current snapshot, since a migration may have bumped the version.
		 */
		this.storyState = session.storyStateSnapshot();
		this.persistentState = session.persistentStateSnapshot();

		const mounted = await session.mountRoot({
			onCommit: (batch) => {
				try {
					this.tree.apply(batch);
				} catch (error) {
					/**
					 * A protocol invariant was broken. Accepting it leniently would show up later as 'the tree
					 * sometimes drifts'. Only a marker is recorded, and the session is ended where the operation
					 * finishes.
					 */
					this.patchRejected = {
						kind: "host",
						code: "runtime_patch_rejected",
						message:
							error instanceof Error
								? `Could not apply the patch bundle: ${error.message}`
								: "Could not apply the patch bundle.",
						componentStack: [],
					};
				}
			},
			/**
			 * Control commands. The tree only observes them. Headless has no layout, so no pixels are
			 * invented. What is recorded is the intent creator code requested and its target node.
			 */
			onCommands: (batch) => this.tree.applyCommands(batch),
			onDiagnostic: (diagnostic) =>
				this.push(
					diagnostic.kind === "creator" ? "error" : "warn",
					"runtime",
					`${diagnostic.code}: ${diagnostic.message}${
						diagnostic.component === null ? "" : ` (${diagnostic.component})`
					}`,
				),
			onRootError: (error) => {
				this.creatorError = failureOf(error);
				this.push("error", "runtime", this.creatorError.message);
			},
		});
		if (!mounted.ok) {
			this.creatorError = failureOf(mounted.error);
			if (session.state === "failed") {
				this.status = "failed";
				this.failure = this.creatorError;
				this.creatorError = null;
				this.session = null;
				await session.dispose();
				return;
			}
			/**
			 * Mounting failed with a creator exception. The session stays alive and the tree is empty. The
			 * status is set to running because the next preview_start is the normal recovery path.
			 */
			this.status = "running";
			return;
		}
		if (!this.promotePatchFailure()) this.status = "running";
	}

	/**
	 * Raises a recorded commit rejection into the session state. Returns true if it was raised. Called
	 * at the end of every operation, because a rejection can come from either mount or an event.
	 * Checking only one would leave the session accepting operations on a drifted tree.
	 */
	private promotePatchFailure(): boolean {
		const rejected = this.patchRejected;
		if (rejected === null) return false;
		this.patchRejected = null;
		this.status = "failed";
		this.failure = rejected;
		const session = this.session;
		this.session = null;
		if (session !== null) void session.dispose().catch(() => undefined);
		return true;
	}

	async stop(): Promise<RuntimeMcpPreviewStatusView> {
		this.touch();
		const run = this.chain.then(() => this.stopInner());
		this.chain = run.then(
			() => undefined,
			() => undefined,
		);
		await run;
		this.status = "stopped";
		return this.statusView();
	}

	/**
	 * Cleanup function, then settle, then dispose. The order is the whole guarantee: disposing first
	 * would prevent cleanup from running.
	 */
	private async stopInner(): Promise<void> {
		const session = this.session;
		if (session === null) return;
		this.session = null;
		try {
			if (session.state === "ready" || session.state === "running") {
				await session.unmountRoot();
				await session.settle();
			}
		} catch {
			/** Failures during cleanup do not block disposal. Leaving the VM alive costs more. */
		}
		await session.dispose();
	}

	async dispatch(
		nodeId: number,
		action: RuntimeMcpAction,
		text?: string,
	): Promise<{
		readonly handled: boolean;
		readonly reason?: string;
		readonly revision: number;
		readonly changed: boolean;
		readonly status: RuntimeMcpPreviewStatusView;
	}> {
		this.touch();
		const session = this.requireRunning();
		const handler = this.tree.handlerFor(nodeId, action);
		const before = this.tree.revision;
		this.creatorError = null;
		const outcome =
			text === undefined
				? await session.dispatchEvent(handler)
				: await session.dispatchEvent(handler, text);
		/** Waits for the commit to arrive. Without waiting, the agent would read the old tree. */
		await session.settle();
		if (this.promotePatchFailure())
			return {
				handled: false,
				reason: "patch_rejected",
				revision: this.tree.revision,
				changed: this.tree.revision !== before,
				status: this.statusView(),
			};
		if (!outcome.ok) {
			this.creatorError = failureOf(outcome.error);
			if (session.state === "failed") {
				this.status = "failed";
				this.failure = this.creatorError;
				this.creatorError = null;
				this.session = null;
				await session.dispose();
			}
			return {
				handled: false,
				reason: "creator_error",
				revision: this.tree.revision,
				changed: this.tree.revision !== before,
				status: this.statusView(),
			};
		}
		return {
			handled: outcome.handled,
			...(outcome.handled ? {} : { reason: outcome.reason }),
			revision: this.tree.revision,
			changed: this.tree.revision !== before,
			status: this.statusView(),
		};
	}

	treeSnapshot(): ReturnType<RuntimeMcpTree["snapshot"]> {
		this.touch();
		if (this.status !== "running") this.requireRunning();
		return this.tree.snapshot();
	}

	findByText(text: string): number | null {
		return this.tree.findByText(text);
	}

	consoleSince(options: {
		since?: number;
		limit?: number;
		level?: RuntimeMcpConsoleEntry["level"];
	}): {
		readonly entries: readonly RuntimeMcpConsoleEntry[];
		readonly dropped: number;
		readonly nextCursor: number;
		readonly more: boolean;
	} {
		this.touch();
		const since = options.since ?? 0;
		const limit = Math.min(
			RUNTIME_MCP_LIMITS.consolePage,
			Math.max(1, Math.trunc(options.limit ?? RUNTIME_MCP_LIMITS.consolePage)),
		);
		const matched = this.consoleBuffer.filter(
			(entry) =>
				entry.seq > since &&
				(options.level === undefined || entry.level === options.level),
		);
		const entries = matched.slice(0, limit);
		return {
			entries,
			dropped: this.consoleDropped,
			nextCursor: entries.at(-1)?.seq ?? since,
			more: matched.length > entries.length,
		};
	}

	stateSnapshot(): {
		readonly story: RuntimeStoryStateSnapshot;
		readonly persistent: RuntimePersistentStateSnapshot;
	} {
		this.touch();
		return { story: this.storyState, persistent: this.persistentState };
	}
}
