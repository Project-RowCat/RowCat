import {
	AVATAR_LIMITS,
	type AvatarResponse,
	MEDIA_ERROR_CODE,
} from "@rowcat/contracts";
import { type Context, Hono, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../../app.ts";
import { ApiError } from "../../lib/errors.ts";
import { requireActiveViewer, requireViewer } from "../../lib/gates.ts";
import { checkRateLimit } from "../../lib/rate-limit/index.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { removeAvatar, setAvatar } from "../../services/account/avatar.ts";

/**
 * My profile photo: one resource, two verbs.
 *
 * - `PUT /v2/me/avatar`: body is the raw image bytes; creates or replaces.
 * - `DELETE /v2/me/avatar`: removes (idempotent).
 *
 * There is deliberately no `GET`: the avatar is public and already carried by
 * `PublicProfileDto.avatarUrl`, with bytes served by `/v2/media/:id`.
 *
 * There is no slot to name a target member (the body is bytes, not JSON), so the target is always
 * the session's member. There is no remote-URL field either: profile images come only from bytes
 * RowCat validated and stored (an arbitrary URL would be an SSRF surface and a way to publish a
 * photo without consent).
 *
 * PUT because the request means "make this resource this content". Uploading twice creates two
 * media rows (a fresh id each time), but the observable state is the last one and the replacement
 * path cleans up the displaced media (`services/account/avatar.ts`). The new id is what makes the
 * URL immutable, so it must stay.
 */

/**
 * Body cap enforced before the body is read: measuring after `c.req.arrayBuffer()` would be too
 * late, whereas `bodyLimit` checks `Content-Length` and otherwise counts the stream and cuts at the
 * limit.
 *
 * Mounted on this route only, because globally it would also sit in front of the Better Auth
 * handler and every JSON route.
 */
const limitAvatarBody = bodyLimit({
	maxSize: AVATAR_LIMITS.maxBytes,
	onError: () => {
		throw new ApiError(
			413,
			MEDIA_ERROR_CODE.tooLarge,
			`Profile photos can be up to ${Math.floor(AVATAR_LIMITS.maxBytes / (1024 * 1024))}MB.`,
		);
	},
});

/**
 * Decides write eligibility before the body is counted. `bodyLimit` buffers chunked requests (no
 * `Content-Length`) up to the cap, so a gate placed after it would let an unauthenticated request
 * load 2MiB into memory before getting a 401.
 */
const requireAvatarWriter = async (
	c: Context<AppEnv>,
	next: Next,
): Promise<void> => {
	requireActiveViewer(await getViewer(c));
	await next();
};

/**
 * Upload limiter: after the gate, before the body cap, so a 429 costs no memory. One policy
 * (`mediaUpload` in `policy.ts`) is shared by the three upload routes.
 */
const limitUploadRate = async (
	c: Context<AppEnv>,
	next: Next,
): Promise<void> => {
	const viewer = requireActiveViewer(await getViewer(c));
	await checkRateLimit("mediaUpload", viewer.id);
	await next();
};

export const meAvatar = new Hono<AppEnv>()
	/**
	 * Gate is `requireActiveViewer`: avatars show up on other people's screens (profile, comments,
	 * notifications), so a suspended or blocked account must not upload a new one. Capability
	 * restrictions (`story.publish` etc.) do not apply; avatars belong to none of their domains.
	 */
	.put(
		"/",
		requireAvatarWriter,
		limitUploadRate,
		limitAvatarBody,
		async (c) => {
			const viewer = requireActiveViewer(await getViewer(c));

			/**
			 * `Content-Type` is not read: it is a client-controlled guess. The bytes decide what was
			 * uploaded (`lib/media/image.ts`).
			 */
			const raw = Buffer.from(await c.req.arrayBuffer());

			const body: AvatarResponse = { avatar: await setAvatar(viewer.id, raw) };
			return c.json(body);
		},
	)

	/**
	 * Idempotent, and gated by `requireViewer` rather than the writer gate: removing withdraws an
	 * outward-facing display instead of creating one, and a sanctioned member must still be able to
	 * take down the very photo at issue. Same axis as cover delete under a `story.publish` restriction
	 * and block under `social.write`.
	 */
	.delete("/", async (c) => {
		const viewer = requireViewer(await getViewer(c));
		await removeAvatar(viewer.id);
		/**
		 * Always `{ avatar: null }`: a response that distinguishes "there was something" would give a
		 * retry (whose first response was lost) a different answer the second time.
		 */
		const body: AvatarResponse = { avatar: null };
		return c.json(body);
	});
