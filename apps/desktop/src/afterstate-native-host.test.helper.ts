/** Test-only native regression reference. No production entry imports this file.
 * The packaged desktop uses afterstate-host.ts and its WASM Worker Thread. */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * The local afterstate index for the desktop window (conversation memory, `@rowcat/chat`'s
 * `conversation-memory.ts`).
 *
 * The engine runs as the bundled `afterstate-bridge` executable, one child process per member
 * store, speaking JSON lines over stdio. **No port is opened** (the stack's servers are the only
 * listeners), and a crash in native code takes down that child, not the app. Stores live in the
 * app's data folder (`afterstate/`, one file per member, named by the engine from the member key).
 *
 * The window reaches it through the preload (`preload.cts`) and the IPC handlers below, which only
 * answer the RowCat web origin of this stack and only the protocol's operations. The page could
 * already read the same conversations from its own IndexedDB, so this opens no new class of access;
 * the origin check keeps any other page from using it.
 *
 * **The engine is optional, and its failures stay here.** Every way it can fail — missing or not
 * executable, an older build that speaks another protocol, one that never answers, one killed
 * mid-session — ends in a rejected call, which the web app's loaders already turn into a turn
 * without recall (memory V2). None of them may throw in the main process, hold a call open forever,
 * or hold up quitting:
 *
 * - The handshake (`open`, then `status`) must name `AFTERSTATE_PROTOCOL` within `openTimeoutMs`;
 *   anything else is killed and refused. An older engine answering `ok` to everything would
 *   otherwise be handed the member's conversations.
 * - A call unanswered within `callTimeoutMs` kills that process: its state is unknown, and the next
 *   call starts a fresh one on the same store.
 * - A process that exits (killed, crashed) is forgotten, so the next call starts it again. Three
 *   failures within a minute pause that for a minute: a binary that dies on every start must not be
 *   spawned on every turn.
 * - Quitting ends stdin (the engine checkpoints and exits) and kills what has not exited after
 *   `closeTimeoutMs`, including a process still in its handshake.
 *
 * Found by the Phase 12 desktop window journey (`e2e/afterstate-window.e2e.ts`): before these rules
 * a killed engine stayed dead until the app restarted, an impostor answering `afterstate-bridge/0`
 * was accepted, and an engine that never answered made quitting hang.
 */

export const AFTERSTATE_PROTOCOL = "afterstate-bridge/1";

export const AFTERSTATE_OPS = new Set([
	"status",
	"consolidate",
	"facts",
	"digests",
	"check_versions",
	"ingest",
	"recall",
	"reconcile",
	"erase",
	"sweep",
	"verify",
	"checkpoint",
]);

export interface AfterstateTimeouts {
	/** Each handshake step (`open`, `status`). The engine opens its file and answers in milliseconds. */
	openTimeoutMs: number;
	/** One call. Ingest batches are 64 items (`CHAT_INDEX_BATCH`), far below this. */
	callTimeoutMs: number;
	/** From the end of stdin to exit, before the process is killed. */
	closeTimeoutMs: number;
}

export const AFTERSTATE_TIMEOUTS: AfterstateTimeouts = {
	openTimeoutMs: 10_000,
	callTimeoutMs: 30_000,
	closeTimeoutMs: 5_000,
};

/** Failures (refused handshakes, unexpected exits) of one member's engine that pause restarts. */
export const AFTERSTATE_FAILURE_LIMIT = 3;
export const AFTERSTATE_FAILURE_WINDOW_MS = 60_000;

interface Response {
	id: number;
	ok: boolean;
	result?: unknown;
	error?: { code: string; message: string };
}

const failure = (code: string, message: string): Response => ({
	id: 0,
	ok: false,
	error: { code, message },
});

/** One member's engine process. */
export class AfterstateProcess {
	private next = 1;
	private readonly pending = new Map<number, (r: Response) => void>();
	private exited = false;
	/** Set when the host ends the process on purpose (quit, destroy, a refused handshake, a timeout). */
	private ending = false;
	/** Resolves once the process is gone (or never started). */
	readonly whenExited: Promise<void>;

	private constructor(
		private readonly child: ChildProcessWithoutNullStreams,
		private readonly timeouts: AfterstateTimeouts,
		onUnexpectedExit: () => void,
	) {
		createInterface({ input: child.stdout }).on("line", (line) => {
			let response: Response;
			try {
				response = JSON.parse(line) as Response;
			} catch {
				return;
			}
			this.pending.get(response.id)?.(response);
			this.pending.delete(response.id);
		});
		let exited!: () => void;
		this.whenExited = new Promise((resolve) => {
			exited = resolve;
		});
		const end = () => {
			if (this.exited) return;
			this.exited = true;
			for (const resolve of this.pending.values())
				resolve(failure("closed", "engine exited"));
			this.pending.clear();
			exited();
			if (!this.ending) onUnexpectedExit();
		};
		child.on("exit", end);
		// A missing or non-executable file arrives here (ENOENT, EACCES), not as a throw from spawn.
		child.on("error", end);
		// Writing to an engine that just died is EPIPE; its exit settles the calls.
		child.stdin.on("error", () => {});
		// The engine writes nothing to stderr but a fixed broken-pipe line; drain it.
		child.stderr.resume();
	}

	/**
	 * Starts the engine on the member's store and checks that it speaks this protocol. Rejects, and
	 * leaves no process behind, otherwise.
	 */
	static async open(
		bridge: string,
		storeDir: string,
		memberKey: string,
		options: {
			timeouts?: AfterstateTimeouts;
			onUnexpectedExit?: () => void;
			onSpawn?: (process: AfterstateProcess) => void;
		} = {},
	): Promise<AfterstateProcess> {
		const timeouts = options.timeouts ?? AFTERSTATE_TIMEOUTS;
		const child = spawn(bridge, [], {
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		const host = new AfterstateProcess(
			child,
			timeouts,
			options.onUnexpectedExit ?? (() => {}),
		);
		options.onSpawn?.(host);
		const refuse = async (code: string): Promise<never> => {
			await host.kill();
			throw new Error(`afterstate open: ${code}`);
		};
		const opened = await host.send(
			"open",
			{ store: { user: { dir: storeDir, user: memberKey } } },
			timeouts.openTimeoutMs,
		);
		if (!opened.ok) return refuse(opened.error?.code ?? "failed");
		const status = await host.send("status", {}, timeouts.openTimeoutMs);
		if (!status.ok) return refuse(status.error?.code ?? "failed");
		const protocol = (status.result as { protocol?: unknown } | undefined)
			?.protocol;
		if (protocol !== AFTERSTATE_PROTOCOL) return refuse("incompatible");
		return host;
	}

	get pid(): number | undefined {
		return this.child.pid;
	}

	get running(): boolean {
		return !this.exited;
	}

	private send(
		op: string,
		params: object,
		timeoutMs: number,
	): Promise<Response> {
		if (this.exited) return Promise.resolve(failure("closed", "engine exited"));
		return new Promise((resolve) => {
			const id = this.next++;
			const timer = setTimeout(() => {
				if (!this.pending.delete(id)) return;
				resolve(failure("timeout", `no answer to ${op}`));
				// Its state is unknown now: end it as a failure, so the next call starts a fresh one.
				if (!this.exited) this.child.kill("SIGKILL");
			}, timeoutMs);
			this.pending.set(id, (response) => {
				clearTimeout(timer);
				resolve(response);
			});
			this.child.stdin.write(`${JSON.stringify({ id, op, params })}\n`);
		});
	}

	async call(op: string, params: object): Promise<unknown> {
		if (!AFTERSTATE_OPS.has(op)) throw new Error("afterstate: unknown op");
		const r = await this.send(op, params, this.timeouts.callTimeoutMs);
		if (!r.ok) throw new Error(`afterstate ${op}: ${r.error?.code ?? "error"}`);
		return r.result;
	}

	/** Closes the store, deletes its files and ends the process (account deletion). */
	async destroy(): Promise<void> {
		this.ending = true;
		const r = await this.send("destroy", {}, this.timeouts.callTimeoutMs);
		if (!r.ok)
			throw new Error(`afterstate destroy: ${r.error?.code ?? "error"}`);
	}

	/** Closes stdin; the engine checkpoints and exits. Killed if it has not after the timeout. */
	async close(): Promise<void> {
		this.ending = true;
		if (this.exited) return;
		this.child.stdin.end();
		let timer: NodeJS.Timeout | undefined;
		const late = new Promise<"late">((resolve) => {
			timer = setTimeout(() => resolve("late"), this.timeouts.closeTimeoutMs);
		});
		const outcome = await Promise.race([this.whenExited, late]);
		clearTimeout(timer);
		if (outcome === "late") await this.kill();
	}

	/** Ends the process now. */
	async kill(): Promise<void> {
		this.ending = true;
		if (this.exited) return;
		this.child.kill("SIGKILL");
		await this.whenExited;
	}
}

/** Member stores of this app, opened on demand and closed together on quit. */
export class AfterstateHosts {
	private readonly open = new Map<string, Promise<AfterstateProcess>>();
	/** Every process started and not exited yet: opened, or still in its handshake. */
	private readonly live = new Set<AfterstateProcess>();
	private readonly failures = new Map<string, number[]>();
	private closing = false;

	constructor(
		private readonly bridge: string,
		private readonly storeDir: string,
		private readonly timeouts: AfterstateTimeouts = AFTERSTATE_TIMEOUTS,
		private readonly now: () => number = Date.now,
	) {}

	private recentFailures(memberKey: string): number[] {
		const recent = (this.failures.get(memberKey) ?? []).filter(
			(at) => this.now() - at < AFTERSTATE_FAILURE_WINDOW_MS,
		);
		this.failures.set(memberKey, recent);
		return recent;
	}

	host(memberKey: string): Promise<AfterstateProcess> {
		const existing = this.open.get(memberKey);
		if (existing) return existing;
		if (this.closing) return Promise.reject(new Error("afterstate: closing"));
		if (this.recentFailures(memberKey).length >= AFTERSTATE_FAILURE_LIMIT)
			return Promise.reject(new Error("afterstate: unavailable"));
		let forgotten = false;
		const forget = () => {
			if (forgotten) return;
			forgotten = true;
			if (this.open.get(memberKey) === opening) this.open.delete(memberKey);
			this.recentFailures(memberKey).push(this.now());
		};
		const opening: Promise<AfterstateProcess> = AfterstateProcess.open(
			this.bridge,
			this.storeDir,
			memberKey,
			{
				timeouts: this.timeouts,
				onSpawn: (process) => {
					this.live.add(process);
					void process.whenExited.then(() => this.live.delete(process));
				},
				// Killed or crashed: the next call starts a fresh process.
				onUnexpectedExit: forget,
			},
		);
		this.open.set(memberKey, opening);
		opening.catch(forget);
		return opening;
	}

	/** Deletes a member's store (opening it first if needed: the engine owns the file name). */
	async destroy(memberKey: string): Promise<void> {
		const host = await this.host(memberKey);
		this.open.delete(memberKey);
		await host.destroy();
	}

	/** Ends every engine process, whatever state it is in; resolves when all have exited. */
	async closeAll(): Promise<void> {
		this.closing = true;
		this.open.clear();
		await Promise.allSettled([...this.live].map((p) => p.close()));
	}

	/** After `closeAll`, for a host that keeps serving (tests reopening the same stores). */
	reopen(): void {
		this.closing = false;
	}
}

/** What an IPC event tells us about its sender. */
export interface IpcSender {
	senderFrame?: { url: string } | null;
}

const isMemberKey = (v: unknown): v is string =>
	typeof v === "string" && v.length > 0 && v.length <= 256;

/**
 * The IPC handlers, independent of Electron so they can be tested: `call(event, memberKey, op,
 * params)`. Every request is checked: the sender frame must be the stack's web origin (not the
 * console, not a page the window navigated to), the op must be one of the protocol's, and the
 * params a plain object.
 */
export function afterstateIpc(
	hosts: AfterstateHosts,
	webOrigin: () => string | null,
): {
	call: (
		event: IpcSender,
		memberKey: unknown,
		op: unknown,
		params: unknown,
	) => Promise<unknown>;
	destroy: (event: IpcSender, memberKey: unknown) => Promise<void>;
} {
	const allowed = (event: IpcSender): boolean => {
		const origin = webOrigin();
		if (!origin || !event.senderFrame) return false;
		try {
			return new URL(event.senderFrame.url).origin === origin;
		} catch {
			return false;
		}
	};
	return {
		call: async (event, memberKey, op, params) => {
			if (!allowed(event)) throw new Error("afterstate: refused origin");
			if (!isMemberKey(memberKey)) throw new Error("afterstate: bad member");
			if (typeof op !== "string" || !AFTERSTATE_OPS.has(op))
				throw new Error("afterstate: unknown op");
			if (
				typeof params !== "object" ||
				params === null ||
				Array.isArray(params)
			)
				throw new Error("afterstate: bad params");
			const host = await hosts.host(memberKey);
			return host.call(op, params);
		},
		destroy: async (event, memberKey) => {
			if (!allowed(event)) throw new Error("afterstate: refused origin");
			if (!isMemberKey(memberKey)) throw new Error("afterstate: bad member");
			await hosts.destroy(memberKey);
		},
	};
}
