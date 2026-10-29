import {
	MEDIA_ERROR_CODE,
	MEDIA_INPUT_MIME,
	SCENE_IMAGE_LIMITS,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import type { PickedImage } from "../../lib/image-picker.ts";

/**
 * Pre-checks and failure copy for scene images. The server is the final authority; this is early
 * guidance.
 *
 * Limits, formats and error vocabulary are read from the contract (`SCENE_IMAGE_LIMITS`,
 * `MEDIA_INPUT_MIME`, `MEDIA_ERROR_CODE`). Hard-coded numbers here would let the screen advise one
 * value while the server rejects another.
 *
 * An unknown axis does not block: some pickers give no `mimeType` or `fileSize`, and then the check
 * passes (mirroring `lib/image-picker.ts`, which never invents values). The server decodes the
 * bytes and decides; blocking here would reject a valid image for lacking metadata. The only reason
 * to block early is to tell the user at pick time rather than after uploading a large file.
 */

const ACCEPTED_MIME: ReadonlySet<string> = new Set(MEDIA_INPUT_MIME);

const MAX_MEGABYTES = Math.floor(SCENE_IMAGE_LIMITS.maxBytes / (1024 * 1024));

const MIME_LABEL: Partial<Record<string, string>> = {
	"image/jpeg": "JPEG",
	"image/png": "PNG",
	"image/webp": "WebP",
};

const formatLabel = (mime: string): string =>
	MIME_LABEL[mime] ?? mime.replace("image/", "").toUpperCase();

export const SCENE_IMAGE_FORMAT_LABEL =
	MEDIA_INPUT_MIME.map(formatLabel).join(" · ");

export const SCENE_IMAGE_INPUT_HINT = `${SCENE_IMAGE_FORMAT_LABEL} · up to ${MAX_MEGABYTES}MB`;

export type SceneImageIssue =
	| "unsupported_type"
	| "too_large"
	| "too_many_pixels"
	| "empty";

export function checkPickedSceneImage(
	picked: PickedImage,
): SceneImageIssue | null {
	if (picked.byteSize === 0) return "empty";
	if (picked.mimeType !== null && !ACCEPTED_MIME.has(picked.mimeType))
		return "unsupported_type";
	if (picked.byteSize !== null && picked.byteSize > SCENE_IMAGE_LIMITS.maxBytes)
		return "too_large";
	// Pixel count is not implied by file size: a few hundred KB can unfold to hundreds of millions of
	// pixels, which the server's decoder would receive.
	if (picked.width !== null && picked.height !== null) {
		if (
			picked.width > SCENE_IMAGE_LIMITS.maxDimension ||
			picked.height > SCENE_IMAGE_LIMITS.maxDimension
		)
			return "too_many_pixels";
		if (picked.width * picked.height > SCENE_IMAGE_LIMITS.maxPixels)
			return "too_many_pixels";
	}
	return null;
}

export function sceneImageIssueMessage(issue: SceneImageIssue): string {
	switch (issue) {
		case "empty":
			return "The file is empty. Please choose another image.";
		case "too_large":
			return `Scene images can be up to ${MAX_MEGABYTES}MB. Please choose a smaller file.`;
		case "too_many_pixels":
			return "The image is too large. Please reduce its resolution.";
		case "unsupported_type":
			return `Only ${SCENE_IMAGE_FORMAT_LABEL} files can be uploaded.`;
	}
}

/**
 * Upload failure copy, one sentence per code. A single "could not upload" would not say what to
 * fix, and the user would retry the same file with the same result.
 */
export function sceneImageErrorMessage(error: unknown): string {
	if (!isRowCatApiError(error))
		return "Couldn't upload the scene image. Please try again in a moment.";
	switch (error.code) {
		case MEDIA_ERROR_CODE.tooLarge:
			return sceneImageIssueMessage("too_large");
		case MEDIA_ERROR_CODE.empty:
			return sceneImageIssueMessage("empty");
		case MEDIA_ERROR_CODE.unsupportedType:
			return sceneImageIssueMessage("unsupported_type");
		case MEDIA_ERROR_CODE.invalidImage:
			return "Couldn't read the image. The file may be damaged.";
		case MEDIA_ERROR_CODE.invalidDimensions:
			return sceneImageIssueMessage("too_many_pixels");
		case MEDIA_ERROR_CODE.storageFailed:
			return "Couldn't save the image. Please try again in a moment.";
		default:
			return "Couldn't upload the scene image. Please try again in a moment.";
	}
}

/**
 * The upload reached the server but the reference could not be written on this device. Not rolled
 * back: no media-delete API exists on this path (another draft might point at the image anyway),
 * and orphans belong to the server's cleanup policy. The true message is "pick again", not "the
 * image is gone".
 */
export const SCENE_IMAGE_LOCAL_WRITE_FAILED =
	"The picture was uploaded but couldn't be saved on this device. Please try again.";
