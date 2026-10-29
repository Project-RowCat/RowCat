/**
 * Type declarations for two modules inside Monaco's worker. The exports map of monaco-editor has no
 * types condition for these subpaths, so they resolve without types even though they exist. This
 * file declares only what the app calls, and it must stay short for that reason. A broad
 * declaration silently goes stale when Monaco's version changes. That mismatch only shows inside
 * the worker, and exceptions inside the worker never reach the screen.
 *
 * This is a different kind from the runtime language contract declarations. Those are generated
 * from the source of @rowcat/runtime and must have a single origin. This file is a minimal shadow
 * of someone else's package.
 */

declare module "monaco-editor/languages/definitions/typescript/typescript" {
	import type { languages } from "monaco-editor/editor/editor.api";

	/** Bracket pairs, comment and auto-indent rules. Passed through unchanged. */
	export const conf: languages.LanguageConfiguration;
	/**
	 * Monarch grammar object. It is not typed as IMonarchLanguage, because that type has a broadly
	 * typed tokenizer (an index signature), and nothing would constrain the state arrays that
	 * extension functions manipulate. Typing it narrowly here keeps the shape that withJsx actually
	 * touches visible in the type.
	 */
	export const language: {
		tokenizer: Record<string, unknown[]>;
		[key: string]: unknown;
	};
}

declare module "monaco-editor/internal/common/initialize" {
	/**
	 * Worker bootstrap. On the first message it receives createData and builds the worker object. This
	 * does what ts.worker.js does. This code only places a derived class in that slot.
	 */
	export function initialize(
		callback: (ctx: unknown, createData: unknown) => unknown,
	): void;
}

declare module "monaco-editor/languages/features/typescript/tsWorker" {
	/**
	 * The TypeScript service Monaco creates inside the worker. _languageService is not a public
	 * contract, but it is the fact of this version, and only one function on top of it is needed. If
	 * the name changes, the derived class below breaks first, at compile time.
	 */
	export class TypeScriptWorker {
		constructor(ctx: unknown, createData: unknown);
		protected _languageService: {
			getEncodedSemanticClassifications(
				fileName: string,
				span: { start: number; length: number },
				format: string,
			): { spans: number[] };
		};
	}
}
