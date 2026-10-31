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
 * memory    heapMb per thread              the thread dies with ERR_WORKER_OUT_OF_MEMORY; the API does not
 * stack     stackMb per thread             the compiler's recursion overflows inside the thread
 * time      timeoutMs                      the thread is terminated
 * threads   slots at once, short queue     memory = slots × heap, not requests × heap
 * members   one compile per member         in flight or queued; the rest are refused, not queued
 * ```
 *
 * Exhaustion is the creator's source, so it is a creator-facing rejection (`exhausted`), not a 500.
 * All three resources count: TypeScript's parser and checker recurse, and deep nesting overflows the
 * stack long before the heap fills (five thousand nested brackets, about 10KB, did it in under a
 * second). That overflow used to leave the thread as an ordinary error and became a 500 with an
 * incident log line. A crash or error inside the thread that is none of these is still ours and is
 * thrown, the same rule `compileStoryRuntime` already followed: folding our failure into diagnostics
 * makes a server incident look like a syntax error.
 *
 * ## The slots are shared, so each member gets one
 *
 * The gate bounds this process's memory; it says nothing about who holds it. With only the gate, one
 * account sending a few compiles that run to the deadline held both slots and the queue, and every
 * other creator's publish answered `busy` for as long as it kept sending. So a member has at most one
 * compile in flight or queued, and a second is refused at once (`member-busy`) rather than queued
 * behind the first: queueing it would hand that member a second slot the moment one frees. The rate
 * of compiles over time is the rate-limit table's (`storyRuntimeCompile`); this cap is the
 * in-process half and holds whether or not that store answers. `busy` still means what it meant:
 * the whole process is full.
 *
 * ## A slot comes back when the thread is gone
 *
 * The request's signal reaches the compile: a client that left takes its place out of the queue, or
 * ends its thread. Either way the slot, and the member's place, return only after the thread has
 * exited. Released once the outcome was known (as it once was), a terminated thread still tearing
 * down its heap overlapped the next one's, and the memory bound was slots × heap plus whatever was
 * still dying.
 *
 * A fresh thread per compile costs the compiler's cold start (a few hundred milliseconds) on every
 * publication. Reusing threads would save that and keep whatever a hostile compile left behind, and
 * publishing is rare next to everything else this process does.
 */
export const RUNTIME_COMPILE_LIMITS = {
	heapMb: 768,
	/**
	 * Node's default, stated so the bound does not move with a Node upgrade. Raising it lets deeper
	 * honest nesting through and costs that much more native memory per slot.
	 */
	stackMb: 4,
	timeoutMs: 20_000,
	slots: 2,
	queued: 16,
	waitMs: 10_000,
} as const;

export type IsolatedCompileOutcome =
	| { kind: "compiled"; result: RuntimeCompileResult }
	| { kind: "exhausted"; reason: "memory" | "stack" | "time" }
	/** The whole process is checking as many projects as it may. */
	| { kind: "busy" }
	/** This member already has a compile in flight or queued. */
	| { kind: "member-busy" }
	/** The request's signal fired; nothing was compiled, or the compile was stopped. */
	| { kind: "cancelled" };

/** What the thread posts back: a result, or the one exhaustion only the thread can see. */
export type CompileWorkerMessage =
	| { kind: "compiled"; result: RuntimeCompileResult }
	| { kind: "exhausted"; reason: "stack" };

const gate = createSlotGate({
	maxInFlight: RUNTIME_COMPILE_LIMITS.slots,
	maxQueued: RUNTIME_COMPILE_LIMITS.queued,
	maxWaitMs: RUNTIME_COMPILE_LIMITS.waitMs,
});

/**
 * Members with a compile in flight or queued. In process, like the gate: it bounds this replica's
 * slots, and a second replica has its own slots for that member to hold. The rate limit is what
 * spans replicas.
 */
const compiling = new Set<string>();

/** Slots, waiters and members holding a place, for tests and diagnostics. */
export const runtimeCompileStats = () => ({
	...gate.stats(),
	members: compiling.size,
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

export interface IsolatedCompileOptions {
	/**
	 * Who asked. A publication always names its member; only a process acting for nobody (the e2e
	 * seed) leaves it out, and then no per-member place is held.
	 */
	member?: string;
	/** The request's signal: a client that left gives its place back and ends its thread. */
	signal?: AbortSignal;
	/** Lowered by tests so an exhausting compile ends in seconds. */
	limits?: { heapMb: number; stackMb?: number; timeoutMs: number };
}

export async function compileRuntimeInIsolation(
	input: RuntimeCompileInput,
	options: IsolatedCompileOptions = {},
): Promise<IsolatedCompileOutcome> {
	const { member, signal } = options;
	if (signal?.aborted) return { kind: "cancelled" };
	if (member !== undefined) {
		if (compiling.has(member)) return { kind: "member-busy" };
		compiling.add(member);
	}
	try {
		let release: () => void;
		try {
			release = await gate.acquire(signal);
		} catch (error) {
			if (error instanceof SlotUnavailableError)
				return error.reason === "cancelled"
					? { kind: "cancelled" }
					: { kind: "busy" };
			throw error;
		}
		try {
			return await runWorker(input, {
				...RUNTIME_COMPILE_LIMITS,
				...options.limits,
				signal,
			});
		} finally {
			release();
		}
	} finally {
		if (member !== undefined) compiling.delete(member);
	}
}

/**
 * Resolves only after the thread has exited, whatever ended it: `finally` above returns the slot and
 * the member's place, and both must outlive the thread (header).
 */
function runWorker(
	input: RuntimeCompileInput,
	limits: {
		heapMb: number;
		stackMb?: number;
		timeoutMs: number;
		signal?: AbortSignal;
	},
): Promise<IsolatedCompileOutcome> {
	/** The signal can fire between the slot being granted and this line; `abort` would not repeat. */
	if (limits.signal?.aborted) return Promise.resolve({ kind: "cancelled" });
	const { url, execArgv } = workerEntry();
	return new Promise((resolve, reject) => {
		const worker = new Worker(url, {
			workerData: input,
			execArgv,
			resourceLimits: {
				maxOldGenerationSizeMb: limits.heapMb,
				stackSizeMb: limits.stackMb ?? RUNTIME_COMPILE_LIMITS.stackMb,
			},
			/** Our own stdout carries logs; a thread printing there would interleave unattributed lines. */
			stdout: true,
			stderr: true,
		});
		worker.stdout.resume();
		worker.stderr.resume();
		/**
		 * The first event decides the outcome; the thread's exit delivers it. A thread that posted its
		 * result is ending anyway, and one that is terminated has ended once `exit` fires.
		 */
		let decided: (() => void) | null = null;
		const decide = (outcome: () => void) => {
			if (decided) return;
			decided = outcome;
			clearTimeout(timer);
			limits.signal?.removeEventListener("abort", onAbort);
			void worker.terminate();
		};
		const timer = setTimeout(
			() => decide(() => resolve({ kind: "exhausted", reason: "time" })),
			limits.timeoutMs,
		);
		const onAbort = () => decide(() => resolve({ kind: "cancelled" }));
		limits.signal?.addEventListener("abort", onAbort, { once: true });
		worker.once("message", (message: CompileWorkerMessage) =>
			decide(() =>
				resolve(
					message.kind === "compiled"
						? { kind: "compiled", result: message.result }
						: { kind: "exhausted", reason: message.reason },
				),
			),
		);
		worker.once("error", (error: Error & { code?: string }) =>
			decide(() =>
				error.code === "ERR_WORKER_OUT_OF_MEMORY"
					? resolve({ kind: "exhausted", reason: "memory" })
					: reject(error),
			),
		);
		worker.once("exit", (code) => {
			decide(() =>
				reject(
					new Error(`the compile thread exited without a result (${code})`),
				),
			);
			decided?.();
		});
	});
}
