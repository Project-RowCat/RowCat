import { defineConfig } from "vitest/config";

/**
 * Test configuration for one reason, the time budget (the same one `runtime-host` widened). Only the
 * timeout is set, so which files run stays vitest's default.
 */
export default defineConfig({
	test: {
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
