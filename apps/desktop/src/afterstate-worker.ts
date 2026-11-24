/** The only production loader of the Node WASM bindings. No creator code, inference,
 * renderer-provided paths or plaintext files enter this worker. Synchronous Rust
 * calls execute in arrival order; snapshots and shutdown share that same queue. */
import { createRequire } from "node:module";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import {
	AFTERSTATE_PROTOCOL,
	validateAfterstateArtifact,
} from "./afterstate-artifact.ts";
import { AfterstateSnapshot } from "./afterstate-snapshot.ts";

interface Engine {
	protocol(): string;
	call(request: string): string;
	snapshot(): Uint8Array;
	memory_bytes(): number;
	generation(): bigint;
	free(): void;
}

interface Bindings {
	Afterstate: {
		new (): Engine;
		restore(bytes: Uint8Array): Engine;
		prototype: Engine;
	};
}

export interface AfterstateWorkerData {
	artifactDir: string;
	/** null only for a non-persisting startup/packaging probe. */
	snapshot: { file: string; key: Uint8Array; identity: string } | null;
	memoryLimitBytes: number;
}

const port = parentPort;
if (!port) throw new Error("afterstate: worker only");
const data = workerData as AfterstateWorkerData;
let engine: Engine;
let snapshot: AfterstateSnapshot | null = null;
let dirty = false;
let writes = 0;
let checkpointTimer: NodeJS.Timeout | undefined;
let queue = Promise.resolve();
const reconciled = new Map<string, Set<string>>();

const checkpoint = () => {
	clearTimeout(checkpointTimer);
	if (dirty && snapshot) snapshot.save(engine.snapshot());
	dirty = false;
	writes = 0;
};

try {
	validateAfterstateArtifact(data.artifactDir);
	const { Afterstate } = createRequire(import.meta.url)(
		join(data.artifactDir, "afterstate_wasm.js"),
	) as Bindings;
	if (
		typeof Afterstate.restore !== "function" ||
		typeof Afterstate.prototype.snapshot !== "function" ||
		typeof Afterstate.prototype.generation !== "function"
	)
		throw new Error("incompatible engine");
	let recovered = false;
	if (data.snapshot) {
		snapshot = new AfterstateSnapshot(
			data.snapshot.file,
			Buffer.from(data.snapshot.key),
			data.snapshot.identity,
		);
		try {
			const bytes = snapshot.load();
			try {
				engine = bytes ? Afterstate.restore(bytes) : new Afterstate();
			} finally {
				bytes?.fill(0);
			}
		} catch {
			snapshot.invalidate();
			engine = new Afterstate();
			recovered = true;
		}
	} else engine = new Afterstate();
	if (engine.protocol() !== AFTERSTATE_PROTOCOL)
		throw new Error("incompatible protocol");
	port.postMessage({ ready: true, protocol: engine.protocol(), recovered });
} catch {
	port.postMessage({ ready: false, error: "initialization" });
	port.close();
}

const mutating = new Set([
	"ingest",
	"reconcile",
	"erase",
	"sweep",
	"consolidate",
]);
const recallOps = new Set(["recall", "facts", "digests"]);

port.on(
	"message",
	(request: { id: number; op: string; params: Record<string, unknown> }) => {
		queue = queue.then(() => {
			try {
				const { id, op, params } = request;
				if (op === "__close" || op === "__destroy") {
					clearTimeout(checkpointTimer);
					if (op === "__destroy") snapshot?.invalidate();
					else checkpoint();
					engine.free();
					port.postMessage({ id, ok: true, result: { closed: true } });
					port.close();
					return;
				}
				const room =
					typeof params.conversation === "string" ? params.conversation : "";
				// Restored evidence cannot be used before the host supplies all live source manifests.
				// The shared adapter additionally verifies every cited revision and current audience.
				if (recallOps.has(op) && reconciled.get(room)?.size !== 3)
					throw new Error("reconcile_required");
				let sourceWrite = op === "ingest" || op === "erase";
				if ((op === "reconcile" || op === "sweep") && params.dry_run !== true) {
					// Ask the existing Rust planner whether source erasure is needed.
					// No write can interleave in this worker. This preserves no-op
					// snapshots while invalidating private stale bytes before a long
					// erase can time out or be terminated mid-call.
					const plan = JSON.parse(
						engine.call(
							JSON.stringify({
								...request,
								params: { ...params, dry_run: true },
							}),
						),
					) as {
						ok: boolean;
						result?: { orphaned?: unknown };
					};
					const orphaned = plan.result?.orphaned;
					sourceWrite =
						plan.ok &&
						(Array.isArray(orphaned)
							? orphaned.length > 0
							: typeof orphaned === "number" && orphaned > 0);
				}
				if (sourceWrite) {
					if (!dirty) snapshot?.invalidate();
					dirty = true;
				}
				const before = mutating.has(op) ? engine.generation() : null;
				const response = JSON.parse(engine.call(JSON.stringify(request))) as {
					id: number;
					ok: boolean;
					result?: { erased_passages?: number };
				};
				if (before !== null && engine.generation() !== before) {
					if (!dirty) snapshot?.invalidate();
					dirty = true;
				}
				if (response.ok && op === "reconcile") {
					const kind = params.record;
					if (kind === "message" || kind === "note" || kind === "summary") {
						const kinds = reconciled.get(room) ?? new Set<string>();
						kinds.add(kind);
						reconciled.set(room, kinds);
					}
				}
				if (op === "erase" && params.record === undefined)
					reconciled.delete(room);
				if (dirty) {
					writes++;
					// A full reconciliation run contains at most 2,000 ingested records. Persist
					// between runs, and after a bounded idle interval, instead of copying the
					// whole SQLite index for each of its 64-item batches.
					if (op === "checkpoint" || op === "consolidate" || writes >= 40)
						checkpoint();
					else {
						clearTimeout(checkpointTimer);
						checkpointTimer = setTimeout(() => {
							queue = queue.then(checkpoint).catch(() => {
								port.postMessage({ fatal: "persistence" });
								port.close();
							});
						}, 5_000);
					}
				}
				const memoryBytes = engine.memory_bytes();
				if (memoryBytes > data.memoryLimitBytes) {
					checkpoint();
					port.postMessage({
						id,
						ok: false,
						error: { code: "memory_pressure" },
					});
					engine.free();
					port.close();
					return;
				}
				port.postMessage({ ...response, memoryBytes });
			} catch (error) {
				// Engine and filesystem exceptions may contain source text or private paths.
				const code =
					error instanceof Error && error.message === "reconcile_required"
						? "reconcile_required"
						: "engine";
				port.postMessage({ id: request.id, ok: false, error: { code } });
				if (code !== "reconcile_required") {
					clearTimeout(checkpointTimer);
					port.postMessage({ fatal: "engine" });
					port.close();
				}
			}
		});
	},
);
