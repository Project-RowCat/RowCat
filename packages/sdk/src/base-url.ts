import { API_BASE_PATH } from "@rowcat/contracts/http";

/**
 * The base URL. The origin is always supplied by the app. The base path (`/v2`) comes from
 * @rowcat/contracts; this module only joins the two.
 *
 * - This package has no production origin constant. An earlier default pointed at one operator's
 *   server. A fork that forgot to pass its origin would silently send login, upload, and generation
 *   requests to someone else's production server, which is worse than an error. So a missing origin
 *   throws.
 * - The deployment config picks the origin: web and the ops console use `VITE_API_ORIGIN`, mobile
 *   uses `EXPO_PUBLIC_API_ORIGIN`, and MCP uses `ROWCAT_API_BASE_URL`.
 * - The package does not read `import.meta.env` or `process.env`. Doing so would bind it to one
 *   bundler or runtime.
 */

/**
 * Local dev server origin (apps/api's default HOST/PORT). A local default, not a production one.
 */
export const DEVELOPMENT_API_ORIGIN = "http://localhost:3001";

/**
 * Builds the base URL from an origin, with no trailing slash. Callers append paths like
 * `${base}/stories`, and a trailing slash here would produce `//stories`.
 *
 * An empty or missing origin is an error. The type says `string`, but the runtime value comes from
 * config, and `undefined` does reach here through `as string`, so it is checked again.
 */
export const apiBaseUrl = (origin: string): string => {
	if (typeof origin !== "string" || origin.trim() === "")
		throw new Error(
			"No API origin: @rowcat/sdk has no default origin. Pass the origin from deployment settings " +
				"(e.g. VITE_API_ORIGIN · EXPO_PUBLIC_API_ORIGIN).",
		);
	return new URL(API_BASE_PATH, origin.trim()).toString();
};
