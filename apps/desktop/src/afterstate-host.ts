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
 */

export const AFTERSTATE_OPS = new Set([
	"status",
	"ingest",
	"recall",
	"reconcile",
	"erase",
	"sweep",
	"verify",
	"checkpoint",
]);

interface Response {
	id: number;
	ok: boolean;
	result?: unknown;
	error?: { code: string; message: string };
}

/** One member's engine process. */
export class AfterstateProcess {
	private next = 1;
	private readonly pending = new Map<number, (r: Response) => void>();
	private exited = false;

	private constructor(private readonly child: ChildProcessWithoutNullStreams) {
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
		child.on("exit", () => {
			this.exited = true;
			for (const resolve of this.pending.values())
				resolve({
					id: 0,
					ok: false,
					error: { code: "closed", message: "engine exited" },
				});
			this.pending.clear();
		});
		// The engine writes nothing to stderr but a fixed broken-pipe line; drain it.
		child.stderr.resume();
	}

	static async open(
		bridge: string,
		storeDir: string,
		memberKey: string,
	): Promise<AfterstateProcess> {
		const child = spawn(bridge, [], {
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		const host = new AfterstateProcess(child);
		const opened = await host.send("open", {
			store: { user: { dir: storeDir, user: memberKey } },
		});
		if (!opened.ok) {
			child.kill();
			throw new Error(`afterstate open: ${opened.error?.code ?? "failed"}`);
		}
		return host;
	}

	private send(op: string, params: object): Promise<Response> {
		if (this.exited)
			return Promise.resolve({
				id: 0,
				ok: false,
				error: { code: "closed", message: "engine exited" },
			});
		return new Promise((resolve) => {
			const id = this.next++;
			this.pending.set(id, resolve);
			this.child.stdin.write(`${JSON.stringify({ id, op, params })}\n`);
		});
	}

	async call(op: string, params: object): Promise<unknown> {
		if (!AFTERSTATE_OPS.has(op)) throw new Error("afterstate: unknown op");
		const r = await this.send(op, params);
		if (!r.ok) throw new Error(`afterstate ${op}: ${r.error?.code ?? "error"}`);
		return r.result;
	}

	/** Closes the store, deletes its files and ends the process (account deletion). */
	async destroy(): Promise<void> {
		const r = await this.send("destroy", {});
		if (!r.ok)
			throw new Error(`afterstate destroy: ${r.error?.code ?? "error"}`);
	}

	/** Closes stdin; the engine checkpoints and exits. */
	close(): Promise<void> {
		if (this.exited) return Promise.resolve();
		return new Promise((resolve) => {
			this.child.once("exit", () => resolve());
			this.child.stdin.end();
		});
	}
}

/** Member stores of this app, opened on demand and closed together on quit. */
export class AfterstateHosts {
	private readonly open = new Map<string, Promise<AfterstateProcess>>();

	constructor(
		private readonly bridge: string,
		private readonly storeDir: string,
	) {}

	host(memberKey: string): Promise<AfterstateProcess> {
		let host = this.open.get(memberKey);
		if (!host) {
			host = AfterstateProcess.open(this.bridge, this.storeDir, memberKey);
			this.open.set(memberKey, host);
			host.catch(() => this.open.delete(memberKey));
		}
		return host;
	}

	/** Deletes a member's store (opening it first if needed: the engine owns the file name). */
	async destroy(memberKey: string): Promise<void> {
		const host = await this.host(memberKey);
		this.open.delete(memberKey);
		await host.destroy();
	}

	async closeAll(): Promise<void> {
		const hosts = [...this.open.values()];
		this.open.clear();
		await Promise.allSettled(hosts.map(async (h) => (await h).close()));
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
