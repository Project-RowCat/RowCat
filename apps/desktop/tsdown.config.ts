import { defineConfig } from "tsdown";

/**
 * The Electron main process as one file. `@rowcat/*` exports TS source with no build output, so it
 * is folded in (`apps/mcp` makes the same arrangement).
 *
 * `embedded-postgres` stays external: it finds its server binaries by importing the platform package
 * (`@embedded-postgres/<os>-<arch>`) at runtime, and those are executables that have to sit as files
 * in the app's `node_modules`, not inside a bundle.
 */
export default defineConfig({
	entry: ["src/main.ts"],
	outDir: "dist",
	format: "esm",
	platform: "node",
	target: "node22",
	deps: { alwaysBundle: [/^@rowcat\//] },
	external: ["electron", "embedded-postgres"],
	sourcemap: true,
	clean: true,
});
