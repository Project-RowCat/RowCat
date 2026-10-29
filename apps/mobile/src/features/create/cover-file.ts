import {
	CAPABILITY_ERROR_CODE,
	coverByteLimitFor,
	STORY_COVER_ERROR_CODE,
	STORY_COVER_INPUT_MIME,
	STORY_COVER_LIMITS,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import type { PickedImage } from "../../lib/image-picker.ts";

/**
 * Pre-flight hints and failure copy for cover files; pure functions (pair of the web
 * `cover-file.ts`).
 *
 * - Not a validation boundary: every check only saves a round trip. The server decides from magic
 *   bytes and the decoder (`apps/api/src/lib/cover-image.ts`) and never reads the claimed format,
 *   so do not loosen server validation because the client blocks something.
 * - Unknown axes pass: some pickers give no `mimeType`, `fileSize` or dimensions, and blocking on
 *   missing metadata would reject good images (same rule as `lib/image-picker.ts` and the scene
 *   image check).
 * - Limits and MIME list are derived from `@rowcat/contracts`, never retyped; a screen that says
 *   "up to 5MB" while the server rejects at 4MB fails users who followed our hint.
 */

const ACCEPTED_MIME: ReadonlySet<string> = new Set(STORY_COVER_INPUT_MIME);

const MAX_MEGABYTES = Math.floor(STORY_COVER_LIMITS.maxBytes / (1024 * 1024));
const MAX_ANIMATED_MEGABYTES = Math.floor(
	STORY_COVER_LIMITS.maxAnimatedBytes / (1024 * 1024),
);

const MIME_LABEL: Partial<Record<string, string>> = {
	"image/jpeg": "JPEG",
	"image/png": "PNG",
	"image/webp": "WebP",
	"image/gif": "GIF",
};

const formatLabel = (mime: string): string =>
	MIME_LABEL[mime] ?? mime.replace("image/", "").toUpperCase();

/** Hint and failure copy must name the same format list. */
export const COVER_FORMAT_LABEL =
	STORY_COVER_INPUT_MIME.map(formatLabel).join(" · ");

/** One line shown before picking: accepted formats and limits. */
export const COVER_INPUT_HINT = `${COVER_FORMAT_LABEL} · up to ${MAX_MEGABYTES}MB (GIF ${MAX_ANIMATED_MEGABYTES}MB)`;

/**
 * Why a picked image trips the hint, or `null`. The vocabulary deliberately differs from the
 * server's error codes: only facts knowable before sending live here (`invalid_image` and
 * `dimensions_too_large` need a decode), and sharing names would invite imitating server responses.
 */
export type CoverFileIssue =
	| "unsupported_type"
	| "too_large"
	| "too_many_pixels"
	| "empty";

export function checkPickedCover(picked: PickedImage): CoverFileIssue | null {
	// Empty first: nothing else is worth checking on a zero-byte file.
	if (picked.byteSize === 0) return "empty";

	if (picked.mimeType !== null && !ACCEPTED_MIME.has(picked.mimeType))
		return "unsupported_type";

	/**
	 * The byte limit differs per format: one large value lets a >5MB PNG pass and fail on the server,
	 * one small value blocks a GIF the server would accept. The contract owns the decision
	 * (`coverByteLimitFor`); unknown format falls to its default.
	 */
	if (
		picked.byteSize !== null &&
		picked.byteSize > coverByteLimitFor(picked.mimeType ?? "")
	)
		return "too_large";

	/**
	 * Pixels are not visible in file size: a few hundred KB can unfold to tens of megapixels, and the
	 * server decoder would take that bomb. Frame count is unknown to the picker, so the server answers
	 * it.
	 */
	if (picked.width !== null && picked.height !== null) {
		if (
			picked.width > STORY_COVER_LIMITS.maxDimension ||
			picked.height > STORY_COVER_LIMITS.maxDimension
		)
			return "too_many_pixels";
		if (picked.width * picked.height > STORY_COVER_LIMITS.maxPixels)
			return "too_many_pixels";
	}
	return null;
}

export function coverIssueMessage(issue: CoverFileIssue): string {
	switch (issue) {
		case "empty":
			return "The file is empty. Please choose another image.";
		case "too_large":
			return `Covers can be up to ${MAX_MEGABYTES}MB (GIF ${MAX_ANIMATED_MEGABYTES}MB). Please choose a smaller file.`;
		case "too_many_pixels":
			return `The resolution is too large. Keep it within ${STORY_COVER_LIMITS.maxDimension}px per side and ${Math.round(STORY_COVER_LIMITS.maxPixels / 1_000_000)} megapixels in total.`;
		case "unsupported_type":
			return `Only ${COVER_FORMAT_LABEL} files can be uploaded.`;
	}
}

/**
 * Account cannot change the cover. Two 403s land here (account suspended/blocked, or publish
 * capability restricted, which only gates uploads). The public reason is deliberately not drawn:
 * `GET /v2/me/moderation` owns it, and carrying that sentence on every failure would let the same
 * fact diverge in two places.
 */
const RESTRICTED_MESSAGE =
	"A restricted account can't change covers. Check the restriction on your account screen.";

/** Upload and delete share one sentence; to the user both are "changing the cover". */
const GENERIC_MESSAGE =
	"Couldn't change the cover. Please try again in a moment.";

/**
 * Cover write failure to a human-readable line. The 404 is not re-examined: a missing story and
 * someone else's share one 404 on purpose, and splitting them here would turn the cover path into
 * an existence probe.
 */
export function coverErrorMessage(error: unknown): string {
	const apiError = isRowCatApiError(error) ? error : null;
	if (!apiError) return GENERIC_MESSAGE;

	switch (apiError.code) {
		case STORY_COVER_ERROR_CODE.tooLarge:
			return coverIssueMessage("too_large");
		case STORY_COVER_ERROR_CODE.empty:
			return coverIssueMessage("empty");
		case STORY_COVER_ERROR_CODE.unsupportedType:
			return coverIssueMessage("unsupported_type");
		case STORY_COVER_ERROR_CODE.invalidImage:
			return "Couldn't read the image. The file may be damaged.";
		case STORY_COVER_ERROR_CODE.tooManyFrames:
			/**
			 * Must read differently from the resolution message: the fix here is length, and following
			 * "reduce the size" by lowering resolution only gets the same rejection again.
			 */
			return `Animated covers can have up to ${STORY_COVER_LIMITS.maxFrames} frames. Please choose a shorter image.`;
		case STORY_COVER_ERROR_CODE.dimensionsTooLarge:
			return coverIssueMessage("too_many_pixels");
		case CAPABILITY_ERROR_CODE.restricted:
		case "account_restricted":
			return RESTRICTED_MESSAGE;
		case "login_required":
			return "You need to sign in.";
		default:
			if (apiError.status === 403) return RESTRICTED_MESSAGE;
			if (apiError.status === 404) return "The story couldn't be found.";
			return GENERIC_MESSAGE;
	}
}
