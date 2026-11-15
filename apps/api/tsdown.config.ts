import { defineConfig } from "tsdown";

/**
 * Deployment bundle, so runtime needs no TS transformer (tsx).
 *
 * `@rowcat/*` exports raw TS source with no build output, so it must be bundled; left external,
 * `node dist/index.mjs` would crash importing .ts. npm dependencies such as hono and zod stay
 * external so a deployment can swap in security patches without rebuilding.
 */
export default defineConfig({
	/**
	 * The `cli.ts` entries must be bundled too: the deployment image has no `tsx` or sources, only
	 * `dist/`, so without them nothing can be run manually during an incident.
	 *
	 * `services/mobile-updates/cli.ts` is the OTA incident hand: `pause` must work inside the
	 * production container with neither a signing key nor a repository checkout.
	 */
	entry: [
		"src/index.ts",
		"src/jobs/cli.ts",
		"src/services/mobile-updates/cli.ts",
		/**
		 * The standing promotion path (`db:seed:moderator`). First-run setup appoints one admin and closes;
		 * every operator after that is appointed here, and a compose deployment can only reach it inside
		 * the container (the database publishes no port): `node dist/db/seed-moderator.mjs`.
		 */
		"src/db/seed-moderator.ts",
		/**
		 * The publication compile thread (`services/story/runtime-compile.ts`). It is loaded by path from
		 * a `Worker`, not imported, so the bundler would not find it on its own; that file resolves it at
		 * `dist/services/story/runtime-compile-worker.mjs`.
		 */
		"src/services/story/runtime-compile-worker.ts",
	],
	outDir: "dist",
	format: "esm",
	platform: "node",
	target: "node22",
	/**
	 * `react-email` is bundled too, and that is why it is only a devDependency. Since v6 the mail
	 * components (`Html`, `Text`, `Button`, …) ship only inside that package — the per-component
	 * packages and `@react-email/components` were deprecated on 2026-11-12 — and the same package
	 * carries the preview CLI, whose esbuild, socket.io, tailwindcss and babel would otherwise ride
	 * into every image and the desktop installer. The package declares `sideEffects: false`, so the
	 * bundle keeps the components the copy imports and nothing else. `@react-email/render` (what
	 * `react-email` re-exports `render` from) stays an external runtime dependency.
	 *
	 * Removing this entry is not a build error: the bundle would import `react-email` from a
	 * `node_modules` that does not have it, and the first mail send dies with ERR_MODULE_NOT_FOUND.
	 */
	deps: { alwaysBundle: [/^@rowcat\//, /^react-email$/] },
	// Production stack traces with dist line numbers are untraceable.
	sourcemap: true,
	clean: true,
});
