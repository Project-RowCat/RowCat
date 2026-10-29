import { RUNTIME_MCP_ERROR_CODE, RuntimeMcpError } from "../errors.ts";
import { RUNTIME_MCP_LIMITS } from "../limits.ts";
import type { RuntimeMcpContext } from "../ports.ts";
import {
	type RuntimeMcpPreviewStartOptions,
	type RuntimeMcpPreviewStatusView,
	RuntimePreviewSession,
} from "./session.ts";

/**
 * The preview one connection holds. There is always at most one, and it disappears when left alone.
 *
 * - One, because a session is one WASM instance whose memory belongs to this process, and an
 *   agent works on one project at a time. Allowing two would let forgotten VMs pile up. A
 *   preview_start for another draft cleans up the earlier session before starting; it does not
 *   reject. Rejecting would require agents to memorize a preview_stop-first procedure.
 * - Idle cleanup is scheduled, not a side effect of the next call. The earlier design swept only
 *   on the next tool call, so a connection that stopped calling tools kept its WASM session
 *   indefinitely. The host's schedule() now arms a real timer.
 * - The timer is a verdict, not an execution. When it wakes, it checks the last operation time
 *   and re-arms for the remaining time if it is not yet idle. Re-arming on every operation is
 *   avoided: each session operation would then need its own callback, and one missed callback would
 *   fail to extend the lifetime.
 * - A stale timer cannot kill a new session. Each timer holds the session it was armed for and
 *   checks identity before acting.
 * - Operations that extend the lifetime are those that use the session: start, restart, stop,
 *   reading the tree, press, input, submit, and reading console or save state. preview_status does
 *   not, because it is observation, and polling alone must not keep a forgotten VM alive.
 * - Save snapshots are bound to the draft. Restart continues the chapter because the snapshot
 *   outlives the session. If the draft changes, the snapshot is discarded so one work's progress
 *   never carries into another. The snapshot is the authoring tool's memory, not the product's
 *   save, and it is lost when the process ends.
 */
export class RuntimePreviewManager {
	private readonly context: RuntimeMcpContext;
	private session: RuntimePreviewSession | null = null;
	/** Cancel function for the idle timer. null when there is no session. */
	private cancelIdle: (() => void) | null = null;
	/**
	 * An unfinished disposal. disposeAll waits on this. Idle cleanup starts inside a timer callback,
	 * so nothing awaits it. If it were not held here, a failure would become an unhandled rejection,
	 * and shutdown could finish before the VM is released.
	 */
	private pending: Promise<void> = Promise.resolve();

	constructor(context: RuntimeMcpContext) {
		this.context = context;
	}

	/** The current session, or null. This call does not extend the session's lifetime. */
	current(): RuntimePreviewSession | null {
		this.sweep();
		return this.session;
	}

	/**
	 * Second line of defense, for when scheduling fails to arm. It stays even when scheduling works,
	 * because the check costs nothing. Without it, an idle session would remain forever in any
	 * environment where scheduling fails, and that failure produces no symptom.
	 */
	private sweep(): void {
		const session = this.session;
		if (session === null) return;
		if (this.context.host.now() - session.lastActivityAt < this.idleMs) return;
		this.release(session);
	}

	private get idleMs(): number {
		return RUNTIME_MCP_LIMITS.previewIdleMs;
	}

	/** Releases the session. Idempotent, and disposal failures do not escape. */
	private release(session: RuntimePreviewSession): void {
		if (this.session !== session) return;
		this.session = null;
		this.disarm();
		this.track(session.stop());
	}

	private disarm(): void {
		this.cancelIdle?.();
		this.cancelIdle = null;
	}

	private track(work: Promise<unknown>): void {
		this.pending = this.pending.then(() =>
			work.then(
				() => undefined,
				() => undefined,
			),
		);
	}

	/** Arms the idle check. Clears any existing arm first, so two timers cannot both stay alive. */
	private arm(session: RuntimePreviewSession): void {
		this.disarm();
		this.cancelIdle = this.context.host.schedule(
			() => this.onIdleTick(session),
			this.idleMs,
		);
	}

	/**
	 * The timer woke. Asks again whether the session is really idle. If there was activity, it re-arms
	 * for the time remaining from the last operation. This re-arming replaces attaching a timer to
	 * every operation.
	 */
	private onIdleTick(expected: RuntimePreviewSession): void {
		this.cancelIdle = null;
		if (this.session !== expected) return;
		const remaining =
			expected.lastActivityAt + this.idleMs - this.context.host.now();
		if (remaining > 0) {
			this.cancelIdle = this.context.host.schedule(
				() => this.onIdleTick(expected),
				remaining,
			);
			return;
		}
		this.release(expected);
	}

	async start(
		draftId: string,
		options: RuntimeMcpPreviewStartOptions = {},
	): Promise<RuntimeMcpPreviewStatusView> {
		this.sweep();
		const existing = this.session;
		if (existing !== null && existing.draftId !== draftId) {
			this.session = null;
			this.disarm();
			await existing.stop();
		}
		const session =
			this.session ?? new RuntimePreviewSession(this.context, draftId);
		this.session = session;
		this.arm(session);
		return session.start(options);
	}

	/**
	 * Rebuilds the session from the current source. The chapter carries over unless resetStory clears
	 * it.
	 */
	async restart(
		options: RuntimeMcpPreviewStartOptions = {},
	): Promise<RuntimeMcpPreviewStatusView> {
		const session = this.require();
		/**
		 * A restart is a new lifetime. Leaving the earlier timer in place would run the verdict once more
		 * at its old time.
		 */
		this.arm(session);
		return session.start(options);
	}

	async stop(): Promise<RuntimeMcpPreviewStatusView> {
		const session = this.require();
		this.session = null;
		this.disarm();
		return session.stop();
	}

	require(): RuntimePreviewSession {
		this.sweep();
		if (this.session === null)
			throw new RuntimeMcpError(
				RUNTIME_MCP_ERROR_CODE.previewNotRunning,
				"There is no preview. Call preview_start first.",
			);
		return this.session;
	}

	status(): RuntimeMcpPreviewStatusView | null {
		return this.current()?.statusView() ?? null;
	}

	/**
	 * Connection closed: releases any remaining VM. Idempotent, and also clears the scheduled idle
	 * check.
	 */
	async disposeAll(): Promise<void> {
		const session = this.session;
		this.session = null;
		this.disarm();
		if (session !== null) this.track(session.stop());
		await this.pending;
	}
}
