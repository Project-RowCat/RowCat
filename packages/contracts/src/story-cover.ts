import { z } from "zod";
import { StoryDto } from "./gallery.ts";

/**
 * Contract for one story cover resource: read, replace, and delete. A cover is a separate resource
 * attached to a published story, not part of the publication payload. That is why publication.ts
 * has no cover field.
 *
 * - PUT /v2/stories/:id/cover: binary body, creates or replaces the cover.
 * - DELETE /v2/stories/:id/cover: removes it (idempotent).
 * - GET /v2/stories/:id/cover: reads the bytes, under the same exposure boundary as the story.
 *
 * Not here:
 * - Image bytes as JSON fields (coverBase64, coverDataUrl, coverBytes). The legacy code stored
 *   data URLs in the story row, so even list responses carried megabytes of base64. JSON carries
 *   only the address (StoryDto.coverUrl).
 * - The original file name, which often contains personal names or local folder conventions.
 * - Storage details (format, path, size, resolution). A changed cover shows up in the story's
 *   coverUrl.
 *
 * There is no request-body schema by design. The PUT body is raw bytes, and the contract must not
 * accept a client-declared format: the server ignores Content-Type and decodes the bytes itself.
 * STORY_COVER_INPUT_MIME is a file-picker hint, not validation.
 */

/**
 * Upload caps live in one place because the server is the final authority and the screen only
 * previews them, so the copy cannot drift from enforcement. Byte caps are per format, and the route
 * bodyLimit takes the larger one because the format is unknown until the body is read. The
 * per-format cap is enforced after the signature check (apps/api/src/lib/cover-image.ts). Pixel
 * caps (maxPixels, maxDimension, maxAnimatedPixels, maxFrames) exist because file size cannot
 * measure decompression bombs: a few hundred KB can expand to billions of pixels. The 5 MiB
 * still-image cap fits a 2000x2667 high-quality JPEG and bounds the memory one request can use. The
 * legacy 8MB base64 limit was not carried over.
 */
export const STORY_COVER_LIMITS = {
	maxBytes: 5 * 1024 * 1024,
	/**
	 * Animated covers get a much larger byte cap because GIF stores a full palette image per frame, so
	 * the same scene can take several times the bytes of a JPEG. A 5 MiB cap would block many real
	 * GIFs. The real cost is decoded pixels, which diverge sharply from file size for GIF, so the
	 * pixel budgets (maxAnimatedPixels, maxFrames) carry the limit instead.
	 */
	maxAnimatedBytes: 20 * 1024 * 1024,
	/** Pixels per frame. Still and animated images are bound by this value alike. */
	maxPixels: 24_000_000,
	maxDimension: 10_000,
	/**
	 * Total pixels across all frames, for animated covers only. Without it, dropping the byte cap
	 * would also drop the memory cap. libvips treats an animation as one image with frames stacked
	 * vertically, so a 500x500 GIF with 500 frames becomes one 125-million-pixel image.
	 */
	maxAnimatedPixels: 40_000_000,
	/**
	 * Kept separate from the pixel budget because users fix the two problems differently. Shrinking
	 * the resolution does not reduce the frame count.
	 */
	maxFrames: 300,
} as const;

/**
 * File-picker hint, not a validation boundary. The accept attribute only sets the dialog's default
 * filter (users can choose "All files"), and the browser's Content-Type is guessed from the file
 * extension. The server decodes the bytes to decide (apps/api/src/lib/cover-image.ts). The list is
 * short on purpose. SVG is a script-capable document that needs a sanitization pipeline this
 * repository does not have. AVIF, HEIC, BMP, and TIFF are not needed for a cover. GIF stays because
 * a multi-frame cover cannot be reduced to one frame without losing its meaning. WebP is the single
 * storage format that keeps the motion.
 */
export const STORY_COVER_INPUT_MIME = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
] as const;

/**
 * The formats that may animate. The list is used in two places: the screen right after a file is
 * chosen (guidance), and the server after reading the bytes (enforcement). Adding a format then
 * changes one list instead of two `mime === "image/gif"` checks. Being listed does not guarantee
 * animation. A single-frame GIF is handled as a still image, and the server decides by decoding.
 */
export const STORY_COVER_ANIMATED_MIME = ["image/gif"] as const;

export const isAnimatedCoverMime = (mime: string): boolean =>
	(STORY_COVER_ANIMATED_MIME as readonly string[]).includes(mime);

/**
 * Returns the body byte limit for a MIME type. The fact that limits differ by format is known only
 * here.
 */
export const coverByteLimitFor = (mime: string): number =>
	isAnimatedCoverMime(mime)
		? STORY_COVER_LIMITS.maxAnimatedBytes
		: STORY_COVER_LIMITS.maxBytes;

export const STORY_COVER_ACCEPT = STORY_COVER_INPUT_MIME.join(",");

/**
 * Replace and delete return the story after the change. The screen does not build an address from a
 * version value. Address rules belong to the server, and a browser copy would go stale when they
 * change, so the screen only sets story.coverUrl on an image. A deleted cover is expressed by
 * coverUrl becoming null, not by a separate removed flag that would duplicate the fact.
 */
export const StoryCoverResponse = z.object({ story: StoryDto });
export type StoryCoverResponse = z.infer<typeof StoryCoverResponse>;

/**
 * Each rejection has its own code because the user's next action differs: a too-large file means
 * choosing a smaller one, an unsupported format means naming the accepted ones, and oversized
 * dimensions mean resizing. Ownership and existence failures are not here. A foreign or missing
 * story returns the same not_found 404 as the detail endpoint, so this path cannot be used to
 * detect existence.
 */
export const STORY_COVER_ERROR_CODE = {
	/**
	 * The body exceeds the limit for its format (see coverByteLimitFor). Requests over 20 MiB are
	 * rejected before the body is read, and still images over 5 MiB after the signature check. Both
	 * use this code because the user's action is the same: pick a smaller file.
	 */
	tooLarge: "story_cover_too_large",
	/** The body is empty: no file was chosen, or the file is 0 bytes. */
	empty: "story_cover_empty",
	/** The format is not accepted, such as SVG, AVIF, HEIC, BMP, or TIFF. */
	unsupportedType: "story_cover_unsupported_type",
	/**
	 * The format is correct but the file does not decode. It is truncated, corrupt, or has only a
	 * plausible header.
	 */
	invalidImage: "story_cover_invalid_image",
	/** The decoded image exceeds maxPixels or maxDimension. */
	dimensionsTooLarge: "story_cover_dimensions_too_large",
	/**
	 * Too many frames, or total pixels across all frames over budget. Animated covers only. It is not
	 * folded into dimensionsTooLarge because the fix differs. Resolution is reduced by shrinking, but
	 * this needs a shorter animation or fewer frames. Someone who only lowers the resolution would be
	 * rejected again.
	 */
	tooManyFrames: "story_cover_too_many_frames",
} as const;
export type StoryCoverErrorCode =
	(typeof STORY_COVER_ERROR_CODE)[keyof typeof STORY_COVER_ERROR_CODE];
