import { randomUUID } from "node:crypto";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";

/**
 * Points the use-sync-external-store shim import at the canonical path.
 *
 * The package is CJS and only reached transitively, through @base-ui/react and
 * @tanstack/react-store. The problem shows only in the SSR bundle: the canonical path stays in the
 * chunk that bundles react, but the shim path splits into another chunk and leaves a
 * `createRequire(import.meta.url)('react')` call behind. The runtime image has no node_modules, so
 * SSR dies with `Cannot find module 'react'`. In local dev with node_modules, it creates two React
 * instances and fails with a null dispatcher error. Either way the page returns 200 and silently
 * falls back to client rendering.
 *
 * The shim is a compatibility implementation for React 16 and 17. This app is on React 19, where
 * the canonical path is React's built-in implementation with the same export names, so the alias
 * changes chunking, not behavior. Remove the alias if React below 18 must be supported; then the
 * shim is needed.
 */
const useSyncExternalStoreAliases = [
	{
		find: /^use-sync-external-store\/shim\/with-selector(\.js)?$/,
		replacement: "use-sync-external-store/with-selector.js",
	},
	{
		find: /^use-sync-external-store\/shim(\/index(\.js)?)?$/,
		replacement: "use-sync-external-store",
	},
];

/**
 * Security headers for web responses:
 * - X-Frame-Options DENY: clickjacking on the account-deletion and guardian-consent screens.
 * - X-Content-Type-Options: MIME sniffing.
 * - Referrer-Policy: keeps conversation URLs from leaking to other origins (external images,
 *   links). A page-wide default sits above the per-<img> no-referrer.
 * - Permissions-Policy: closes device capabilities the app does not use.
 * - Strict-Transport-Security: production builds only; development runs on http.
 * - CSP (report-only): see below.
 *
 * Why CSP is report-only: TanStack Start embeds hydration state in an inline script, and this setup
 * has no way to attach a nonce to it. Enforcing `script-src 'self'` would keep every page from
 * hydrating; adding `'unsafe-inline'` would make that directive block nothing. So the policy is
 * written but only counts violations. The browser logs them, and that list is the basis for
 * switching to enforcement. All other headers are enforced.
 *
 * `connect-src` covers the build-time API origin and the BYO providers. The deployed API origin is a
 * runtime value now (`lib/api.ts`) and these route rules are fixed at build, so an image built without
 * `VITE_API_ORIGIN` reports its API calls here; that is a report, not a block, and the reason to fill
 * this from the runtime value before switching to enforcement. The values match
 * PROVIDER_CONNECT_ORIGINS in lib/generation/router.ts. This config file cannot import app source,
 * so they are repeated here.
 */
function securityHeaders(): Record<string, string> {
	const production = process.env.NODE_ENV === "production";
	const apiOrigin =
		process.env.VITE_API_ORIGIN?.trim() || "http://localhost:3001";
	const csp = [
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: http: https:",
		"font-src 'self' data:",
		`connect-src 'self' ${apiOrigin} https://api.anthropic.com https://generativelanguage.googleapis.com https://cdn.portone.io https://*.portone.io`,
		"frame-src https://*.portone.io",
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join("; ");
	return {
		"X-Frame-Options": "DENY",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "strict-origin-when-cross-origin",
		"Permissions-Policy":
			"camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
		"Content-Security-Policy-Report-Only": csp,
		...(production
			? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }
			: {}),
	};
}

/**
 * Pre-bundles the heavy dependencies the preview worker imports first, at server start. The dev
 * server does not know a dependency it meets for the first time: it optimizes it and reloads the
 * whole page. If that dependency is the preview worker's (TypeScript compiler, QuickJS), the reload
 * lands right after the creator presses Run preview, and the reloaded page comes back without the
 * run. Listing them here moves that discovery to startup. The production build does not read this
 * list.
 *
 * The studio's own TypeScript worker (`monaco-ts.worker.ts`) is the same case: on an empty cache its
 * two Monaco imports were discovered after Run preview and reloaded the page mid-run (the CI journey
 * caught it; a developer's warm `.vite` cache never shows it).
 */
const previewWorkerDependencies = [
	"typescript-compiler-api",
	"quickjs-emscripten-core",
	"@jitl/quickjs-ng-wasmfile-release-sync",
	"monaco-editor/internal/common/initialize",
	"monaco-editor/languages/features/typescript/tsWorker",
];

/**
 * The identity of one build output: baked into the bundle as `__ROWCAT_BUILD_ID__` and written beside
 * it as `/rowcat-build.json`. An open tab compares the two to learn that the server now serves another
 * build (`src/lib/build-freshness/freshness.ts`).
 *
 * **One random value per build, not the commit.** The image build has no `.git` to read, and an env
 * value would have to be declared to turbo and passed into the Dockerfile — one more deployment knob for
 * a fact the build already knows. A random id cannot collide across builds, every replica of one image
 * carries the same one, and a turbo cache hit replays the same output with the same id. Rebuilding the
 * same commit gives a new id; open tabs then take one document load they did not need, which is harmless.
 *
 * Evaluated once per `vite build`, so the client and server environments share it.
 */
const BUILD_ID = randomUUID();

/**
 * Writes the id where the server serves it: the client output's root, which nitro serves as static
 * files. Not under `/assets/` — that path is cached as immutable for a year — and the route rule below
 * forbids caching it anywhere (a proxy holding the old answer would hide every new deployment).
 */
function buildManifest(): Plugin {
	return {
		name: "rowcat-build-manifest",
		apply: "build",
		generateBundle() {
			if (this.environment.name !== "client") return;
			this.emitFile({
				type: "asset",
				fileName: "rowcat-build.json",
				source: `${JSON.stringify({ buildId: BUILD_ID })}\n`,
			});
		},
	};
}

const config = defineConfig({
	define: { __ROWCAT_BUILD_ID__: JSON.stringify(BUILD_ID) },
	optimizeDeps: { include: previewWorkerDependencies },
	resolve: {
		tsconfigPaths: true,
		alias: useSyncExternalStoreAliases,
	},
	plugins: [
		devtools(),
		nitro({
			rollupConfig: { external: [/^@sentry\//] },
			/**
			 * Security headers for every response. This app renders other people's content (works,
			 * conversations, comments, avatars), and for a time it sent no headers at all, while the
			 * operator console's nginx had four. The reasoning for each value is in the securityHeaders()
			 * header comment.
			 */
			routeRules: {
				"/**": { headers: securityHeaders() },
				"/rowcat-build.json": { headers: { "cache-control": "no-store" } },
			},
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
		buildManifest(),
	],
});

export default config;
