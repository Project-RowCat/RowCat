import {
	MEDIA_ERROR_CODE,
	RUNTIME_AUDIO_LIMITS,
	type RuntimeAudioUploadResponse,
} from "@rowcat/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../../app.ts";
import { ApiError } from "../../lib/errors.ts";
import { requireActiveViewer } from "../../lib/gates.ts";
import { checkRateLimit } from "../../lib/rate-limit/index.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { createRuntimeAudioAsset } from "../../services/runtime-audio.ts";

/**
 * My runtime audio: a single verb.
 *
 * ```text
 * POST  /v2/me/runtime-audio   raw audio bytes in the body; returns one asset
 * ```
 *
 * - Why not a `kind` field on `/me/runtime-assets`: the request would then *claim* its kind, and
 *   that claim would pick the policy (limit, parser, stored kind). This repo already rejected
 *   body-decided generic uploads (`POST /media`), because bytes validated under the avatar cap
 *   could become a cover. With separate addresses there is no claim: bytes arriving here are
 *   validated and stored as audio whatever the request says.
 * - No read: bytes come from `/v2/media/:id` (which supports range requests for exactly this
 *   medium). No list or delete either; see `services/runtime-audio.ts`.
 * - Gate is `requireActiveViewer`: this creates something shown outward once published, as with
 *   the avatar, scene image and runtime image uploads.
 */

/**
 * The body limit runs before the body is read. It is larger than the image cap because audio's cost
 * axis differs (`RUNTIME_AUDIO_LIMITS`). It is mounted on this route rather than globally so one
 * track's cap does not become the cap for login requests.
 */
const limitRuntimeAudioBody = bodyLimit({
	maxSize: RUNTIME_AUDIO_LIMITS.maxBytes,
	onError: () => {
		throw new ApiError(
			413,
			MEDIA_ERROR_CODE.tooLarge,
			`Sound files can be up to ${Math.floor(RUNTIME_AUDIO_LIMITS.maxBytes / (1024 * 1024))}MB.`,
		);
	},
});

export const meRuntimeAudio = new Hono<AppEnv>().post(
	"/",
	// The gate runs before the body limit so an ineligible request's body is never read.
	async (c, next) => {
		const viewer = requireActiveViewer(await getViewer(c));
		// The limiter also runs before the body limit so a 429 never reads the body.
		await checkRateLimit("mediaUpload", viewer.id);
		await next();
	},
	limitRuntimeAudioBody,
	async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		const raw = Buffer.from(await c.req.arrayBuffer());
		const body: RuntimeAudioUploadResponse = {
			asset: await createRuntimeAudioAsset(viewer.id, raw),
		};
		return c.json(body);
	},
);
