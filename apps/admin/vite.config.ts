import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * No SSR, unlike `apps/web`, for two reasons:
 *
 * 1. Privileged data is never frozen into HTML. Server-rendered documents carrying member
 *    emails, sanction history and private titles linger in proxies, browser caches and back-button
 *    snapshots, and nothing here benefits from faster first paint.
 * 2. Authorization has one place. Every piece of data goes through the same API calls and server
 *    gates, so there is no window where privileged data is drawn before authorization.
 *
 * Routing is defined in code (`src/app/router.tsx`) to keep a generated route tree and its CLI step
 * out of the build; with around twenty routes that automation buys nothing.
 */
export default defineConfig({
	plugins: [tailwindcss(), viteReact()],
	resolve: {
		/**
		 * Pins a single React instance. Workspace packages are consumed from source and resolve React
		 * from their own location, while Vite's pre-bundle holds the app's copy separately — two Reacts
		 * at runtime, giving `Invalid hook call` / `reading 'useContext'` errors. The screen still
		 * renders, so it only surfaces in context consumers (motion provider, query client). pnpm already
		 * links one copy; the split is the bundler's resolution.
		 */
		dedupe: ["react", "react-dom", "motion", "framer-motion"],
	},
	optimizeDeps: {
		/**
		 * These packages are source (`exports` point at `.ts`); pre-bundling them would freeze their
		 * React import to a different copy — the `dedupe` problem from the other side.
		 */
		exclude: [
			"@rowcat/contracts",
			"@rowcat/design",
			"@rowcat/domain",
			"@rowcat/query",
			"@rowcat/sdk",
			"@rowcat/ui-web",
		],
	},
	server: { port: 3002 },
	preview: { port: 3002 },
});
