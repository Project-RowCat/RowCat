import { defineConfig } from "vitest/config";

/**
 * Host test configuration. It exists for one reason: the time budget.
 *
 * Tests in this package build real QuickJS/WASM instances. One case runs TSX compilation, artifact
 * validation, WASM instance creation, prelude and generated sandbox installation, creator ESM graph
 * evaluation, and mounting. Even run in isolation, a case can exceed 3 seconds. vitest's default
 * timeout of 5 seconds was never chosen deliberately. In the full workspace (`pnpm test`), the API,
 * web, and other packages share the same machine's cores, which pushes those 3 seconds past 5. The
 * failure shows as `Test timed out in 5000ms`. Run alone, all 325 tests pass, so that failure
 * reflects momentary contention, not a product defect.
 *
 * The judgment does not loosen. Only wall-clock time is widened. Infinite loops are cut by the
 * session's execution budget, not by this timeout (a test in this package verifies that budget), so
 * raising this value makes no assertion pass.
 */
export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		/** Time to set up the WASM VM, not a product budget. Generous even under contention. */
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
