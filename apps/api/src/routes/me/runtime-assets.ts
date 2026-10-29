import {
	MEDIA_ERROR_CODE,
	RUNTIME_IMAGE_LIMITS,
	type RuntimeImageUploadResponse,
} from "@rowcat/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../../app.ts";
import { ApiError } from "../../lib/errors.ts";
import { requireActiveViewer } from "../../lib/gates.ts";
import { checkRateLimit } from "../../lib/rate-limit/index.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { createRuntimeImageAsset } from "../../services/runtime-image.ts";

/**
 * My runtime images: a single verb.
 *
 * ```text
 * POST  /v2/me/runtime-assets   raw image bytes in the body; returns one asset
 * ```
 *
 * - `POST`, not `PUT`: a member owns many images, so uploading adds to a collection (avatars are
 *   `PUT` because there is one per member at a fixed address). Same shape as scene images.
 * - No read: bytes come from `/v2/media/:id`. No list: the studio's asset list is the draft's own
 *   name-to-image bindings, which live in the device's draft record; the server does not know them
 *   before publication.
 * - No delete: references are scattered across drafts, other devices and published snapshots, so
 *   deleting bytes would blank images in works running on someone else's device now. Studio `Remove`
 *   only drops this draft's binding (`services/runtime-image.ts`).
 * - No target slot: the body is the image bytes themselves and the owner is always the session's
 *   member. Which draft an image belongs to is not asked either; the server knowing would turn the
 *   draft into a server resource, and authoring is local-first and E2EE.
 * - Gate is `requireActiveViewer`: this creates something shown outward once published. Creating
 *   is blocked and withdrawing (cover delete, block) stays open, as with avatars and scene images.
 */

/**
 * The body limit runs before the body is read. It is mounted on this route rather than globally so
 * one image's cap does not become the cap for login requests.
 */
const limitRuntimeImageBody = bodyLimit({
	maxSize: RUNTIME_IMAGE_LIMITS.maxBytes,
	onError: () => {
		throw new ApiError(
			413,
			MEDIA_ERROR_CODE.tooLarge,
			`Runtime images can be up to ${Math.floor(RUNTIME_IMAGE_LIMITS.maxBytes / (1024 * 1024))}MB.`,
		);
	},
});

export const meRuntimeAssets = new Hono<AppEnv>().post(
	"/",
	// The gate runs before the body limit so an ineligible request's body is never read.
	async (c, next) => {
		const viewer = requireActiveViewer(await getViewer(c));
		// The limiter also runs before the body limit so a 429 never reads the body.
		await checkRateLimit("mediaUpload", viewer.id);
		await next();
	},
	limitRuntimeImageBody,
	async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		const raw = Buffer.from(await c.req.arrayBuffer());
		const body: RuntimeImageUploadResponse = {
			asset: await createRuntimeImageAsset(viewer.id, raw),
		};
		return c.json(body);
	},
);
