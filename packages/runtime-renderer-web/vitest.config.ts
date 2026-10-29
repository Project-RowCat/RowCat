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
	},
});
