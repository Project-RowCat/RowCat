import {
	CAPABILITY_ERROR_CODE,
	coverByteLimitFor,
	STORY_COVER_ERROR_CODE,
	STORY_COVER_INPUT_MIME,
	STORY_COVER_LIMITS,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "#/lib/i18n/current.ts";

/**
 * - Pure functions for the pre-check and the failure messages of the cover file.
 * - Not a validation boundary. The server is the final authority: it ignores Content-Type and
 *   decodes the bytes (apps/api/src/lib/cover-image.ts). The `accept` attribute only sets the
 *   picker's default filter. Users can choose any file, and browser MIME types are usually guessed
 *   from the extension. Strengthening this check gains nothing, and loosening the server because of
 *   it would be a vulnerability.
 * - Limits and MIME lists come from @rowcat/contracts and are not restated here. A hand-copied
 *   value would let the screen promise one limit while the server enforces another.
 * - The messages live outside the screen because the next step depends on them: a smaller file, a
 *   format conversion, or the account screen. One generic message would make users re-upload the
 *   same file. Tests check these branches without rendering.
 */

const ACCEPTED_MIME: ReadonlySet<string> = new Set(STORY_COVER_INPUT_MIME);

/** Megabytes for the messages. Raw byte counts give users no sense of the file size. */
const MAX_MEGABYTES = Math.floor(STORY_COVER_LIMITS.maxBytes / (1024 * 1024));
/**
 * Animated cover limit. It is more generous than the still-image limit (see the STORY_COVER_LIMITS
 * header).
 */
const MAX_ANIMATED_MEGABYTES = Math.floor(
	STORY_COVER_LIMITS.maxAnimatedBytes / (1024 * 1024),
);

/**
 * Maps MIME types to human-readable format names. The table is hand-written, but the list itself
 * comes from the contract. A new format appears in messages automatically (uppercased) even without
 * a name here; add a line to this table to give it a proper name. Writing the entire table by hand
 * would leave messages on the old list silently once the contract adds a value.
 */
const MIME_LABEL: Partial<Record<string, string>> = {
	"image/jpeg": "JPEG",
	"image/png": "PNG",
	"image/webp": "WebP",
	"image/gif": "GIF",
};

const formatLabel = (mime: string): string =>
	MIME_LABEL[mime] ?? mime.replace("image/", "").toUpperCase();

/** `JPEG · PNG · WebP`. The hint and the failure messages must name the same list. */
export const COVER_FORMAT_LABEL =
	STORY_COVER_INPUT_MIME.map(formatLabel).join(" · ");

export const coverInputHint = (): string =>
	translator("create")("coverFile.inputHint", {
		formats: COVER_FORMAT_LABEL,
		max: MAX_MEGABYTES,
		maxAnimated: MAX_ANIMATED_MEGABYTES,
	});

/**
 * Reason the selected file fails the pre-check, or null. This uses deliberately different wording
 * from the server's error codes. The pre-check only knows facts available before sending
 * (`invalid_image` and `dimensions_too_large` need decoding, so they cannot come from here).
 * Reusing the server's names could later lead someone to imitate server responses with this check.
 */
export type CoverFileIssue = "unsupported_type" | "too_large" | "empty";

/**
 * Only the axes of the picker's value that this check reads. The function does not take the whole
 * File, so it need not know about the browser. It also ignores name and modified time, because
 * reading them would create a place where the value could flow elsewhere. The contract does not
 * accept the original file name either.
 */
export function checkCoverFile(file: {
	type: string;
	size: number;
}): CoverFileIssue | null {
	/** Zero bytes is checked first, so an empty file is never reported as a format or size problem. */
	if (file.size === 0) return "empty";

	/**
	 * Unknown types ("") are not blocked. A file without an extension gets an empty MIME string, and
	 * rejecting it would block a valid JPEG the server could accept. Unknown types are left to the
	 * byte-reading side, and its answer comes back in the same message.
	 */
	if (file.type !== "" && !ACCEPTED_MIME.has(file.type))
		return "unsupported_type";

	/**
	 * Limits differ by format. A single large limit would let PNGs over 5 MB through the screen and
	 * fail on the server. A single small limit would block GIFs the server accepts. The rule belongs
	 * to the contract (coverByteLimitFor).
	 */
	if (file.size > coverByteLimitFor(file.type)) return "too_large";
	return null;
}

export function coverIssueMessage(issue: CoverFileIssue): string {
	const t = translator("create");
	switch (issue) {
		case "empty":
			return t("coverFile.empty");
		case "too_large":
			return t("coverFile.tooLarge", {
				max: MAX_MEGABYTES,
				maxAnimated: MAX_ANIMATED_MEGABYTES,
			});
		case "unsupported_type":
			return t("coverFile.unsupported", { formats: COVER_FORMAT_LABEL });
	}
}

/**
 * The account cannot change its cover. Two 403s land here: the account itself is suspended or
 * blocked (`account_restricted`), or its publishing capability is limited (`capability_restricted`,
 * which only blocks uploads). The reason is deliberately not shown here. The authority for the
 * public reason is GET /v2/me/moderation. Repeating that sentence in every failure response would
 * let the same fact diverge in two places. This message only gives the way forward.
 */
const restrictedMessage = (): string =>
	translator("create")("coverFile.restricted");

/**
 * Upload and delete share one message. 'Could not save' would be false for a failed delete. Two
 * separate functions would each grow their own per-code branches, and new codes would get added to
 * one but not the other. To the user, both actions are simply changing the cover.
 */
const genericMessage = (): string => translator("create")("coverFile.generic");

/**
 * Converts a cover write failure into one human-readable line. Branching uses `code`, not the HTTP
 * status (repo convention). The server text is not shown because it is written for developers, and
 * the screen must say what to do now. 404 is not reinterpreted: another's work and a missing work
 * return the same 404 as the detail page, a deliberate fold on the server. Guessing the difference
 * here would turn the cover path into an existence probe.
 */
export function coverErrorMessage(error: unknown): string {
	const t = translator("create");
	const apiError = isRowCatApiError(error) ? error : null;
	if (!apiError) return genericMessage();

	switch (apiError.code) {
		case STORY_COVER_ERROR_CODE.tooLarge:
			return coverIssueMessage("too_large");
		case STORY_COVER_ERROR_CODE.empty:
			return coverIssueMessage("empty");
		case STORY_COVER_ERROR_CODE.unsupportedType:
			return coverIssueMessage("unsupported_type");
		case STORY_COVER_ERROR_CODE.invalidImage:
			return t("coverFile.invalidImage");
		case STORY_COVER_ERROR_CODE.tooManyFrames:
			/**
			 * Must differ from the resolution message. The user has to shorten the animation (fewer frames),
			 * not shrink dimensions or file size. Following a generic 'make it smaller' hint would just
			 * trigger the same rejection again.
			 */
			return t("coverFile.tooManyFrames", {
				max: STORY_COVER_LIMITS.maxFrames,
			});
		case STORY_COVER_ERROR_CODE.dimensionsTooLarge:
			/**
			 * Both axes arrive under this one code: a side that is too long (`maxDimension`), or too many
			 * total pixels (`maxPixels`). A message saying only 'reduce each side to N px' would leave
			 * someone with a 6000x5000 photo (both sides under the limit, 30 MP) fixing a condition they
			 * already meet. That guidance would dead-end.
			 */
			return t("coverFile.dimensionsTooLarge", {
				side: STORY_COVER_LIMITS.maxDimension,
				megapixels: Math.round(STORY_COVER_LIMITS.maxPixels / 1_000_000),
			});
		case CAPABILITY_ERROR_CODE.restricted:
		case "account_restricted":
			return restrictedMessage();
		case "login_required":
			return t("coverFile.loginRequired");
		default:
			/**
			 * A failure without a server envelope (for example a proxy's HTML error page) also lands here.
			 * Only the status code remains as a clue, so only 403 and 404 are checked. 403 is the
			 * restriction case. 404 means the work listed on this screen has already disappeared.
			 */
			if (apiError.status === 403) return restrictedMessage();
			if (apiError.status === 404) return t("coverFile.notFound");
			return genericMessage();
	}
}
