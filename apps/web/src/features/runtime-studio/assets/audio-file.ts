import {
	MEDIA_ERROR_CODE,
	RUNTIME_AUDIO_INPUT_MIME,
	RUNTIME_AUDIO_LIMITS,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Pre-check and failure wording for runtime sound files, the counterpart of the image side
 * (`runtime-asset-file.ts`).
 * - Kept separate from the image file for the same reason as in its header: limits, names and
 *   error vocabulary differ. Here the split is sharper. Sound has an axis images lack (length), and
 *   images have one sound lacks (resolution). A single function would make the guidance wrong for
 *   one side.
 * - This is not validation. The file dialog's `accept` and this function only see what the
 *   browser reports. The server parses the container and decides (`lib/media/audio.ts`).
 *   Pre-checking exists so a user learns of a rejection at selection instead of after uploading 10
 *   MB.
 * - Length is not measured in the browser. Metadata from `<audio>` could reject over-limit files
 *   earlier, but decoders disagree: a file the browser reports as 445 s may be 448 s on the server.
 *   That gap is worst near the limit (the screen passes it, the server rejects it), so length is
 *   judged on the server axis only.
 */

const ACCEPTED_MIME: ReadonlySet<string> = new Set(RUNTIME_AUDIO_INPUT_MIME);

const MAX_MEGABYTES = Math.floor(RUNTIME_AUDIO_LIMITS.maxBytes / (1024 * 1024));
const MAX_MINUTES = Math.floor(RUNTIME_AUDIO_LIMITS.maxDurationMs / 60_000);

export const RUNTIME_AUDIO_FORMAT_LABEL = "MP3 · M4A";

/**
 * The stored sound's format name, using the two words the server writes
 * (`RUNTIME_AUDIO_OUTPUT_MIME`). The image format label (`runtimeImageFormatLabel`) would produce
 * `AUDIO/MPEG` for sound, which is not the name of the file the creator uploaded. Unknown values
 * show their subtype as is. An original string is better than an invented name.
 */
const AUDIO_MIME_LABEL: Readonly<Record<string, string>> = {
	"audio/mpeg": "MP3",
	"audio/mp4": "M4A",
};

export const runtimeAudioFormatLabel = (mime: string): string =>
	AUDIO_MIME_LABEL[mime] ?? mime.replace("audio/", "").toUpperCase();

export const runtimeAudioInputHint = (): string =>
	translator("runtimeStudio")("audioFile.inputHint", {
		formats: RUNTIME_AUDIO_FORMAT_LABEL,
		max: MAX_MEGABYTES,
		minutes: MAX_MINUTES,
	});

/**
 * Formats a duration as `01:42`. The list and the hover use the same format. Hours would produce
 * `1:02:03`. The limit is 10 minutes, so that branch is not reached yet. When the limit grows,
 * changing this one function is a single edit, instead of a hunt through three places in the list.
 */
export function formatRuntimeAudioDuration(durationMs: number): string {
	const total = Math.max(0, Math.round(durationMs / 1000));
	const seconds = total % 60;
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	const pad = (value: number) => String(value).padStart(2, "0");
	return hours > 0
		? `${hours}:${pad(minutes)}:${pad(seconds)}`
		: `${minutes}:${pad(seconds)}`;
}

export type RuntimeAudioFileIssue = "unsupported_type" | "too_large" | "empty";

/**
 * Whether the file looks like sound. The extension is checked as well as the MIME type. This is the
 * only place this differs from the image side. MIME types for `.m4a` vary (`audio/x-m4a`,
 * `audio/mp4`, or an empty string), and in some cases it is empty altogether. Checking MIME alone
 * would reject valid files.
 */
export function looksLikeRuntimeAudio(file: {
	name: string;
	type: string;
}): boolean {
	if (ACCEPTED_MIME.has(file.type)) return true;
	if (file.type.startsWith("audio/")) return true;
	return /\.(mp3|m4a)$/i.test(file.name);
}

/**
 * Whether the chosen file can be uploaded, and if not, why. Files with an empty type are judged by
 * extension. The image side lets them through; here the verdict decides between the image and sound
 * pipelines. Letting an empty-type MP3 through would send it to the image upload.
 */
export function checkRuntimeAudioFile(file: {
	name: string;
	type: string;
	size: number;
}): RuntimeAudioFileIssue | null {
	if (file.size === 0) return "empty";
	if (!looksLikeRuntimeAudio(file)) return "unsupported_type";
	if (file.size > RUNTIME_AUDIO_LIMITS.maxBytes) return "too_large";
	return null;
}

export function runtimeAudioIssueMessage(issue: RuntimeAudioFileIssue): string {
	const t = translator("runtimeStudio");
	switch (issue) {
		case "empty":
			return t("audioFile.empty");
		case "too_large":
			return t("audioFile.tooLarge", { max: MAX_MEGABYTES });
		case "unsupported_type":
			return t("audioFile.unsupported", {
				formats: RUNTIME_AUDIO_FORMAT_LABEL,
			});
	}
}

/**
 * Upload failure wording: different codes call for different actions. The line that separates
 * over-length from over-size matters most in this table. Merged, a user who compressed harder would
 * get the same rejection again, though what must shrink is length, not size.
 */
export function runtimeAudioErrorMessage(error: unknown): string {
	if (!isRowCatApiError(error))
		return translator("runtimeStudio")("audioFile.generic");
	const t = translator("runtimeStudio");
	switch (error.code) {
		case MEDIA_ERROR_CODE.tooLarge:
			return runtimeAudioIssueMessage("too_large");
		case MEDIA_ERROR_CODE.empty:
			return runtimeAudioIssueMessage("empty");
		case MEDIA_ERROR_CODE.unsupportedType:
			return runtimeAudioIssueMessage("unsupported_type");
		case MEDIA_ERROR_CODE.invalidAudio:
			return t("audioFile.invalidAudio");
		case MEDIA_ERROR_CODE.audioTooLong:
			return t("audioFile.tooLong", { minutes: MAX_MINUTES });
		case MEDIA_ERROR_CODE.storageFailed:
			return t("audioFile.storageFailed");
		default:
			return t("audioFile.generic");
	}
}
