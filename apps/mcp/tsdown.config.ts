import { defineConfig } from "tsdown";

/**
 * Distribution bundle: the only reason this package runs outside the repository. `@rowcat/*`
 * exports TS source with no build output, and an installed machine has no workspace symlinks to
 * find those names (`apps/api` makes the same arrangement).
 *
 * `@rowcat/*` is bundled because it is not published, and keeping it external would turn `sync`,
 * `authoring`, `runtime-host`, `runtime-compiler` and `runtime-mcp` into supported public APIs; the
 * one product is `@rowcat/mcp`. npm dependencies stay external so installers can swap in security
 * patches without a rebuild.
 *
 * Two dependencies must stay external and be direct dependencies of `@rowcat/mcp`, because they are
 * read as files (the bundle erases transitive paths) via `createRequire(import.meta.url)`:
 * `@jitl/quickjs-ng-wasmfile-release-sync` (`dist/emscripten-module.wasm`) and
 * `typescript-compiler-api` (`lib/lib.*.d.ts`). `package-imports.test.ts` pins that pairing.
 */
export default defineConfig({
	entry: ["src/index.ts"],
	outDir: "dist",
	format: "esm",
	platform: "node",
	target: "node22",
	deps: { alwaysBundle: [/^@rowcat\//] },
	/**
	 * The shebang is replaced here: the source one requires `--experimental-strip-types`, which the
	 * bundle does not need and which, depending on the installed Node version, prints a warning or is
	 * refused; output on stdout breaks JSON-RPC.
	 */
	outputOptions: {
		banner: "#!/usr/bin/env node",
		/**
		 * Emit source maps but not sources. The bundle folds `@rowcat/*` whole, so the default
		 * `sourcesContent` would freeze the TypeScript originals of `packages/sync`, `authoring` and
		 * `runtime-*` into an immutable npm version — the source's place is the repository, which is
		 * where the AGPL's corresponding source points. The rule was paid for in `0.1.0-alpha.1`, while
		 * the repository was still private (recorded in the README's retraction paragraph). Mappings stay
		 * so user stack traces still resolve to file and line.
		 */
		sourcemapExcludeSources: true,
	},
	sourcemap: true,
	clean: true,
});
