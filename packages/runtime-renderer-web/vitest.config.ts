import { defineConfig } from "vitest/config";

/**
 * Renderer test config. The default environment is Node, so pure rules (the style table, bounds
 * checks) run without a DOM. Only files that need a DOM choose jsdom, with an @vitest-environment
 * jsdom directive at the top of the file. If everything ran under jsdom, the pipeline tests that
 * start QuickJS would run on jsdom's globals. That combination is not what we mean to verify.
 */
export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		/**
		 * Wall-clock time only, the same widening `runtime-host` made: tests here build real QuickJS
		 * instances and run real compiles, and on a CI runner where turbo runs four suites at once a case
		 * that takes a second alone passed vitest's default 5 seconds (the first public CI runs). Runaway
		 * creator code is cut by the session's execution budget, not by this, so no assertion passes
		 * because of it.
		 */
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
