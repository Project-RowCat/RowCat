import { parentPort, workerData } from "node:worker_threads";
import {
	compileRuntimeProject,
	type RuntimeCompileInput,
	type RuntimeCompileResult,
} from "@rowcat/runtime-compiler";
import { nodeRuntimeEnvironment } from "@rowcat/runtime-compiler/node";

/**
 * One publication compile, in a thread of its own (`runtime-compile.ts` says why). Single-shot: the
 * input arrives as `workerData`, one result goes back, and the thread ends. A thread that compiled
 * hostile source is never reused, so whatever it held dies with it.
 *
 * Only the cloneable half of the outcome crosses: the compiler's `handle` holds a TypeScript
 * program, which the structured-clone algorithm cannot copy and which the next compile in a fresh
 * thread could not reuse anyway.
 */
const outcome = compileRuntimeProject(
	workerData as RuntimeCompileInput,
	nodeRuntimeEnvironment(),
);
const result: RuntimeCompileResult = outcome.ok
	? { ok: true, artifact: outcome.artifact, diagnostics: outcome.diagnostics }
	: { ok: false, artifact: null, diagnostics: outcome.diagnostics };
parentPort?.postMessage(result);
