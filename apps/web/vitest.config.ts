import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Web test config. Does not boot the whole app: what is checked is the local storage layer, which
 * can be verified without React, and rendering would break storage tests whenever markup changes.
 *
 * Does not reuse vite.config.ts. That file pulls in SSR, router generation and Tailwind, so tests
 * would run transforms they do not need, and it lacks the IndexedDB polyfill they do need.
 */
export default defineConfig({
	resolve: {
		alias: {
			"#": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		/**
		 * Wall-clock time only, the same widening `runtime-host` made: tests here build real QuickJS
		 * instances and run real compiles, and on a CI runner where turbo runs four suites at once a case
		 * that takes a second alone passed vitest's default 5 seconds (the first public CI runs). Runaway
		 * creator code is cut by the session's execution budget, not by this, so no assertion passes
		 * because of it.
		 */
		testTimeout: 30_000,
		hookTimeout: 30_000,
		/**
		 * IndexedDB is a browser API that Node does not have. A polyfill is used instead of a real
		 * browser because what is tested is our rules on top of Dexie (scope separation, transactions,
		 * cursors). A spec-conforming IndexedDB implementation gives the same results for those.
		 */
		setupFiles: [
			"./src/test/setup-indexeddb.ts",
			/** The source-locale translation instance for components rendered without the app root. */
			"./src/test/setup-i18n.ts",
			/**
			 * Globals needed by the test files that set up Monaco (`@vitest-environment jsdom`). Filling
			 * them inside a test file is too late; see that file's header for why.
			 */
			"./src/test/setup-monaco-dom.ts",
		],
		/**
		 * One process per file. Sharing module-level globals (open DB scopes) would let one file's
		 * cleanup close a connection another file opened.
		 */
		isolate: true,
	},
});
