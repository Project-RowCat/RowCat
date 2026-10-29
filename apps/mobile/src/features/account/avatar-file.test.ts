import { AVATAR_LIMITS, MEDIA_ERROR_CODE } from "@rowcat/contracts";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import {
	AVATAR_CROP_TOO_SMALL,
	AVATAR_INPUT_HINT,
	avatarErrorMessage,
	avatarIssueMessage,
	avatarIssueOpensCrop,
	checkPickedAvatar,
} from "./avatar-file.ts";

/**
 * Pre-flight hints for the profile photo: block only what can be known, leave the rest to the
 * server.
 */

const picked = (
	patch: Partial<Parameters<typeof checkPickedAvatar>[0]> = {},
) => ({
	mimeType: "image/jpeg",
	byteSize: 1024,
	width: 512,
	height: 512,
	...patch,
});

describe("checkPickedAvatar", () => {
	it("an intact picture passes", () => {
		expect(checkPickedAvatar(picked())).toBeNull();
	});

	it("zero bytes comes before format", () => {
		expect(
			checkPickedAvatar(picked({ byteSize: 0, mimeType: "text/plain" })),
		).toBe("empty");
	});

	/** Accepted formats are the contract's three; GIF, SVG and HEIC never upload even if the picker offers them. */
	it.each([
		"image/gif",
		"image/svg+xml",
		"image/heic",
		"image/avif",
	])("%s is not promoted", (mimeType) => {
		expect(checkPickedAvatar(picked({ mimeType }))).toBe("unsupported_type");
	});

	it("reads the byte limit from the contract", () => {
		expect(
			checkPickedAvatar(picked({ byteSize: AVATAR_LIMITS.maxBytes })),
		).toBeNull();
		expect(
			checkPickedAvatar(picked({ byteSize: AVATAR_LIMITS.maxBytes + 1 })),
		).toBe("too_large");
	});

	/** The server always rejects a short side below the minimum, so say so before the round trip. */
	it("filters out anything below the minimum size in advance", () => {
		expect(
			checkPickedAvatar(
				picked({ width: AVATAR_LIMITS.minDimension - 1, height: 4000 }),
			),
		).toBe("too_small");
	});

	/**
	 * Unknown values do not block. Some picker paths give no format, size or pixels, and inventing a
	 * size to reject would block images the server would accept; the authority is the server decoding
	 * the bytes.
	 */
	it("an unknown axis (null) passes", () => {
		expect(
			checkPickedAvatar(
				picked({ mimeType: null, byteSize: null, width: null, height: null }),
			),
		).toBeNull();
		/** With only one axis known, judge only that axis. */
		expect(checkPickedAvatar(picked({ width: null }))).toBeNull();
	});
});

describe("copy", () => {
	it("the hint and the failure name the same format list", () => {
		expect(AVATAR_INPUT_HINT).toContain("JPEG · PNG · WebP");
		expect(avatarIssueMessage("unsupported_type")).toContain(
			"JPEG · PNG · WebP",
		);
	});

	it("the hint states the minimum size and square cropping in advance", () => {
		expect(AVATAR_INPUT_HINT).toContain(`${AVATAR_LIMITS.minDimension}px`);
		expect(AVATAR_INPUT_HINT).toContain("square");
	});
});

describe("avatarErrorMessage", () => {
	const apiError = (code: string, status = 400) =>
		new RowCatApiError({ status, code, message: "" });

	/** Each server media code has its own sentence; folding them all into generic copy loses the next action. */
	it.each([
		[MEDIA_ERROR_CODE.tooLarge, "a smaller file"],
		[MEDIA_ERROR_CODE.unsupportedType, "JPEG · PNG · WebP"],
		[MEDIA_ERROR_CODE.invalidImage, "damaged"],
		[MEDIA_ERROR_CODE.invalidDimensions, `${AVATAR_LIMITS.minDimension}px`],
		[MEDIA_ERROR_CODE.storageFailed, "try again"],
		["account_restricted", "restricted account"],
	])("%s → %s", (code, fragment) => {
		expect(avatarErrorMessage(apiError(code))).toContain(fragment);
	});

	it("413 and 403 without an envelope get their own sentences too", () => {
		expect(avatarErrorMessage(apiError("unknown", 413))).toContain(
			"a smaller file",
		);
		expect(avatarErrorMessage(apiError("unknown", 403))).toContain(
			"restricted account",
		);
	});

	it("an unknown failure is generic copy — the raw text isn't drawn", () => {
		expect(avatarErrorMessage(new Error("ECONNRESET at 10.0.0.1"))).toBe(
			"Couldn't change the profile photo. Please try again in a moment.",
		);
	});
});

describe("the fork to cropping", () => {
	/**
	 * Only size is a fork. The other three cannot be fixed by cropping (the server never accepts the
	 * format, an empty file has nothing to crop, a too-small image stays small after cropping) and end
	 * as copy. Must give the same answer as web.
	 */
	it("only size opens the crop window", () => {
		expect(avatarIssueOpensCrop("too_large")).toBe(true);
		expect(avatarIssueOpensCrop("unsupported_type")).toBe(false);
		expect(avatarIssueOpensCrop("empty")).toBe(false);
		expect(avatarIssueOpensCrop("too_small")).toBe(false);
	});

	/**
	 * The order of the checks is the fork's safeguard. Format is judged before size, so an over-limit
	 * GIF goes to the format message rather than the crop dialog; if it opened, the user would be
	 * rejected by the server only after finishing the crop.
	 */
	it("an unaccepted format doesn't go to cropping even over the size limit", () => {
		const issue = checkPickedAvatar(
			picked({ mimeType: "image/gif", byteSize: AVATAR_LIMITS.maxBytes * 3 }),
		);
		expect(issue).toBe("unsupported_type");
		expect(issue && avatarIssueOpensCrop(issue)).toBe(false);
	});

	/**
	 * An image with nothing left to crop (a very long strip) is always rejected by the server. If the
	 * crop screen does not say so first, the user is asked to do something unfixable and then fails.
	 */
	it("the can't-crop copy states the minimum", () => {
		expect(AVATAR_CROP_TOO_SMALL).toContain(String(AVATAR_LIMITS.minDimension));
	});

	/**
	 * The limit became a fork rather than a wall; a bare number would make people with large photos
	 * give up before picking.
	 */
	it("the hint says what happens over the limit", () => {
		expect(AVATAR_INPUT_HINT).toContain("crop");
	});
});
