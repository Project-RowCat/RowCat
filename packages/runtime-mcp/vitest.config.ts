import { defineConfig } from "vitest/config";

/**
 * MCP test configuration. It exists for the same one reason as `runtime-host`'s: the time budget.
 *
 * The agent-loop tests compile real projects with the TypeScript compiler and run them in real
 * QuickJS/WASM instances, several times per case. Alone a case takes about a second; on a CI runner
 * where turbo runs four suites at once, the first public CI run cut one at vitest's default 5 seconds
 * (`agent-scenario.test.ts`). That was contention, not a product defect.
 *
 * Only wall-clock time is widened. Runaway creator code is cut by the session's execution budget, not
 * by this timeout, so raising it makes no assertion pass.
 */
export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
