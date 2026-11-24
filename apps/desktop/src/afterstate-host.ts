/**
 * Main owns member authorization and a bounded request queue. The dedicated worker
 * owns WASM, encrypted snapshots and all synchronous indexing. A timeout/crash
 * rejects every queued call; the next call gets a fresh, verified instance. No
 * request is retried after an uncertain write, and recall waits for live manifests.
 * Native open/close/destroy are lifecycle operations, never forwarded as WASM ops.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { AFTERSTATE_PROTOCOL } from "./afterstate-artifact.ts";
import type { AfterstateWorkerData } from "./afterstate-worker.ts";

export { AFTERSTATE_PROTOCOL } from "./afterstate-artifact.ts";
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
export const AFTERSTATE_FAILURE_LIMIT = 3;
export const AFTERSTATE_FAILURE_WINDOW_MS = 60_000;
export const AFTERSTATE_TIMEOUTS = {
	openTimeoutMs: 60_000,
	callTimeoutMs: 30_000,
	closeTimeoutMs: 5_000,
};
export type AfterstateTimeouts = typeof AFTERSTATE_TIMEOUTS;
export const AFTERSTATE_LIMITS = {
	requests: 32,
	bytes: 32 * 1024 * 1024,
	members: 2,
	memoryBytes: 768 * 1024 * 1024,
};

interface Response {
	id: number;
	ok: boolean;
	result?: unknown;
	error?: { code?: string };
}
interface Request {
	id: number;
	op: string;
	params: object;
	bytes: number;
	resolve(value: unknown): void;
	reject(reason: unknown): void;
	timer: NodeJS.Timeout;
}
export interface AfterstateWorkerOptions {
	artifactDir: string;
	snapshot: AfterstateWorkerData["snapshot"];
	workerEntry?: URL;
	timeouts?: AfterstateTimeouts;
	memoryLimitBytes?: number;
	onExit?(): void;
	onRecovery?(): void;
}

export class AfterstateWorker {
	private readonly worker: Worker;
	private readonly requests: Request[] = [];
	private active: Request | undefined;
	private bytes = 0;
	private nextId = 0;
	private ending = false;
	private exited = false;
	private readonly timeouts: AfterstateTimeouts;
	readonly whenExited: Promise<void>;
	private readonly ready: Promise<void>;

	constructor(options: AfterstateWorkerOptions) {
		this.timeouts = options.timeouts ?? AFTERSTATE_TIMEOUTS;
		this.worker = new Worker(
			options.workerEntry ??
				new URL("./afterstate-worker.mjs", import.meta.url),
			{
				workerData: {
					artifactDir: options.artifactDir,
					snapshot: options.snapshot,
					memoryLimitBytes:
						options.memoryLimitBytes ?? AFTERSTATE_LIMITS.memoryBytes,
				} satisfies AfterstateWorkerData,
				resourceLimits: {
					maxOldGenerationSizeMb: 128,
					maxYoungGenerationSizeMb: 32,
					stackSizeMb: 4,
				},
				execArgv: [],
			},
		);
		const ready = Promise.withResolvers<void>();
		const exit = Promise.withResolvers<void>();
		this.ready = ready.promise;
		this.whenExited = exit.promise;
		// Observe rejection immediately, including a worker that fails before open() is awaited.
		void this.ready.catch(() => {});
		const timer = setTimeout(() => {
			ready.reject(new Error("afterstate: initialization timeout"));
			void this.kill();
		}, this.timeouts.openTimeoutMs);
		this.worker.on(
			"message",
			(
				response: Response & {
					ready?: boolean;
					protocol?: string;
					recovered?: boolean;
					fatal?: string;
				},
			) => {
				if (response.ready !== undefined) {
					clearTimeout(timer);
					if (!response.ready || response.protocol !== AFTERSTATE_PROTOCOL) {
						ready.reject(new Error("afterstate: initialization failed"));
						void this.kill();
					} else {
						if (response.recovered) options.onRecovery?.();
						ready.resolve();
					}
					return;
				}
				if (response.fatal) {
					this.fail("persistence failed");
					return;
				}
				const active = this.active;
				if (!active || response.id !== active.id) {
					this.fail("invalid response");
					return;
				}
				clearTimeout(active.timer);
				this.bytes -= active.bytes;
				this.active = undefined;
				if (response.ok) active.resolve(response.result);
				else
					active.reject(
						new Error(`afterstate: ${response.error?.code ?? "engine"}`),
					);
				if (response.error?.code === "memory_pressure")
					this.fail("memory pressure");
				else this.dispatch();
			},
		);
		this.worker.on("error", () => this.fail("worker failed"));
		this.worker.on("exit", () => {
			clearTimeout(timer);
			this.exited = true;
			ready.reject(new Error("afterstate: worker exited"));
			this.rejectAll("worker exited");
			exit.resolve();
			if (!this.ending) options.onExit?.();
		});
	}

	async open(): Promise<this> {
		await this.ready;
		return this;
	}
	get threadId(): number {
		return this.worker.threadId;
	}
	get running(): boolean {
		return !this.ending && !this.exited;
	}

	private dispatch(): void {
		if (this.active || this.exited || !this.requests.length) return;
		const request = this.requests.shift();
		if (!request) return;
		this.active = request;
		try {
			this.worker.postMessage({
				id: request.id,
				op: request.op,
				params: request.params,
			});
		} catch {
			this.fail("request could not be cloned");
		}
	}

	private rejectAll(code: string): void {
		for (const request of [
			...(this.active ? [this.active] : []),
			...this.requests,
		]) {
			clearTimeout(request.timer);
			request.reject(new Error(`afterstate: ${code}`));
		}
		this.requests.length = 0;
		this.active = undefined;
		this.bytes = 0;
	}
	private fail(code: string): void {
		this.rejectAll(code);
		// Preserve unexpected-exit accounting; termination never throws into main.
		if (!this.exited) void this.worker.terminate().catch(() => {});
	}

	private async send(
		op: string,
		params: object,
		timeout = this.timeouts.callTimeoutMs,
	): Promise<unknown> {
		if (!this.running) throw new Error("afterstate: closed");
		// IPC already cloned the object, but framing can still reject cycles and oversized requests.
		let bytes: number;
		try {
			bytes = Buffer.byteLength(JSON.stringify({ op, params }));
		} catch {
			throw new Error("afterstate: invalid params");
		}
		if (
			bytes > AFTERSTATE_LIMITS.bytes ||
			this.bytes + bytes > AFTERSTATE_LIMITS.bytes ||
			this.requests.length + Number(!!this.active) >= AFTERSTATE_LIMITS.requests
		)
			throw new Error("afterstate: queue full");
		await this.ready;
		if (
			this.bytes + bytes > AFTERSTATE_LIMITS.bytes ||
			this.requests.length + Number(!!this.active) >= AFTERSTATE_LIMITS.requests
		)
			throw new Error("afterstate: queue full");
		if (!this.running) throw new Error("afterstate: closed");
		return new Promise((resolve, reject) => {
			const request: Request = {
				id: ++this.nextId,
				op,
				params,
				bytes,
				resolve,
				reject,
				timer: setTimeout(() => this.fail("timeout"), timeout),
			};
			this.bytes += bytes;
			this.requests.push(request);
			this.dispatch();
		});
	}
	call(op: string, params: object): Promise<unknown> {
		if (!AFTERSTATE_OPS.has(op))
			return Promise.reject(new Error("afterstate: unknown op"));
		return this.send(op, params);
	}
	async close(destroy = false): Promise<void> {
		if (this.ending || this.exited) return this.whenExited;
		const deadline = setTimeout(
			() => void this.kill(),
			this.timeouts.closeTimeoutMs,
		);
		try {
			await this.send(
				destroy ? "__destroy" : "__close",
				{},
				this.timeouts.closeTimeoutMs,
			);
		} finally {
			clearTimeout(deadline);
			await this.kill();
		}
	}
	async kill(): Promise<void> {
		this.ending = true;
		this.rejectAll("closed");
		if (!this.exited) await this.worker.terminate();
		await this.whenExited;
	}
}

export interface AfterstateKeyProtection {
	available(): Promise<boolean>;
	wrap(plaintext: string): Promise<Buffer>;
	unwrap(ciphertext: Buffer): Promise<string>;
}
export interface AfterstateHostOptions {
	artifactDir: string;
	storeDir: string;
	legacyStoreDir?: string;
	keys: AfterstateKeyProtection;
	workerEntry?: URL;
	timeouts?: AfterstateTimeouts;
	memoryLimitBytes?: number;
	now?: () => number;
	onRecovery?(): void;
}

export class AfterstateHosts {
	private readonly open = new Map<string, Promise<AfterstateWorker>>();
	private readonly live = new Set<AfterstateWorker>();
	private readonly failures = new Map<string, number[]>();
	private readonly retiring = new Map<string, Promise<void>>();
	private readonly initializing = new Map<string, AbortController>();
	private closing = false;
	constructor(private readonly options: AfterstateHostOptions) {}

	async probe(): Promise<void> {
		const worker = new AfterstateWorker({ ...this.options, snapshot: null });
		this.live.add(worker);
		try {
			await worker.open();
			await worker.call("status", {});
		} finally {
			await worker.kill();
			this.live.delete(worker);
		}
	}

	private name(member: string): string {
		return createHash("sha256")
			.update(`rowcat-afterstate/1\0${member}`)
			.digest("hex");
	}
	private async retireLegacy(member: string): Promise<void> {
		if (!this.options.legacyStoreDir) return;
		// Native v1 used this documented, member-hashed derived filename. Remove
		// only that index and SQLite companions; IndexedDB/E2EE sources stay owned
		// by the web app. Leaving it would retain deleted plaintext from old builds.
		const hash = createHash("sha256")
			.update(`afterstate-ffi/user/v1\0${member}`)
			.digest("hex")
			.slice(0, 32);
		const file = join(this.options.legacyStoreDir, `afterstate-${hash}.db`);
		for (const suffix of ["", "-wal", "-shm", "-journal"])
			await rm(`${file}${suffix}`, { force: true });
	}
	private async snapshot(
		member: string,
		signal: AbortSignal,
	): Promise<NonNullable<AfterstateWorkerData["snapshot"]>> {
		if (!(await this.options.keys.available()))
			throw new Error("afterstate: secure storage unavailable");
		signal.throwIfAborted();
		await this.retireLegacy(member);
		await mkdir(this.options.storeDir, { recursive: true, mode: 0o700 });
		const identity = this.name(member);
		const file = join(this.options.storeDir, `${identity}.index`);
		const keyFile = join(this.options.storeDir, `${identity}.key`);
		let key: Buffer;
		try {
			if ((await stat(keyFile)).size > 64 * 1024)
				throw new Error("invalid wrapped key");
			key = Buffer.from(
				await this.options.keys.unwrap(await readFile(keyFile, { signal })),
				"base64",
			);
			if (key.length !== 32) throw new Error("invalid key");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				// An inaccessible OS key is not silently replaced. The user can restore OS
				// key access or explicitly erase this device's derived data.
				throw new Error("afterstate: secure key unavailable");
			}
			key = randomBytes(32);
			await rm(file, { force: true });
			const wrapped = await this.options.keys.wrap(key.toString("base64"));
			signal.throwIfAborted();
			await writeFile(keyFile, wrapped, { flag: "wx", mode: 0o600, signal });
		}
		if (signal.aborted) {
			key.fill(0);
			signal.throwIfAborted();
		}
		return { file, key, identity };
	}

	host(member: string): Promise<AfterstateWorker> {
		if (this.closing) return Promise.reject(new Error("afterstate: closing"));
		const retirement = this.retiring.get(member);
		if (retirement) return retirement.then(() => this.host(member));
		const existing = this.open.get(member);
		if (existing) return existing;
		if (this.open.size >= AFTERSTATE_LIMITS.members)
			return Promise.reject(new Error("afterstate: member limit"));
		const now = this.options.now ?? Date.now;
		const failures = (this.failures.get(member) ?? []).filter(
			(at) => now() - at < AFTERSTATE_FAILURE_WINDOW_MS,
		);
		this.failures.set(member, failures);
		if (failures.length >= AFTERSTATE_FAILURE_LIMIT)
			return Promise.reject(new Error("afterstate: unavailable"));
		let forgotten = false;
		const forget = () => {
			if (forgotten) return;
			forgotten = true;
			if (this.open.get(member) === opening) this.open.delete(member);
			if (
				!this.closing &&
				!(
					controller.signal.aborted &&
					controller.signal.reason instanceof Error &&
					controller.signal.reason.message === "afterstate: closing"
				)
			)
				failures.push(now());
		};
		// The OS keychain can itself stall before a worker exists. Its deadline
		// and cancellation belong to the same lifecycle as WASM initialization.
		const controller = new AbortController();
		this.initializing.set(member, controller);
		let spawned: AfterstateWorker | undefined;
		const cancelled = new Promise<never>((_resolve, reject) => {
			controller.signal.addEventListener(
				"abort",
				() => {
					if (spawned) void spawned.kill();
					reject(controller.signal.reason);
				},
				{ once: true },
			);
		});
		const timer = setTimeout(
			() => controller.abort(new Error("afterstate: initialization timeout")),
			(this.options.timeouts ?? AFTERSTATE_TIMEOUTS).openTimeoutMs,
		);
		const starting = this.snapshot(member, controller.signal).then(
			async (snapshot) => {
				if (this.closing || controller.signal.aborted) {
					snapshot.key.fill(0);
					throw new Error("afterstate: closing");
				}
				const worker = new AfterstateWorker({
					...this.options,
					snapshot,
					onExit: forget,
				});
				spawned = worker;
				snapshot.key.fill(0);
				this.live.add(worker);
				void worker.whenExited.then(() => this.live.delete(worker));
				try {
					return await worker.open();
				} catch {
					await worker.kill();
					throw new Error("afterstate: initialization failed");
				}
			},
		);
		const opening = Promise.race([starting, cancelled]).finally(() => {
			clearTimeout(timer);
			if (this.initializing.get(member) === controller)
				this.initializing.delete(member);
		});
		this.open.set(member, opening);
		void opening.catch(forget);
		return opening;
	}
	private retire(member: string, destroy: boolean): Promise<void> {
		const previous = this.retiring.get(member) ?? Promise.resolve();
		this.initializing.get(member)?.abort(new Error("afterstate: closing"));
		const opening = this.open.get(member);
		this.open.delete(member);
		const retiring = previous.then(async () => {
			if (opening) {
				const worker = await opening.catch(() => null);
				if (worker) {
					try {
						await worker.close(destroy);
					} catch {
						if (!destroy) throw new Error("afterstate: checkpoint failed");
					}
				}
			}
			if (destroy) {
				await this.retireLegacy(member);
				const name = join(this.options.storeDir, this.name(member));
				for (const suffix of [".index", ".index.pending", ".key"])
					await rm(`${name}${suffix}`, { force: true });
			}
		});
		this.retiring.set(member, retiring);
		void retiring
			.finally(() => {
				if (this.retiring.get(member) === retiring)
					this.retiring.delete(member);
			})
			.catch(() => {});
		return retiring;
	}
	release(member: string): Promise<void> {
		return this.retire(member, false);
	}
	destroy(member: string): Promise<void> {
		return this.retire(member, true);
	}

	async closeAll(): Promise<void> {
		this.closing = true;
		for (const controller of this.initializing.values())
			controller.abort(new Error("afterstate: closing"));
		this.initializing.clear();
		this.open.clear();
		// Also settle key initialization, which may still be waiting for the OS keychain.
		await Promise.allSettled([...this.live].map((worker) => worker.close()));
	}
}

export interface IpcSender {
	senderFrame?: { url: string; parent?: unknown } | null;
}
const isMember = (v: unknown): v is string =>
	typeof v === "string" && v.length > 0 && v.length <= 256;

/** Exact tuple origin plus main-provided authenticated member validation. Neither
 * origin nor a renderer-supplied member id is authentication on its own. */
export function afterstateIpc(
	hosts: AfterstateHosts,
	webOrigin: () => string | null,
	authorize: (
		event: IpcSender,
		member: string,
		action: "call" | "destroy" | "release",
	) => Promise<boolean>,
) {
	const check = async (
		event: IpcSender,
		member: unknown,
		action: "call" | "destroy" | "release",
	): Promise<string> => {
		const origin = webOrigin();
		let allowed = false;
		try {
			const parsed = new URL(event.senderFrame?.url ?? "");
			allowed =
				origin !== null &&
				parsed.origin !== "null" &&
				parsed.origin === origin &&
				!event.senderFrame?.parent;
		} catch {
			/* invalid or opaque URL */
		}
		if (!allowed) throw new Error("afterstate: refused origin");
		if (!isMember(member)) throw new Error("afterstate: bad member");
		if (!(await authorize(event, member, action)))
			throw new Error("afterstate: refused member");
		return member;
	};
	const queues = new Map<string, Promise<unknown>>();
	let queued = 0;
	let queuedBytes = 0;
	const ordered = <T>(
		member: unknown,
		params: unknown,
		run: () => Promise<T>,
	): Promise<T> => {
		let bytes: number;
		try {
			bytes = Buffer.byteLength(JSON.stringify(params));
		} catch {
			return Promise.reject(new Error("afterstate: invalid params"));
		}
		if (
			queued >= AFTERSTATE_LIMITS.requests ||
			queuedBytes + bytes > AFTERSTATE_LIMITS.bytes
		)
			return Promise.reject(new Error("afterstate: queue full"));
		const key = typeof member === "string" ? member : "invalid";
		queued++;
		queuedBytes += bytes;
		// Authorization can complete out of order. Serialize it with the operation,
		// so erase cannot overtake an earlier ingest or be overtaken by later recall.
		const result = (queues.get(key) ?? Promise.resolve())
			.catch(() => {})
			.then(run);
		queues.set(key, result);
		void result
			.finally(() => {
				queued--;
				queuedBytes -= bytes;
				if (queues.get(key) === result) queues.delete(key);
			})
			.catch(() => {});
		return result;
	};
	return {
		call: (event: IpcSender, member: unknown, op: unknown, params: unknown) =>
			ordered(member, params, async () => {
				const key = await check(event, member, "call");
				if (typeof op !== "string" || !AFTERSTATE_OPS.has(op))
					throw new Error("afterstate: unknown op");
				if (
					typeof params !== "object" ||
					params === null ||
					Array.isArray(params)
				)
					throw new Error("afterstate: bad params");
				return (await hosts.host(key)).call(op, params);
			}),
		destroy: (event: IpcSender, member: unknown) =>
			ordered(member, {}, async () =>
				hosts.destroy(await check(event, member, "destroy")),
			),
		release: (event: IpcSender, member: unknown) =>
			ordered(member, {}, async () =>
				hosts.release(await check(event, member, "release")),
			),
	};
}
