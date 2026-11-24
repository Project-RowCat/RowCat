import type { AfterstatePort } from "@rowcat/chat";

/**
 * Browser transport only: one disposable WASM worker per member, never an authoritative store.
 * Records and audience rules stay in the existing chat adapter and IndexedDB. The worker bundle
 * loads on the first call, so SSR and pages that do not use memory load neither SQLite nor WASM.
 */
export interface BrowserMemoryHandle {
	port: AfterstatePort;
	close(): void;
}

export function createBrowserMemoryHandle(
	createWorker: () => Promise<Worker> = async () => {
		const { default: MemoryWorker } = await import(
			"./browser-memory.worker.ts?worker"
		);
		return new MemoryWorker();
	},
): BrowserMemoryHandle {
	let worker: Worker | undefined;
	let opening: Promise<Worker> | undefined;
	let closed = false;
	let nextId = 0;
	const pending = new Map<
		number,
		{ resolve(value: unknown): void; reject(reason: unknown): void }
	>();
	const close = (reason = new Error("Browser memory index closed")): void => {
		closed = true;
		worker?.terminate();
		for (const request of pending.values()) request.reject(reason);
		pending.clear();
	};
	const open = (): Promise<Worker> => {
		opening ??= createWorker().then((created) => {
			if (closed) {
				created.terminate();
				throw new Error("Browser memory index closed");
			}
			worker = created;
			created.addEventListener("message", (event: MessageEvent) => {
				const response = event.data as {
					id: number;
					ok: boolean;
					result?: unknown;
					error?: { message?: string };
				};
				const request = pending.get(response.id);
				if (!request) return;
				pending.delete(response.id);
				if (response.ok) request.resolve(response.result);
				else
					request.reject(
						new Error(response.error?.message ?? "Memory operation failed"),
					);
			});
			created.addEventListener("error", () =>
				close(new Error("Browser memory worker failed")),
			);
			created.addEventListener("messageerror", () =>
				close(new Error("Browser memory response could not be read")),
			);
			return created;
		});
		return opening;
	};
	return {
		close,
		port: {
			call<T>(
				op: Parameters<AfterstatePort["call"]>[0],
				params: object,
			): Promise<T> {
				if (closed)
					return Promise.reject(new Error("Browser memory index closed"));
				const id = ++nextId;
				return new Promise<T>((resolve, reject) => {
					// The adapter's 400 ms turn deadline stays unchanged. This longer transport bound
					// also covers a cold WASM download and background reconciliation, without leaving
					// unresolved callers or a wedged worker alive for the rest of the tab's lifetime.
					const deadline = AbortSignal.timeout(30_000);
					const expired = () =>
						close(new Error("Browser memory worker timed out"));
					deadline.addEventListener("abort", expired, { once: true });
					const settle = (complete: () => void): void => {
						deadline.removeEventListener("abort", expired);
						complete();
					};
					pending.set(id, {
						resolve: (value) => settle(() => resolve(value as T)),
						reject: (reason) => settle(() => reject(reason)),
					});
					void open()
						.then((ready) => {
							if (!closed && pending.has(id))
								ready.postMessage({ id, op, params });
						})
						.catch(() =>
							close(new Error("Browser memory worker could not start")),
						);
				});
			},
		},
	};
}

const handles = new Map<string, BrowserMemoryHandle>();

export function browserMemoryPort(memberKey: string): AfterstatePort | null {
	if (
		typeof window === "undefined" ||
		typeof Worker === "undefined" ||
		typeof WebAssembly === "undefined"
	)
		return null;
	let handle = handles.get(memberKey);
	if (!handle) {
		handle = createBrowserMemoryHandle();
		handles.set(memberKey, handle);
	}
	return handle.port;
}

/** Closing a local-data scope must also drop its plaintext derived index and reject late work. */
export function releaseBrowserMemory(memberKey: string): void {
	handles.get(memberKey)?.close();
	handles.delete(memberKey);
}
