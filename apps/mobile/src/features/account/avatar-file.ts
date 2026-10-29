import {
	AVATAR_LIMITS,
	MEDIA_ERROR_CODE,
	MEDIA_INPUT_MIME,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import type { PickedImage } from "../../lib/image-picker.ts";

/**
 * Pre-flight hints and failure copy for the profile photo; pure functions only.
 *
 * - Not a validation boundary: every decision here only saves a round trip. The server is the
 *   authority and ignores `Content-Type`, decoding the bytes itself
 *   (`apps/api/src/lib/media/image.ts`); the MIME and size the picker attaches are platform
 *   guesses. Tightening this gains nothing, and loosening server checks because this one blocks
 *   would become a vulnerability.
 * - Not merged with web `avatar-file.ts`: a browser `File` always knows its size but not pixels,
 *   while a native picker usually knows pixels and may not know size. Client hint copy is merely
 *   awkward when wrong, so each side is better off being accurate (unlike the server's shared
 *   policy, where wrong is a vulnerability).
 * - Numbers and MIME lists derive from `@rowcat/contracts`; copy saying "up to 5MB" while the
 *   server rejects at 2MB would fail users who followed our guidance.
 */

const ACCEPTED_MIME: ReadonlySet<string> = new Set(MEDIA_INPUT_MIME);

/** MB for hint copy; raw bytes would tell nobody anything. */
const MAX_MEGABYTES = Math.floor(AVATAR_LIMITS.maxBytes / (1024 * 1024));

/** MIME -> human-readable format name; the list itself comes from the contract. */
const MIME_LABEL: Partial<Record<string, string>> = {
	"image/jpeg": "JPEG",
	"image/png": "PNG",
	"image/webp": "WebP",
};

const formatLabel = (mime: string): string =>
	MIME_LABEL[mime] ?? mime.replace("image/", "").toUpperCase();

/** `JPEG · PNG · WebP`. The hint and the failure copy must name the same list. */
export const AVATAR_FORMAT_LABEL =
	MEDIA_INPUT_MIME.map(formatLabel).join(" · ");

/**
 * One line read before picking.
 *
 * States the square crop and the minimum size up front: cropping is irreversible, and learning the
 * minimum only after a server rejection is especially frustrating. The limit is a fork rather than
 * a wall; someone over it used to have to shrink the photo outside this app, but can now crop in
 * place. A bare number would make people with large photos give up before picking.
 */
export const AVATAR_INPUT_HINT = `${AVATAR_FORMAT_LABEL} · at least ${AVATAR_LIMITS.minDimension}px · cropped to a square (crop it yourself if over ${MAX_MEGABYTES}MB)`;

/**
 * Why the picked image trips the hint, or `null`.
 *
 * Deliberately a different vocabulary from the server's error codes: these are facts known before
 * sending, and sharing names would eventually let someone mimic server responses with this check.
 * `too_small` is the axis web lacks: a browser does not know the picked file's pixels, while a
 * native picker usually does.
 */
export type AvatarPreflightIssue =
	| "empty"
	| "unsupported_type"
	| "too_large"
	| "too_small";

/**
 * Only `too_large` is a fork rather than copy: the crop screen takes its place.
 *
 * The decision stays one function because of order: `checkPickedAvatar` checks format before size,
 * so a 5MB GIF trips `unsupported_type` and the crop screen never opens for a format the server
 * would not accept. That order is the fork's safeguard, so callers call this instead of re-writing
 * the condition. Same name and rule as web.
 */
export function avatarIssueOpensCrop(issue: AvatarPreflightIssue): boolean {
	return issue === "too_large";
}

/**
 * Takes only the axes of the picker's result that this check reads.
 *
 * Unknown (`null`) values do not block: some picker paths really give no size or format, and
 * rejecting them would block images the server would accept. Unknowns are left to the server, which
 * reads the bytes and answers with the same copy; sizes are never invented.
 */
export function checkPickedAvatar(
	picked: Pick<PickedImage, "mimeType" | "byteSize" | "width" | "height">,
): AvatarPreflightIssue | null {
	/* Zero bytes first: that file has no format or size to judge. */
	if (picked.byteSize === 0) return "empty";

	if (picked.mimeType !== null && !ACCEPTED_MIME.has(picked.mimeType))
		return "unsupported_type";

	if (picked.byteSize !== null && picked.byteSize > AVATAR_LIMITS.maxBytes)
		return "too_large";

	/**
	 * The server always rejects a short side below the minimum: nothing is left to crop into a square
	 * (`AVATAR_LIMITS.minDimension` comment). Judged only when both axes are known.
	 */
	if (
		picked.width !== null &&
		picked.height !== null &&
		Math.min(picked.width, picked.height) < AVATAR_LIMITS.minDimension
	)
		return "too_small";

	return null;
}

/** Hint-tripping image -> one human-readable line. */
export function avatarIssueMessage(issue: AvatarPreflightIssue): string {
	switch (issue) {
		case "empty":
			return "The file is empty. Please choose another image.";
		case "too_large":
			return `Profile photos can be up to ${MAX_MEGABYTES}MB. Please choose a smaller file.`;
		case "unsupported_type":
			return `Only ${AVATAR_FORMAT_LABEL} files can be uploaded.`;
		case "too_small":
			return `Please choose a photo at least ${AVATAR_LIMITS.minDimension}px wide and tall.`;
	}
}

/** The picked image's bytes could not be read (file gone or access lost). */
export const AVATAR_READ_FAILED =
	"Couldn't read the image. Please choose another image.";

/**
 * Words of the crop screen. They live outside the component so they can be locked: little of that
 * dialog is checkable without rendering (fingers and the native manipulator are most of it), so at
 * least the copy and the lower bound sit in a pure place and the screen only draws them.
 */
export const AVATAR_CROP_TITLE = "Crop photo";
export const AVATAR_CROP_HINT =
	"The part inside the circle becomes your profile photo. Drag to move it and pinch with two fingers to zoom.";
export const AVATAR_CROP_ZOOM_IN = "Zoom";
export const AVATAR_CROP_ZOOM_OUT = "Zoom out";
export const AVATAR_CROP_SUBMIT = "Use this area";
export const AVATAR_CROP_SUBMITTING = "Creating…";

/**
 * The file could not be read as an image, or the cropped result could not be produced. Folded into
 * one sentence because the user's next step is the same either way: this photo cannot proceed, and
 * we cannot tell the cause (codec, corruption, memory) apart either.
 */
export const AVATAR_CROP_FAILED =
	"Couldn't crop the image. Please choose another photo.";

/**
 * An image with nothing left to crop. An over-limit file that is also shorter than the minimum is
 * rare but real (a very long strip); opening the crop screen then asks for something unfixable, so
 * the fact the server would reject is stated here first.
 */
export const AVATAR_CROP_TOO_SMALL = `Only photos at least ${AVATAR_LIMITS.minDimension}px wide and tall can be cropped.`;

/**
 * When this account cannot change the photo. The reason is not drawn here: the public reason's
 * authority is `GET /v2/me/moderation`, which the `Restrictions` section of the account screen draws;
 * carrying that sentence in every failure response would let the same fact diverge in two places.
 */
const RESTRICTED_MESSAGE =
	"A restricted account can't change its profile photo.";

/** Upload and delete share one sentence: to the user both are "changing the photo". */
const GENERIC_MESSAGE =
	"Couldn't change the profile photo. Please try again in a moment.";

/**
 * Avatar write failure -> one human-readable line, branching on `code` rather than status.
 *
 * The server can still reject a file the picker passed: format and pixels are only known after
 * decoding the bytes, so this does not pretend that "the picker checked it, so it succeeds".
 */
export function avatarErrorMessage(error: unknown): string {
	const apiError = isRowCatApiError(error) ? error : null;
	if (!apiError) return GENERIC_MESSAGE;

	switch (apiError.code) {
		case MEDIA_ERROR_CODE.tooLarge:
			return avatarIssueMessage("too_large");
		case MEDIA_ERROR_CODE.empty:
			return avatarIssueMessage("empty");
		case MEDIA_ERROR_CODE.unsupportedType:
			return avatarIssueMessage("unsupported_type");
		case MEDIA_ERROR_CODE.invalidImage:
			return "Couldn't read the image. The file may be damaged.";
		case MEDIA_ERROR_CODE.invalidDimensions:
			/**
			 * Three axes arrive under this one code: a side too long, too many total pixels, or too small.
			 * Saying only "shrink it" makes someone who uploaded a small photo shrink it further and fail
			 * forever (same sentence as web).
			 */
			return `The image size doesn't fit. Please choose a photo at least ${AVATAR_LIMITS.minDimension}px wide and tall, with no side over ${AVATAR_LIMITS.maxDimension}px.`;
		case MEDIA_ERROR_CODE.storageFailed:
			/** The only failure where retrying may actually help; do not tell them to change the file. */
			return "Couldn't save the image. Please try again in a moment.";
		case "capability_restricted":
		case "account_restricted":
			return RESTRICTED_MESSAGE;
		case "login_required":
			return "You've been signed out. Please sign in again.";
		default:
			/** A failure with no envelope (proxy error etc.); only the status remains, so check these two. */
			if (apiError.status === 413) return avatarIssueMessage("too_large");
			if (apiError.status === 403) return RESTRICTED_MESSAGE;
			return GENERIC_MESSAGE;
	}
}
