import { parentPort, workerData } from "node:worker_threads";
import {
	compileRuntimeProject,
	type RuntimeCompileInput,
	type RuntimeCompileResult,
} from "@rowcat/runtime-compiler";
import { nodeRuntimeEnvironment } from "@rowcat/runtime-compiler/node";
import type { CompileWorkerMessage } from "./runtime-compile.ts";

/**
 * One publication compile, in a thread of its own (`runtime-compile.ts` says why). Single-shot: the
 * input arrives as `workerData`, one result goes back, and the thread ends. A thread that compiled
 * hostile source is never reused, so whatever it held dies with it.
 *
 * Only the cloneable half of the outcome crosses: the compiler's `handle` holds a TypeScript
 * program, which the structured-clone algorithm cannot copy and which the next compile in a fresh
 * thread could not reuse anyway.
 */
/**
 * A stack overflow is the one exhaustion only this thread can name. The heap ceiling and the deadline
 * end the thread from outside, and the parent sees them as such; an overflow is an ordinary
 * `RangeError` that would leave the thread as any other error does, and the parent rightly treats an
 * unknown error as ours. Caught here, around the compile alone, it is the source's doing: the
 * parser and the checker recurse once per level of nesting, and the stack is spent by what the
 * creator wrote. The message test is V8's wording, which is the only engine this runs on; any other
 * `RangeError` is rethrown and stays a server error.
 */
function compile(): CompileWorkerMessage {
	try {
		const outcome = compileRuntimeProject(
			workerData as RuntimeCompileInput,
			nodeRuntimeEnvironment(),
		);
		const result: RuntimeCompileResult = outcome.ok
			? {
					ok: true,
					artifact: outcome.artifact,
					diagnostics: outcome.diagnostics,
				}
			: { ok: false, artifact: null, diagnostics: outcome.diagnostics };
		return { kind: "compiled", result };
	} catch (error) {
		if (
			error instanceof RangeError &&
			error.message.includes("Maximum call stack size exceeded")
		)
			return { kind: "exhausted", reason: "stack" };
		throw error;
	}
}

parentPort?.postMessage(compile());
