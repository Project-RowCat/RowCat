import {
	MEDIA_ERROR_CODE,
	MEDIA_INPUT_MIME,
	RUNTIME_IMAGE_LIMITS,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Pre-checks and failure messages for runtime image files. The server is the final authority; this
 * module gives advance guidance.
 *
 * Cover and scene-image files have the same shape (`cover-file.ts`, `scene-image-file.ts`). Three
 * copies look like duplication, but they stay separate for the reason those headers record: the
 * limits, names, and error vocabulary all differ. Merging them would make one file quote another's
 * numbers, and users would follow our guidance and still be rejected.
 *
 * The pre-check is not validation. The file dialog's `accept` attribute and this function both see
 * only what the browser reports; the server decodes the bytes and decides. The point of checking
 * early is that it is better to know when a file is picked than to upload 3MB and be rejected.
 */

const ACCEPTED_MIME: ReadonlySet<string> = new Set(MEDIA_INPUT_MIME);

const MAX_MEGABYTES = Math.floor(RUNTIME_IMAGE_LIMITS.maxBytes / (1024 * 1024));

const MIME_LABEL: Partial<Record<string, string>> = {
	"image/jpeg": "JPEG",
	"image/png": "PNG",
	"image/webp": "WebP",
};

/**
 * Human-readable name for one format. Input guidance and editor intelligence share this table.
 *
 * If the hover drew `image/webp` directly, the line would be a technical string that says nothing
 * to the creator. Writing a fresh label at that spot would make one format appear under two names
 * on two screens.
 */
export const runtimeImageFormatLabel = (mime: string): string =>
	MIME_LABEL[mime] ?? mime.replace("image/", "").toUpperCase();

export const RUNTIME_IMAGE_FORMAT_LABEL = MEDIA_INPUT_MIME.map(
	runtimeImageFormatLabel,
).join(" · ");

export const runtimeImageInputHint = (): string =>
	translator("runtimeStudio")("imageFile.inputHint", {
		formats: RUNTIME_IMAGE_FORMAT_LABEL,
		max: MAX_MEGABYTES,
	});

export type RuntimeImageFileIssue = "unsupported_type" | "too_large" | "empty";

/**
 * Whether the chosen file can be uploaded, and if not, why.
 *
 * A file with an empty type passes; browsers leave it empty when there is no extension. Rejecting
 * here would reject a valid image because of its name. The real decision is made by the server,
 * from the bytes.
 */
export function checkRuntimeImageFile(file: {
	type: string;
	size: number;
}): RuntimeImageFileIssue | null {
	if (file.size === 0) return "empty";
	if (file.type !== "" && !ACCEPTED_MIME.has(file.type))
		return "unsupported_type";
	if (file.size > RUNTIME_IMAGE_LIMITS.maxBytes) return "too_large";
	return null;
}

export function runtimeImageIssueMessage(issue: RuntimeImageFileIssue): string {
	const t = translator("runtimeStudio");
	switch (issue) {
		case "empty":
			return t("imageFile.empty");
		case "too_large":
			return t("imageFile.tooLarge", { max: MAX_MEGABYTES });
		case "unsupported_type":
			return t("imageFile.unsupported", {
				formats: RUNTIME_IMAGE_FORMAT_LABEL,
			});
	}
}

/**
 * Upload failure messages. Different codes call for different actions.
 *
 * They are not folded into one `Couldn't upload` sentence, because that sentence does not say what to
 * fix. The user would re-upload the same file and get the same result.
 */
export function runtimeImageErrorMessage(error: unknown): string {
	const t = translator("runtimeStudio");
	if (!isRowCatApiError(error)) return t("imageFile.generic");
	switch (error.code) {
		case MEDIA_ERROR_CODE.tooLarge:
			return runtimeImageIssueMessage("too_large");
		case MEDIA_ERROR_CODE.empty:
			return runtimeImageIssueMessage("empty");
		case MEDIA_ERROR_CODE.unsupportedType:
			return runtimeImageIssueMessage("unsupported_type");
		case MEDIA_ERROR_CODE.invalidImage:
			return t("imageFile.invalidImage");
		case MEDIA_ERROR_CODE.invalidDimensions:
			return t("imageFile.invalidDimensions");
		case MEDIA_ERROR_CODE.storageFailed:
			return t("imageFile.storageFailed");
		default:
			return t("imageFile.generic");
	}
}
