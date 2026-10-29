import { initialize } from "monaco-editor/internal/common/initialize";
import { TypeScriptWorker } from "monaco-editor/languages/features/typescript/tsWorker";
import { RUNTIME_SEMANTIC_FORMAT } from "./semantic-tokens.ts";

/**
 * Entry point for this studio's TypeScript worker: Monaco's worker plus one read-only method.
 *
 * Monaco 0.56's worker contract has no semantic classification method. The language service has
 * getEncodedSemanticClassifications, but no channel carries it to the main thread. The only channel
 * is a method on the worker class, so this module must be the entry point.
 *
 * customWorkerPath is not used. It loads an arbitrary address with importScripts inside the worker,
 * and the repo already blocks that pattern by name in the studio folder. A derived class keeps
 * everything inside the bundle.
 *
 * Not here: writing (edit, emit and format stay Monaco's contract; a local copy would drift),
 * running the author's code (the language service only reads types), and network access (type
 * acquisition stays off; see monaco-setup.ts).
 *
 * The class is exported so tests can build it on the real TypeScript language service
 * (runtime-semantic-tokens.monaco.test.ts). A copy would measure the copy. Exporting costs nothing:
 * the ?worker import runs only this module's side effect (the onmessage assignment).
 */
export class RuntimeTypeScriptWorker extends TypeScriptWorker {
	/**
	 * Returns only the flat array, not the full structure. endOfLineState is unused here, and fewer
	 * values crossing the worker boundary is better.
	 *
	 * A failure returns an empty array. Throwing would reach the main-thread provider as a rejection,
	 * and the screen would then show lexical colors only. That is a normal state (the worker does not
	 * know the file yet), not an error.
	 */
	async getEncodedSemanticClassifications(
		fileName: string,
		start: number,
		end: number,
	): Promise<number[]> {
		try {
			const result = this._languageService.getEncodedSemanticClassifications(
				fileName,
				{ start, length: Math.max(0, end - start) },
				RUNTIME_SEMANTIC_FORMAT,
			);
			return Array.from(result?.spans ?? []);
		} catch {
			return [];
		}
	}
}

/**
 * Same shape as ts.worker.js. The first message is a discarded signal (postMessage('ignore'));
 * initialize then replaces onmessage with its own handler immediately. Reordering this is unsafe:
 * the second message, which carries createData, would arrive while nothing listens.
 */
self.onmessage = () => {
	initialize((ctx, createData) => new RuntimeTypeScriptWorker(ctx, createData));
};
