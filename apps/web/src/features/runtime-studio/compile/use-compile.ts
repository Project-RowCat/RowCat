import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import {
	analyzeRuntimeProject,
	RUNTIME_DIAGNOSTIC_CODE,
	type RuntimeDiagnostic,
} from "@rowcat/runtime-compiler";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { translator } from "#/lib/i18n/current.ts";
import {
	type RuntimeCompileSignatureFile,
	runtimeCompileSignature,
} from "./signature.ts";
import {
	initialRuntimeCompileState,
	type RuntimeCompileState,
	runtimeCompileReducer,
} from "./state.ts";

/**
 * Schedules the runtime analysis pass while editing; the rules live in a pure module.
 *
 * This hook writes nothing and never blocks saving. Autosave is authoritative and independent of
 * compile results, because broken syntax is a normal intermediate state while typing.
 *
 * Monaco's worker already produces type diagnostics with the same options, so only what Monaco
 * cannot answer is checked here: entry point existence, module resolution inside the project, and
 * forbidden syntax. A parser suffices, so no compile worker or library is needed.
 *
 * The emitted code is never executed here.
 */

const DEBOUNCE_MS = 250;

/**
 * The input is the editor's current snapshot (`runtime-source-snapshot.ts`), not stored records.
 * Analyzing records would check code as late as the autosave debounce. Gating preview eligibility
 * on those diagnostics would let an error the editor no longer shows block a run, or let a new
 * error pass.
 */
export interface RuntimeCompileInputFiles {
	files: readonly RuntimeCompileSignatureFile[];
	entry: string;
}

export function useRuntimeCompile({
	files,
	entry,
}: RuntimeCompileInputFiles): RuntimeCompileState {
	const [state, dispatch] = useReducer(
		runtimeCompileReducer,
		initialRuntimeCompileState,
	);

	/**
	 * Request numbers are counted outside render. Keeping the counter in state would make incrementing
	 * it trigger a render, which would rerun the effect. The counter is not a value shown on screen.
	 */
	const nextRequest = useRef(0);

	/**
	 * The effect's trigger is a value that carries the contents. Watching only list identity would not
	 * wake analysis on typing (it runs only when files are added or removed). Passing the array itself
	 * would create a new array every render, so the debounce would never settle. The construction rule
	 * lives in `runtime-compile-signature.ts`. While the value was built by plain concatenation, it
	 * was ambiguous: with no separator, different projects could yield the same string, so analysis
	 * would not run while the screen kept drawing the old diagnostics.
	 */
	const signature = useMemo(() => runtimeCompileSignature(files), [files]);

	/**
	 * `files` is intentionally left out of the dependencies. Its contents are carried by `signature`,
	 * and its reference changes every render. Values read inside the effect are always current.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: signature represents the contents of files
	useEffect(() => {
		const requestId = nextRequest.current + 1;
		nextRequest.current = requestId;
		dispatch({ type: "start", requestId });

		const timer = setTimeout(() => {
			try {
				const result = analyzeRuntimeProject({
					apiVersion: RUNTIME_API_VERSION,
					entry,
					files: files.map((file) => ({
						path: file.path,
						content: file.content,
					})),
				});
				dispatch({ type: "settle", requestId, result });
			} catch (error) {
				/**
				 * Exceptions thrown by the compiler are not the creator's problem. Bad code comes back as
				 * diagnostics, not exceptions, so reaching this point is a bug on our side. The screen says so
				 * and does not show the raw stack trace.
				 */
				dispatch({ type: "fail", requestId, diagnostic: failure(error) });
			}
		}, DEBOUNCE_MS);

		return () => clearTimeout(timer);
	}, [signature, entry]);

	return state;
}

const failure = (error: unknown): RuntimeDiagnostic => ({
	code: RUNTIME_DIAGNOSTIC_CODE.apiVersionUnsupported,
	severity: "error",
	source: "runtime",
	message: translator("runtimeStudio")("compile.checkerFailed", {
		detail: error instanceof Error ? ` (${error.name})` : "",
	}),
});
