import { Worker } from "node:worker_threads";
import type {
	RuntimeCompileInput,
	RuntimeCompileResult,
} from "@rowcat/runtime-compiler";
import {
	createSlotGate,
	SlotUnavailableError,
} from "../../lib/remote-image/slots.ts";

/**
 * Publication compiles run in a worker thread with a memory ceiling and a deadline. They used to run
 * inline, inside the request, and that was a way to take the API down with a kilobyte: type
 * checking is unbounded by design (a recursive conditional type a few lines long ran a 2.6 GB heap
 * in five seconds, and thirty such lines killed the process with "heap out of memory"), and the
 * source-size caps are three orders of magnitude above what that needs.
 *
 * ```text
 * memory    COMPILE_HEAP_MB per thread     the thread dies with ERR_WORKER_OUT_OF_MEMORY; the API does not
 * time      COMPILE_TIMEOUT_MS             the thread is terminated
 * threads   COMPILE_SLOTS at once, short queue   memory = slots × heap, not requests × heap
 * ```
 *
 * Exhaustion is the creator's source, so it is a creator-facing rejection (`exhausted`), not a 500.
 * A crash or error inside the thread that is neither is still ours and is thrown, the same rule
 * `compileStoryRuntime` already followed: folding our failure into diagnostics makes a server
 * incident look like a syntax error.
 *
 * A fresh thread per compile costs the compiler's cold start (a few hundred milliseconds) on every
 * publication. Reusing threads would save that and keep whatever a hostile compile left behind, and
 * publishing is rare next to everything else this process does.
 */
export const RUNTIME_COMPILE_LIMITS = {
	heapMb: 768,
	timeoutMs: 20_000,
	slots: 2,
	queued: 16,
	waitMs: 10_000,
} as const;

export type IsolatedCompileOutcome =
	| { kind: "compiled"; result: RuntimeCompileResult }
	| { kind: "exhausted"; reason: "memory" | "time" }
	| { kind: "busy" };

const gate = createSlotGate({
	maxInFlight: RUNTIME_COMPILE_LIMITS.slots,
	maxQueued: RUNTIME_COMPILE_LIMITS.queued,
	maxWaitMs: RUNTIME_COMPILE_LIMITS.waitMs,
});

/**
 * Where the thread's entry lives. From source (tests, `tsx` in development) it is the `.ts` file
 * beside this one, loaded through `tsx`; from the deployment bundle it is the entry `tsdown.config.ts`
 * builds at `dist/services/story/`, relative to the bundle this code was folded into (`dist/`).
 */
const workerEntry = (): { url: URL; execArgv: string[] } =>
	import.meta.url.endsWith(".ts")
		? {
				url: new URL("./runtime-compile-worker.ts", import.meta.url),
				execArgv: ["--import", "tsx"],
			}
		: {
				url: new URL(
					"./services/story/runtime-compile-worker.mjs",
					import.meta.url,
				),
				execArgv: [],
			};

export async function compileRuntimeInIsolation(
	input: RuntimeCompileInput,
	limits: { heapMb: number; timeoutMs: number } = RUNTIME_COMPILE_LIMITS,
): Promise<IsolatedCompileOutcome> {
	let release: () => void;
	try {
		release = await gate.acquire();
	} catch (error) {
		if (error instanceof SlotUnavailableError) return { kind: "busy" };
		throw error;
	}
	try {
		return await runWorker(input, limits);
	} finally {
		release();
	}
}

function runWorker(
	input: RuntimeCompileInput,
	limits: { heapMb: number; timeoutMs: number },
): Promise<IsolatedCompileOutcome> {
	const { url, execArgv } = workerEntry();
	return new Promise((resolve, reject) => {
		const worker = new Worker(url, {
			workerData: input,
			execArgv,
			resourceLimits: { maxOldGenerationSizeMb: limits.heapMb },
			/** Our own stdout carries logs; a thread printing there would interleave unattributed lines. */
			stdout: true,
			stderr: true,
		});
		worker.stdout.resume();
		worker.stderr.resume();
		let settled = false;
		const settle = (outcome: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			outcome();
			void worker.terminate();
		};
		const timer = setTimeout(
			() => settle(() => resolve({ kind: "exhausted", reason: "time" })),
			limits.timeoutMs,
		);
		worker.once("message", (result: RuntimeCompileResult) =>
			settle(() => resolve({ kind: "compiled", result })),
		);
		worker.once("error", (error: Error & { code?: string }) =>
			settle(() =>
				error.code === "ERR_WORKER_OUT_OF_MEMORY"
					? resolve({ kind: "exhausted", reason: "memory" })
					: reject(error),
			),
		);
		worker.once("exit", (code) =>
			settle(() =>
				reject(
					new Error(`the compile thread exited without a result (${code})`),
				),
			),
		);
	});
}
