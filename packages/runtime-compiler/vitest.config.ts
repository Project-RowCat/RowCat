import { defineConfig } from "vitest/config";

/**
 * Compiler test configuration. It exists for one reason: the setup file that lets the worker's event
 * loop turn between cases (`vitest.setup.ts` says why). Test selection stays vitest's default.
 */
export default defineConfig({
	test: {
		setupFiles: ["./vitest.setup.ts"],
	},
});
