import {
	MEDIA_ERROR_CODE,
	SCENE_IMAGE_LIMITS,
	type SceneImageUploadResponse,
} from "@rowcat/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../../app.ts";
import { ApiError } from "../../lib/errors.ts";
import { requireActiveViewer } from "../../lib/gates.ts";
import { checkRateLimit } from "../../lib/rate-limit/index.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { createSceneImageAsset } from "../../services/scene-image.ts";

/**
 * My scene images: a single verb.
 *
 * ```text
 * POST  /v2/me/scene-images   raw image bytes in the body; returns one asset
 * ```
 *
 * - `POST`, not `PUT`: avatars are `PUT` because there is one per member at a fixed address; here
 *   a member owns many, so uploading adds to a collection.
 * - No read: bytes come from `/v2/media/:id`. No list: nothing draws "all my scene images"; the
 *   references live in the device's draft, and that list is what the screen draws.
 * - No delete: references are scattered across drafts, published snapshots and other people's
 *   devices, so deleting bytes would blank images in conversations in progress right now
 *   (`services/scene-image.ts`).
 * - No target slot: the body is the image bytes themselves and the owner is always the session's
 *   member.
 * - Gate is `requireActiveViewer`: this creates something shown outward once published. Creating
 *   is blocked and withdrawing (cover delete, block) stays open.
 */

/**
 * The body limit runs before the body is read. It is mounted on this route rather than globally so
 * one image's cap does not become the cap for login requests.
 */
const limitSceneImageBody = bodyLimit({
	maxSize: SCENE_IMAGE_LIMITS.maxBytes,
	onError: () => {
		throw new ApiError(
			413,
			MEDIA_ERROR_CODE.tooLarge,
			`Scene images can be up to ${Math.floor(SCENE_IMAGE_LIMITS.maxBytes / (1024 * 1024))}MB.`,
		);
	},
});

export const meSceneImages = new Hono<AppEnv>().post(
	"/",
	// The gate runs before the body limit so an ineligible request's body is never read.
	async (c, next) => {
		const viewer = requireActiveViewer(await getViewer(c));
		// The limiter also runs before the body limit so a 429 never reads the body.
		await checkRateLimit("mediaUpload", viewer.id);
		await next();
	},
	limitSceneImageBody,
	async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		const raw = Buffer.from(await c.req.arrayBuffer());
		const body: SceneImageUploadResponse = {
			asset: await createSceneImageAsset(viewer.id, raw),
		};
		return c.json(body);
	},
);
