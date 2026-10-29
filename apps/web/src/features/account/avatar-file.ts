import {
	AVATAR_LIMITS,
	MEDIA_ERROR_CODE,
	MEDIA_INPUT_MIME,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Pre-upload hints and failure copy for profile photos. Pure functions only.
 *
 * This is not a validation boundary. Every check here saves a round trip; the server decides, and
 * it never reads `Content-Type`. It decodes the bytes itself (`apps/api/src/lib/media/image.ts`).
 * The `<input accept>` attribute is only the picker's default filter (users can still choose any
 * file), and the MIME the browser attaches is usually guessed from the extension.
 *
 * Hardening these checks gains nothing, and loosening the server because the client blocks
 * something would become a real hole. This is written down so nobody later mistakes `accept` or
 * this module for a security boundary.
 *
 * Limits and formats are not restated here: they all derive from `@rowcat/contracts`. If the screen
 * said "5MB" while the server rejected at 2MB, users would follow the hint and still fail.
 *
 * Deliberately not merged with `features/create/cover/file.ts`. The two look alike but have
 * different limits, error vocabulary and axes (avatars have a minimum size, covers do not). A
 * shared version taking a policy argument would push wording choices to callers, letting cover copy
 * leak into avatars. The server-side policy is shared because a mistake there is a vulnerability;
 * here a mistake only makes the wording awkward, so each copy stays exact for its own case.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Derived from the contract
 * ══════════════════════════════════════════════════════════════════════════ */

const ACCEPTED_MIME: ReadonlySet<string> = new Set(MEDIA_INPUT_MIME);

/** Megabytes for hint copy. Raw byte counts are unreadable to users. */
const MAX_MEGABYTES = Math.floor(AVATAR_LIMITS.maxBytes / (1024 * 1024));

/**
 * MIME → human-readable format name. The table is hand-written, but the list itself comes from the
 * contract: a new format appears in the hint automatically (uppercased) even without an entry here;
 * add a line to give it a proper name.
 */
const MIME_LABEL: Partial<Record<string, string>> = {
	"image/jpeg": "JPEG",
	"image/png": "PNG",
	"image/webp": "WebP",
};

const formatLabel = (mime: string): string =>
	MIME_LABEL[mime] ?? mime.replace("image/", "").toUpperCase();

/** e.g. `JPEG · PNG · WebP`. Hints and failure messages must name the same list. */
export const AVATAR_FORMAT_LABEL =
	MEDIA_INPUT_MIME.map(formatLabel).join(" · ");

/**
 * One line shown before the file is picked.
 *
 * The minimum size is stated here, which is where this differs from covers. Learning about that
 * axis only after the server rejects is especially frustrating, because the user never thought they
 * had to pick a large file.
 *
 * Saying up front that the image is cropped to a square matters too. Cropping is irreversible, and
 * finding out only after seeing the result (for a tall photo) is the wrong order.
 *
 * ## The limit is a fork, not a wall
 *
 * Previously `up to ${MAX}MB` was the end, and the only way out was outside the app (shrink elsewhere
 * and re-upload). Now the image is cropped in place. So this line states what happens when the
 * limit is exceeded, not just the number: with only the number, someone with a large photo gives up
 * before picking.
 */
export const avatarInputHint = (): string =>
	translator("account")("avatarFile.inputHint", {
		formats: AVATAR_FORMAT_LABEL,
		min: AVATAR_LIMITS.minDimension,
		max: MAX_MEGABYTES,
	});

/* ══════════════════════════════════════════════════════════════════════════
 * Checking the picked file
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Why the picked file is flagged by the hint. `null` when it is fine.
 *
 * The vocabulary deliberately differs from the server's error codes. These are facts known
 * **before** sending (`invalid_image` and `invalid_dimensions` need decoding, so they cannot come
 * from here), and reusing the names would eventually let someone imitate server responses with this
 * check.
 */
export type AvatarFileIssue = "unsupported_type" | "too_large" | "empty";

/**
 * Only `too_large` is a **fork, not just copy**: the crop screen takes over at that point.
 *
 * The check is not split into separate functions because of ordering. `checkAvatarFile` looks at
 * format **before** size, so a 5MB GIF is flagged `unsupported_type`, and the crop screen never
 * opens for a format the server would refuse anyway. That ordering is the safeguard for this fork,
 * so callers use this function instead of repeating the condition.
 */
export function avatarIssueOpensCrop(issue: AvatarFileIssue): boolean {
	return issue === "too_large";
}

/**
 * The fields of the file-picker result this check looks at.
 *
 * Takes no whole `File` so the function need not know about the browser. It ignores name and
 * modified time; if it looked at them, those values could flow somewhere (the same reason the
 * contract does not accept the original filename).
 */
export function checkAvatarFile(file: {
	type: string;
	size: number;
}): AvatarFileIssue | null {
	/** Zero bytes is checked first: such a file has nothing to judge for format or size. */
	if (file.size === 0) return "empty";

	/**
	 * **Unknown types (`""`) are not blocked.** Browsers set an empty string for files without an
	 * extension. Rejecting that would block a valid JPEG the server would accept. Leave unknowns to
	 * the byte reader; its answer comes back with the same wording.
	 */
	if (file.type !== "" && !ACCEPTED_MIME.has(file.type))
		return "unsupported_type";

	if (file.size > AVATAR_LIMITS.maxBytes) return "too_large";
	return null;
}

/** Flagged file → one human-readable line. */
export function avatarIssueMessage(issue: AvatarFileIssue): string {
	switch (issue) {
		case "empty":
			return translator("account")("avatarFile.theFileIsEmptyPlease");
		case "too_large":
			return translator("account")("avatarFile.tooLarge", {
				max: MAX_MEGABYTES,
			});
		case "unsupported_type":
			return translator("account")("avatarFile.unsupported", {
				formats: AVATAR_FORMAT_LABEL,
			});
	}
}

/* ══════════════════════════════════════════════════════════════════════════
 * Crop screen copy
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The browser could not read the file as an image, or could not produce the cropped result.
 *
 * Both failures collapse into one sentence **because the user's next step is the same**. Either way
 * this file cannot proceed, and the cause (codec, corruption, memory) cannot be told apart in a way
 * worth showing.
 */
export const avatarCropFailed = (): string =>
	translator("account")("avatarFile.couldnTReadTheImage2");

/**
 * An image with nothing left to crop.
 *
 * A file over the upper limit that is also shorter than the lower limit is rare but real (a very
 * long strip image). Opening the crop screen then would ask for something that cannot be done, so
 * the server's rejection is stated here first.
 */
/**
 * Accessible name for the draggable area.
 *
 * This area has no semantic counterpart (it is an image box you drag). So the name is the only
 * statement of what it is, and it also says it is reachable with arrow keys. Mouse-only controls
 * would make this window an irreversible center crop for keyboard users.
 */
export const avatarCropPanLabel = (): string =>
	translator("account")("avatarFile.adjustThePhotoDragOr");

export const avatarCropTooSmall = (): string =>
	translator("account")("avatarFile.cropTooSmall", {
		min: AVATAR_LIMITS.minDimension,
	});

/* ══════════════════════════════════════════════════════════════════════════
 * When the server rejects
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * When the account cannot change its photo.
 *
 * The reason is deliberately not drawn here. The authority for the public reason is `GET
 * /v2/me/moderation`; carrying the sentence in every failure response would make the same fact
 * diverge in two places. This only points the way.
 */
const restrictedMessage = (): string =>
	translator("account")("avatarFile.aRestrictedAccountCanT");

/**
 * Upload and delete share **one sentence**.
 *
 * Writing "could not save" would be a lie for a failed delete, and two functions would add another
 * set of per-code branches that new code gets attached to on one side only. To the user both
 * operations are simply "changing the profile photo".
 */
const genericMessage = (): string =>
	translator("account")("avatarFile.couldnTChangeTheProfile");

/**
 * Avatar write failure → one human-readable line.
 *
 * Branching uses `code`, not the status code (the repository convention). The server message is not
 * drawn directly because it is written for developers; the screen should say what the user can do
 * now.
 */
export function avatarErrorMessage(error: unknown): string {
	const apiError = isRowCatApiError(error) ? error : null;
	if (!apiError) return genericMessage();

	switch (apiError.code) {
		case MEDIA_ERROR_CODE.tooLarge:
			return avatarIssueMessage("too_large");
		case MEDIA_ERROR_CODE.empty:
			return avatarIssueMessage("empty");
		case MEDIA_ERROR_CODE.unsupportedType:
			return avatarIssueMessage("unsupported_type");
		case MEDIA_ERROR_CODE.invalidImage:
			return translator("account")("avatarFile.couldnTReadTheImage");
		case MEDIA_ERROR_CODE.invalidDimensions:
			/**
			 * Three conditions arrive under this one code: a side too long, too many total pixels, or **too
			 * small**. One sentence names all three because the user usually sees which applies from the
			 * file itself. Writing only "please shrink" would make someone with a small photo shrink it
			 * further and fail forever.
			 */
			return translator("account")("avatarFile.badDimensions", {
				min: AVATAR_LIMITS.minDimension,
				max: AVATAR_LIMITS.maxDimension,
			});
		case MEDIA_ERROR_CODE.storageFailed:
			/**
			 * **The only failure where retrying can actually help.** Unlike the other messages, this does
			 * not ask the user to change the file; the file is fine.
			 */
			return translator("account")("avatarFile.couldnTSaveTheImage");
		case "capability_restricted":
		case "account_restricted":
			return restrictedMessage();
		case "login_required":
			return translator("account")("avatarFile.youNeedToSignIn");
		default:
			/**
			 * Failures without an error envelope (for example an HTML error page from a proxy) also land
			 * here, so only the status code remains to inspect. 413 can come from the body limit cutting the
			 * request **before the body is read**, so there may be no envelope; 403 is a sanction.
			 */
			if (apiError.status === 413) return avatarIssueMessage("too_large");
			if (apiError.status === 403) return restrictedMessage();
			return genericMessage();
	}
}
