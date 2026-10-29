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
	],
	outDir: "dist",
	format: "esm",
	platform: "node",
	target: "node22",
	deps: { alwaysBundle: [/^@rowcat\//] },
	// Production stack traces with dist line numbers are untraceable.
	sourcemap: true,
	clean: true,
});
