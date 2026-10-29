import {
	MEDIA_ERROR_CODE,
	MEDIA_INPUT_MIME,
	SCENE_IMAGE_LIMITS,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "#/lib/i18n/current.ts";

/**
 * The server is the final authority on scene image files. This module only gives advance guidance.
 *
 * The shape mirrors `cover-file.ts`, but the two stay separate because their size limits, formats,
 * and error vocabularies differ. Merging them would make one file advise with the other's numbers,
 * and users would follow the advice and still be rejected.
 *
 * The pre-check is not validation. The file dialog's `accept` attribute and this function see only
 * what the browser reports, while the server decodes the bytes. The only purpose is to tell the
 * user at selection time, rather than after uploading a file that gets rejected.
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

export const sceneImageInputHint = (): string =>
	translator("create")("sceneImage.inputHint", {
		formats: SCENE_IMAGE_FORMAT_LABEL,
		max: MAX_MEGABYTES,
	});

export type SceneImageFileIssue = "unsupported_type" | "too_large" | "empty";

/**
 * Files with an empty type pass the check. Browsers leave the type empty when the extension is
 * unknown. Rejecting here would refuse valid images by name, and the server judges the actual
 * bytes.
 */
export function checkSceneImageFile(file: {
	type: string;
	size: number;
}): SceneImageFileIssue | null {
	if (file.size === 0) return "empty";
	if (file.type !== "" && !ACCEPTED_MIME.has(file.type))
		return "unsupported_type";
	if (file.size > SCENE_IMAGE_LIMITS.maxBytes) return "too_large";
	return null;
}

export function sceneImageIssueMessage(issue: SceneImageFileIssue): string {
	const t = translator("create");
	switch (issue) {
		case "empty":
			return t("sceneImage.empty");
		case "too_large":
			return t("sceneImage.tooLarge", { max: MAX_MEGABYTES });
		case "unsupported_type":
			return t("sceneImage.unsupported", { formats: SCENE_IMAGE_FORMAT_LABEL });
	}
}

/**
 * Failures are not collapsed into one generic message, because different codes call for different
 * fixes. A single 'could not upload' sentence does not say what to change, so the user retries the
 * same file and gets the same result.
 */
export function sceneImageErrorMessage(error: unknown): string {
	const t = translator("create");
	if (!isRowCatApiError(error)) return t("sceneImage.generic");
	switch (error.code) {
		case MEDIA_ERROR_CODE.tooLarge:
			return sceneImageIssueMessage("too_large");
		case MEDIA_ERROR_CODE.empty:
			return sceneImageIssueMessage("empty");
		case MEDIA_ERROR_CODE.unsupportedType:
			return sceneImageIssueMessage("unsupported_type");
		case MEDIA_ERROR_CODE.invalidImage:
			return t("sceneImage.invalidImage");
		case MEDIA_ERROR_CODE.invalidDimensions:
			return t("sceneImage.invalidDimensions");
		case MEDIA_ERROR_CODE.storageFailed:
			return t("sceneImage.storageFailed");
		default:
			return t("sceneImage.generic");
	}
}
