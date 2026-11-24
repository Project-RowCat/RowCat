import type { AfterstateOp } from "@rowcat/chat";
import { AFTERSTATE_PROTOCOL } from "@rowcat/chat";

export interface MemoryWorkerRequest {
	id: number;
	op: AfterstateOp;
	params: object;
}

interface MemoryEngine {
	protocol(): string;
	call(request: string): string;
}

/**
 * Only request ordering and JSON framing live here. Initialization can be asynchronous, but ingest,
 * recall and erase must keep arrival order while it loads. A failed operation must not poison the
 * queue. This boundary has no records, persistence, member names or alternative memory algorithm.
 */
export function createMemoryWorkerHandler(open: () => Promise<MemoryEngine>) {
	let engine: Promise<MemoryEngine> | undefined;
	let queue = Promise.resolve();
	return (request: MemoryWorkerRequest): Promise<unknown> => {
		const response = queue.then(async () => {
			try {
				engine ??= open().then((opened) => {
					if (opened.protocol() !== AFTERSTATE_PROTOCOL)
						throw new Error("Unsupported memory protocol");
					return opened;
				});
				return JSON.parse(
					(await engine).call(JSON.stringify(request)),
				) as unknown;
			} catch {
				// Neither the request body nor an engine exception crosses into a log or error surface.
				return {
					id: request.id,
					ok: false,
					error: { code: "engine", message: "Browser memory operation failed" },
				};
			}
		});
		queue = response.then(() => {});
		return response;
	};
}
