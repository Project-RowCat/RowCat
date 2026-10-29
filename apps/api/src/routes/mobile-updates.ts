import { type Context, Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { findServableRelease } from "../services/mobile-updates/index.ts";
import {
	noUpdateResponse,
	type ProtocolResponse,
	parseUpdateRequest,
	releaseResponse,
} from "../services/mobile-updates/protocol.ts";

/**
 * Mobile OTA manifest, `GET /v2/mobile/updates/manifest`.
 *
 * Called by the installed app's `expo-updates` on each cold start. No session: compatibility is set
 * by the binary (platform, native runtime, channel, trusted certificate), not the account, so the
 * response neither reads nor carries a member id.
 *
 * What this route does not do:
 * - Stream assets. The response is the manifest only; clients fetch bundles, images and fonts
 *   from the signed CDN addresses in it.
 * - Sign. It returns the bytes the release environment signed; this process has no private key.
 * - Turn a failure into an update. A failed selection query is a 503 and the client starts on its
 *   current bundle; there is no "newest anything" fallback.
 *
 * No rate limit: with no session the limiter has no trustworthy subject
 * (`docs/ops/RATE-LIMITING.md`), and a request is one index scan.
 */

const send = (c: Context<AppEnv>, response: ProtocolResponse) => {
	for (const [name, value] of Object.entries(response.headers))
		c.header(name, value);
	if (response.body === null)
		return c.body(null, response.status === 204 ? 204 : 406);
	return c.body(response.body, 200);
};

export const mobileUpdates = new Hono<AppEnv>().get("/manifest", async (c) => {
	const parsed = parseUpdateRequest((name) => c.req.header(name));
	if (!parsed.ok) {
		c.header("cache-control", "private, max-age=0");
		return c.json(
			{
				code: parsed.code,
				message: parsed.message,
				requestId: c.get("requestId"),
			},
			parsed.status,
		);
	}
	const { request } = parsed;

	let release: Awaited<ReturnType<typeof findServableRelease>>;
	try {
		release = await findServableRelease({
			platform: request.platform,
			channel: request.channel,
			runtimeVersion: request.runtimeVersion,
			keyId: request.keyId,
			installationId: request.installationId,
		});
	} catch (error) {
		/** Neither the installation id nor headers are logged; only the fact that selection failed. */
		console.error(
			`[mobile-updates] selection failed ${request.platform}/${request.channel}/${request.runtimeVersion}`,
			error,
		);
		c.header("cache-control", "private, max-age=0");
		return c.json(
			{
				code: "mobile_update_unavailable",
				message:
					"Couldn't choose an update. Continuing with the bundle you have now.",
				requestId: c.get("requestId"),
			},
			503,
		);
	}

	if (!release) return send(c, noUpdateResponse(request.channel));
	return send(c, releaseResponse(request.channel, request, release));
});
