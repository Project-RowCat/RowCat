import { defineConfig, devices } from "@playwright/test";
import {
	API_ORIGIN,
	E2E_API_PORT,
	FORWARDED_ORIGIN,
	STUB_ORIGIN,
	STUB_PORT,
	WEB_ORIGIN,
	WEB_PORT,
} from "./e2e/support/origins.ts";
/**
 * Browser journey config. Runs the conversation lifecycle on the real stack, which is why this file
 * differs from the other tests.
 * - apps/web vitest does not render React (its config explains why). That is correct for pure
 *   rules and local storage, but the questions this hardening pass asks cannot be expressed at that
 *   layer: whether a conversation survives a reload (IndexedDB lifetime belongs to the browser),
 *   whether stop actually cuts the stream (there must be a real connection), whether switching
 *   accounts removes the previous user's rooms (scope switching spans the app shell), and whether a
 *   deleted room's address cannot come back (router, subscriptions and tombstones interact).
 * - Ports. 3021 is the journey API, deliberately not the dev port 3001. It starts with
 *   journey-only deployment settings (auth callback trust list, managed generation access), and
 *   sharing 3001 would silently run a developer's journey on another deployment
 *   (support/origins.ts). 3011 is the generation stub proxy: it intercepts only /chat/generate and
 *   forwards the rest. 3100 is the journey web, whose VITE_API_ORIGIN points at the stub. The web
 *   is not on 3000 so a dev server can keep running alongside, and the journey web must not share
 *   the dev address because it is built to see the stub.
 * - Serial. Journeys share one database and browser profile family, and account-isolation
 *   journeys switch sessions. In parallel, one journey's session switch would disturb another, and
 *   that failure would not reproduce. With few journeys, the serial cost is small.
 */

export default defineConfig({
	testDir: "./e2e/journeys",
	/**
	 * Fixed fixtures are re-seeded on every run. The reason is in that file's header: the api suite's
	 * cleanup deletes unowned data, so a journey run after `pnpm test` would start without its
	 * fixtures.
	 */
	globalSetup: "./e2e/support/global-setup.ts",
	workers: 1,
	fullyParallel: false,
	/**
	 * No retries. These journeys mostly catch races, and a retry would turn a failure into a pass,
	 * erasing the very signal they exist to surface.
	 */
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
	use: {
		baseURL: WEB_ORIGIN,
		trace: "retain-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "desktop",
			/**
			 * Narrow-screen journeys are excluded here. Without this they also run at 1280px, where surfaces
			 * that do not exist there (drawer trigger, overflow menu) are searched for and fail. Pairs with
			 * the `narrow` testMatch below.
			 */
			testIgnore: /narrow\.spec\.ts$/,
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1280, height: 900 },
			},
		},
		{
			/**
			 * The narrow viewport is its own project. It does not run the same journeys at two widths. It
			 * checks only what actually changes with width (the navigation surface that moves into a drawer,
			 * the input box, the action menu). Running everything twice would double the time without
			 * catching more defects.
			 */
			name: "narrow",
			testMatch: /narrow\.spec\.ts$/,
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 375, height: 780 },
			},
		},
	],
	webServer: [
		{
			name: "api",
			/**
			 * Starts the product API unchanged. The entry point is the same as `pnpm --filter @rowcat/api
			 * dev`, minus watch mode. It uses the same cwd and .env, so the journey never asks the developer
			 * to edit their configuration. Values that must differ per journey are overridden by `env`
			 * below.
			 *
			 * An earlier entry point forwarded external payment calls to a fake provider. Payments were
			 * removed and the API no longer makes outbound calls mid-journey (the stub receives generation),
			 * so that entry point was removed too.
			 */
			command: "pnpm exec tsx --env-file-if-exists=.env src/index.ts",
			/** Playwright resolves `cwd` relative to this config file's location. */
			cwd: "apps/api",
			port: E2E_API_PORT,
			/**
			 * This port is journey-only, so whatever answers here is always the journey API. There is no
			 * path that could reuse a dev instance by accident.
			 */
			reuseExistingServer: !process.env.CI,
			env: {
				PORT: String(E2E_API_PORT),
				API_ORIGIN: API_ORIGIN,
				/**
				 * The auth callback trust list. It is a separate axis from WEB_ORIGIN (CORS).
				 *
				 * Better Auth checks callbackURL against trustedOrigins (advanced.disableOriginCheck: false).
				 * When that list is empty it is derived from WEB_ORIGIN. The journey web runs on 3100, which is
				 * not in that derived value, so the login form's callback was rejected with 403
				 * INVALID_CALLBACK_URL. The screen showed only `Incorrect email or password`, because the
				 * account-enumeration rule hides the real reason. This gap only appeared once a journey went
				 * through the login form. The other journeys create accounts via the API and send no
				 * callbackURL.
				 *
				 * Both values are needed:
				 * - FORWARDED_ORIGIN: the origin the stub tells upstream it is. Every preparation request
				 *   carries it.
				 * - WEB_ORIGIN: where the browser actually stands. The callback address carries it.
				 *
				 * Without the first, this list replaces the derived value and every preparation request through
				 * the stub gets 403 INVALID_ORIGIN. Leave WEB_ORIGIN (CORS) alone; setting it to 3100 would
				 * make the stub's rewrite pointless.
				 */
				AUTH_TRUSTED_ORIGINS: `${FORWARDED_ORIGIN},${WEB_ORIGIN}`,
				/**
				 * Opens managed generation to all members. The deployment default is an allowlist. Accounts
				 * that each journey creates are not on it, and the stub forwards managed generation upstream
				 * without a scripted response, so the request is blocked with 403 chat_managed_not_allowed. The
				 * journey checks the conversation lifecycle, not the allowlist; the api suite checks the
				 * allowlist on real Postgres. Without this value, the failure screen (`Connect your own API key in AI settings`) becomes the product's normal branch, and the config cause is hidden.
				 */
				MANAGED_GENERATION_ACCESS: "everyone",
			},
			timeout: 120_000,
			stdout: "pipe",
			stderr: "pipe",
		},
		{
			name: "generation-stub",
			command: "node --import tsx e2e/support/stub-server.ts",
			port: STUB_PORT,
			env: {
				E2E_STUB_PORT: String(STUB_PORT),
				E2E_API_ORIGIN: API_ORIGIN,
				E2E_WEB_ORIGIN: WEB_ORIGIN,
			},
			reuseExistingServer: !process.env.CI,
			timeout: 60_000,
			stdout: "pipe",
			stderr: "pipe",
		},
		{
			name: "web",
			command: `pnpm --filter web exec vite dev --port ${WEB_PORT} --strictPort`,
			port: WEB_PORT,
			env: {
				VITE_API_ORIGIN: STUB_ORIGIN,
			},
			reuseExistingServer: !process.env.CI,
			timeout: 180_000,
			stdout: "pipe",
			stderr: "pipe",
		},
	],
});
