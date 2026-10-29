import {
	STORY_COVER_ERROR_CODE,
	STORY_COVER_LIMITS,
	type StoryCoverResponse,
} from "@rowcat/contracts";
import { type Context, Hono, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../../app.ts";
import { normalizeCoverImage } from "../../lib/cover-image.ts";
import { ApiError, notFound } from "../../lib/errors.ts";
import { requireActiveViewer } from "../../lib/gates.ts";
import { etagOf, notModified, toArrayBuffer } from "../../lib/http.ts";
import { checkRateLimit } from "../../lib/rate-limit/index.ts";
import { getViewer } from "../../middleware/viewer.ts";
import { requireCapability } from "../../services/moderation-capability.ts";
import {
	assertStoryOwned,
	removeStoryCover,
	setStoryCover,
} from "../../services/story/cover.ts";
import { getCover, getStory } from "../../services/story/index.ts";
import { lookupSelector } from "./access.ts";

/**
 * Story cover: one resource, one router. Reading used to live in `routes/stories/index.ts`; the
 * three verbs share one file because they act on the same value, and scattered copies would each
 * write their own cache and exposure rules.
 *
 * ```text
 * GET     anyone, but only if the story is visible to them
 * PUT     owner only; the body is the raw image bytes
 * DELETE  owner only; idempotent
 * ```
 *
 * Read and write authorization are different questions. Reading asks "is this story visible to this
 * viewer" and uses exactly the detail predicate (`lookupSelector` → `getStory`); without it a
 * private story's cover leaks by id, and a cover usually says what the story is. Writing asks "is
 * this mine", and nothing the browser sends enters that decision: the predicate sits in the
 * service's SELECT and the owner comes only from the session.
 *
 * `immutable` is attached only after comparing `?v=`. `v` is the content identity of the stored
 * bytes (`story_cover.version`); if a request names a different version, serving the current bytes
 * as `immutable` would make "this address never changes" false, and browsers believe that for a
 * year. Old-version requests are therefore served the current bytes with `no-cache` rather than
 * refused: a 404 would break screens still holding old HTML (SSR cache, back button, open tabs)
 * through no fault of the user. What is invalid is the cache eligibility, not the resource.
 */

/**
 * The limit that stands before the body is read. A size check after `c.req.arrayBuffer()` runs with
 * everything already in memory; `bodyLimit` checks `Content-Length` first and otherwise counts the
 * stream and cuts at the cap. It is mounted on this route only, not globally, so it does not also
 * front the Better Auth handler and every JSON route.
 *
 * The cap is the larger per-format value (GIF, 20MiB) because the format is unknown before reading.
 * The narrower still-image cap (5MiB) is enforced after the signature check by the normalization
 * boundary with the same error code (`lib/media/image.ts`).
 */
const MAX_COVER_BODY = Math.max(
	STORY_COVER_LIMITS.maxBytes,
	STORY_COVER_LIMITS.maxAnimatedBytes,
);

const limitCoverBody = bodyLimit({
	maxSize: MAX_COVER_BODY,
	onError: () => {
		throw new ApiError(
			413,
			STORY_COVER_ERROR_CODE.tooLarge,
			`Covers can be up to ${Math.floor(MAX_COVER_BODY / (1024 * 1024))}MB.`,
		);
	},
});

/**
 * Decides writer eligibility before the body is counted. `bodyLimit` buffers requests without
 * `Content-Length` (chunked) up to the cap, so a gate behind it would let an unauthenticated
 * request put 5MiB in memory before getting a 401.
 *
 * Viewer resolution happens once per request, so the handler passing the same gate again costs no
 * query. The value is not planted on the context to avoid that, since it would create a second
 * viewer channel that only works on this route.
 */
const requireCoverWriter = async (
	c: Context<AppEnv>,
	next: Next,
): Promise<void> => {
	const viewer = requireActiveViewer(await getViewer(c));
	await requireCapability(viewer.id, "story.publish");
	await next();
};

/**
 * Ownership and the rate limiter stand before the body. The order used to be gate, body, transcode,
 * ownership check, so anyone with `story.publish` could upload a 20MiB 300-frame GIF to another
 * person's story id, make the process decode ~160MB, and only then get a 404. This is a lock-free
 * existence check; the authority is still the `FOR UPDATE` inside `setStoryCover`.
 */
const requireOwnedStory = async (
	c: Context<AppEnv>,
	next: Next,
): Promise<void> => {
	const viewer = requireActiveViewer(await getViewer(c));
	await checkRateLimit("mediaUpload", viewer.id);
	await assertStoryOwned(storyIdOf(c.req.param("id")), viewer.id);
	await next();
};

/**
 * Always present under the `/:id/cover` mount, but types cannot see the parent's path pattern. A
 * missing value folds into "story not found" so this router has one failure shape.
 */
const storyIdOf = (value: string | undefined): string => {
	if (!value) throw notFound("Story not found.");
	return value;
};

export const storyCover = new Hono<AppEnv>()
	.get("/", async (c) => {
		const id = storyIdOf(c.req.param("id"));
		// Same exposure boundary as the story body; see the header.
		const { selector } = await lookupSelector(c);
		if (!(await getStory(id, selector))) throw notFound("Cover not found.");

		const cover = await getCover(id);
		if (!cover) throw notFound("Cover not found.");

		/** The ETag derives from `version` too, so address identity and validator cannot diverge and no per-request hashing is needed. */
		const etag = etagOf(cover.version);
		c.header("ETag", etag);
		c.header("Content-Type", cover.mime);
		/** Only normalized raster images are stored, so sniffing has little room; that makes this header cheap, not removable. */
		c.header("X-Content-Type-Options", "nosniff");
		c.header(
			"Cache-Control",
			c.req.query("v") === cover.version
				? "private, max-age=31536000, immutable"
				: "private, no-cache",
		);
		if (notModified(c, etag)) return c.body(null, 304);
		return c.body(toArrayBuffer(cover.bytes));
	})

	/**
	 * PUT because the request means "set this resource to this content": uploading the same file twice
	 * gives the same result, and names like `/upload-cover` would give one resource two paths. The
	 * gate matches publishing (`requireActiveViewer` + `story.publish`) since a cover is catalogue
	 * content.
	 */
	.put(
		"/",
		requireCoverWriter,
		requireOwnedStory,
		limitCoverBody,
		async (c) => {
			const id = storyIdOf(c.req.param("id"));
			const viewer = requireActiveViewer(await getViewer(c));

			/** `Content-Type` is not read: browsers guess it from the extension and attackers set it freely; the bytes decide. */
			const raw = Buffer.from(await c.req.arrayBuffer());

			/**
			 * Normalization comes before the DB: a broken replacement gets a 400 and the original cover
			 * stays, whereas validate-after-delete would lose it. It is also outside any transaction because
			 * decode/resize/re-encode takes hundreds of ms and would hold one of ten pool connections,
			 * slowing unrelated requests.
			 */
			const cover = await normalizeCoverImage(raw);

			const body: StoryCoverResponse = {
				story: await setStoryCover(id, viewer.id, cover),
			};
			return c.json(body);
		},
	)

	/**
	 * Idempotent. The `story.publish` capability limit is not applied: it restricts writes that reach
	 * the catalogue, and deleting a cover withdraws something already out. Stopping a sanctioned
	 * creator from taking down the very image at issue would be a dead end, the same axis as blocking
	 * staying open under a `social.write` restriction.
	 */
	.delete("/", async (c) => {
		const id = storyIdOf(c.req.param("id"));
		const viewer = requireActiveViewer(await getViewer(c));
		const body: StoryCoverResponse = {
			story: await removeStoryCover(id, viewer.id),
		};
		return c.json(body);
	});
