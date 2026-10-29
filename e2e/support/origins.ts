/**
 * The addresses the journeys use. Settings, fixtures and browser code all read the same values.
 *
 * The constants are separate because misalignment is silent. If the settings serve the web on 3100
 * but the fixture requests 3000, that request reaches the dev server and succeeds, so the journey
 * goes green without knowing what it runs against. Or cookies land in the wrong place and show an
 * unexplained 401.
 *
 * - 3021: journey API, separate from the dev API (3001). See below.
 * - 3011: generation stub (proxy), the only API address the browser knows.
 * - 3100: journey web.
 *
 * The journey API does not use the dev port because it now starts with its own deployment settings:
 * trusted origins for auth callbacks, and `MANAGED_GENERATION_ACCESS=everyone`, which opens managed
 * generation to every member (see the api server entry in `playwright.config.ts`). On port 3001
 * those settings would silently apply to whoever has the dev server running, since
 * `reuseExistingServer` reuses it. The dev API defaults to allow-list mode, so managed generation
 * for a new account gets a 403 when the stub forwards without a script. The resulting screen, which
 * asks the user to connect a personal API key in AI settings, is also a normal state in this repo,
 * so the real cause would not be visible. A separate port keeps that state expressible.
 */

export const E2E_API_PORT = 3021;
export const STUB_PORT = 3011;
export const WEB_PORT = 3100;

/** The journey API. Journeys never connect to it directly; they go through the stub. */
export const API_ORIGIN = `http://localhost:${E2E_API_PORT}`;

/**
 * The generation stub (proxy), the only API address the browser knows. Fixture setup requests also
 * go here, because the browser and the fixtures must share where cookies are set.
 */
export const STUB_ORIGIN = `http://localhost:${STUB_PORT}`;

export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

/**
 * The origin the stub claims to be when talking to the upstream API.
 *
 * Forwarding the browser's origin (3100) fails, because it is not in the API's trusted list.
 * Stripping `Origin` fails too: Better Auth then rejects with `MISSING_OR_NULL_ORIGIN`. That check
 * is CSRF defense, so disabling it is not the answer. Instead the stub swaps in a dev origin that
 * is already trusted (`support/stub-server.ts`).
 *
 * This value lives here because it has two consumers: the stub writes it in the header, and
 * `playwright.config.ts` passes it in the API's `AUTH_TRUSTED_ORIGINS`. Setting that list replaces
 * the default derived from `WEB_ORIGIN` entirely, so omitting this value would make every setup
 * request through the stub fail with 403 `INVALID_ORIGIN`.
 */
export const FORWARDED_ORIGIN =
	process.env.E2E_FORWARDED_ORIGIN ?? "http://localhost:3000";
