import { AVATAR_LIMITS, MEDIA_ERROR_CODE } from "@rowcat/contracts";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import {
	avatarCropTooSmall,
	avatarErrorMessage,
	avatarInputHint,
	avatarIssueMessage,
	avatarIssueOpensCrop,
	checkAvatarFile,
} from "./avatar-file.ts";

/**
 * Pre-selection hints and failure copy for the profile photo.
 *
 * ## What it guards
 *
 * This file guards not validation but **what the user does next**. The server is the final
 * authority (`apps/api/src/lib/media/image.ts`); the checks here are hints that save a round trip.
 * So instead of counting "was it blocked", it counts **"did a blocked person hear something they
 * can act on"**.
 *
 * Two places where that distinction matters:
 *
 * ```text
 * unknown type (`""`)    must not block: a valid JPEG without an extension would be blocked on screen
 * storage failure (5xx)  must be a different sentence: nothing is wrong with that person's file
 * ```
 *
 * It must be checkable without rendering so these splits are locked by tests, which is why this
 * logic lives outside the component (the cover `cover-file.ts` already makes the same judgement).
 */

describe("hint before choosing", () => {
	/**
	 * A hand-typed number leaves the hint stale when the limit changes: the user follows our hint and
	 * the server still rejects the file.
	 */
	it("takes the limits and formats from the contract", () => {
		expect(avatarInputHint()).toContain("JPEG · PNG · WebP");
		expect(avatarInputHint()).toContain(
			String(Math.floor(AVATAR_LIMITS.maxBytes / (1024 * 1024))),
		);
		/** A dimension limit not shown on the cover: learning it only after the server rejects is especially frustrating. */
		expect(avatarInputHint()).toContain(String(AVATAR_LIMITS.minDimension));
	});

	/**
	 * Cropping cannot be undone. Someone who uploads a tall photo and only learns this after seeing
	 * the result has the wrong order, so it is said **before** choosing.
	 */
	it("says up front that the photo is cropped to a square", () => {
		expect(avatarInputHint()).toContain("square");
	});

	/**
	 * **The limit became a branch, not a wall.** Stating only the number makes someone with a large
	 * photo give up before choosing, when they can actually crop it on the spot.
	 */
	it("says what happens past the limit", () => {
		expect(avatarInputHint()).toContain("crop it yourself");
	});
});

describe("the branch to cropping", () => {
	/**
	 * Only size is a branch. The other two cannot be fixed by cropping (the server never accepts the
	 * format, and an empty file has nothing to crop), so they end in copy.
	 */
	it("only size opens the crop dialog", () => {
		expect(avatarIssueOpensCrop("too_large")).toBe(true);
		expect(avatarIssueOpensCrop("unsupported_type")).toBe(false);
		expect(avatarIssueOpensCrop("empty")).toBe(false);
	});

	/**
	 * **The order of the checks is the safeguard of this branch.** The format is checked before size,
	 * so an over-limit GIF goes to the format message rather than the crop dialog. If it opened the
	 * dialog, the user would finish cropping and only then be rejected by the server.
	 */
	it("an unaccepted format does not go to cropping even when over the limit", () => {
		const issue = checkAvatarFile({
			type: "image/gif",
			size: AVATAR_LIMITS.maxBytes * 3,
		});
		expect(issue).toBe("unsupported_type");
		expect(issue && avatarIssueOpensCrop(issue)).toBe(false);
	});

	/**
	 * The server always rejects an image with nothing left to crop (a very long strip). If the crop
	 * screen does not say so **first**, the user is asked for something impossible and then fails. So
	 * the copy carries the minimum edge.
	 */
	it("the cannot-crop message states the minimum", () => {
		expect(avatarCropTooSmall()).toContain(String(AVATAR_LIMITS.minDimension));
	});
});

describe("chosen file", () => {
	it("accepted formats pass", () => {
		for (const type of ["image/jpeg", "image/png", "image/webp"])
			expect(checkAvatarFile({ type, size: 1024 })).toBeNull();
	});

	it("unaccepted formats fail on format", () => {
		for (const type of ["image/svg+xml", "image/gif", "application/pdf"])
			expect(checkAvatarFile({ type, size: 1024 })).toBe("unsupported_type");
	});

	/**
	 * **Not blocking unknown types is the easiest place to get this function wrong.** Browsers give an
	 * empty string for files with no extension. Rejecting that would block a valid JPEG the server
	 * would accept, and the person has no way to fix it (we do not tell them to rename the file).
	 * Unknown types are left for the byte reader to answer.
	 */
	it("an empty MIME is not blocked; the server decides", () => {
		expect(checkAvatarFile({ type: "", size: 1024 })).toBeNull();
	});

	/** 0 bytes comes before type: that file has nothing to judge for type or size. */
	it("an empty file fails before format", () => {
		expect(checkAvatarFile({ type: "application/pdf", size: 0 })).toBe("empty");
	});

	it("going past the limit fails on size", () => {
		expect(
			checkAvatarFile({
				type: "image/png",
				size: AVATAR_LIMITS.maxBytes + 1,
			}),
		).toBe("too_large");
		/** The boundary value passes; the server also judges with `>`. */
		expect(
			checkAvatarFile({ type: "image/png", size: AVATAR_LIMITS.maxBytes }),
		).toBeNull();
	});
});

const apiError = (code: string, status = 400) =>
	new RowCatApiError({
		status,
		code,
		message: "what the server tells developers",
	});

describe("failure messages", () => {
	/**
	 * Server copy is not drawn verbatim. That text is addressed to developers; the screen needs to say
	 * what to do now.
	 */
	it("does not draw the server's text verbatim", () => {
		expect(avatarErrorMessage(apiError(MEDIA_ERROR_CODE.tooLarge))).not.toBe(
			"what the server tells developers",
		);
	});

	/**
	 * **Four failures must state four different next steps.** Folding them together would have the
	 * user re-upload the same file without knowing what to fix.
	 */
	it("each reason gives a different sentence", () => {
		const messages = [
			MEDIA_ERROR_CODE.tooLarge,
			MEDIA_ERROR_CODE.unsupportedType,
			MEDIA_ERROR_CODE.invalidImage,
			MEDIA_ERROR_CODE.invalidDimensions,
		].map((code) => avatarErrorMessage(apiError(code)));
		expect(new Set(messages).size).toBe(messages.length);
	});

	/** Pre-selection hints and post-failure copy must be **the same sentence** — do not say it two different ways. */
	it("the hint and the server rejection use the same sentence", () => {
		expect(avatarErrorMessage(apiError(MEDIA_ERROR_CODE.tooLarge))).toBe(
			avatarIssueMessage("too_large"),
		);
		expect(avatarErrorMessage(apiError(MEDIA_ERROR_CODE.unsupportedType))).toBe(
			avatarIssueMessage("unsupported_type"),
		);
	});

	/**
	 * **Size failure must say both directions.** Three axes (too large, pixel bomb, too small) arrive
	 * under one code; saying only "make it smaller" makes someone with a small photo shrink it further
	 * and fail forever.
	 */
	it("a dimension failure states both the minimum and maximum", () => {
		const message = avatarErrorMessage(
			apiError(MEDIA_ERROR_CODE.invalidDimensions),
		);
		expect(message).toContain(String(AVATAR_LIMITS.minDimension));
		expect(message).toContain(String(AVATAR_LIMITS.maxDimension));
	});

	/**
	 * **The only failure where retrying can actually help.** Unlike the others, do not tell them to
	 * change the file: there is nothing wrong with their file.
	 */
	it("only a storage failure suggests retrying instead of another file", () => {
		const message = avatarErrorMessage(
			apiError(MEDIA_ERROR_CODE.storageFailed, 503),
		);
		expect(message).toContain("try again");
		expect(message).not.toContain("choose");
	});

	/**
	 * 413 can be sent before the whole body is read, so there may be no envelope. The size guidance
	 * must still appear: if a bare status failure falls to generic copy, the person who uploaded a
	 * large file never learns why.
	 */
	it("a 413 with no envelope still falls to the size guidance", () => {
		expect(avatarErrorMessage(apiError("", 413))).toBe(
			avatarIssueMessage("too_large"),
		);
	});

	/** A sanction does not draw its reason; it **only gives the way forward**. The authority for the public reason is another resource. */
	it("a restriction points to the account screen", () => {
		expect(avatarErrorMessage(apiError("account_restricted", 403))).toContain(
			"account screen",
		);
		expect(avatarErrorMessage(apiError("", 403))).toContain("account screen");
	});

	/** A failure that is not an API error (network drop, etc.) also ends in one sentence. */
	it("a failure with no envelope still gives a sentence", () => {
		expect(avatarErrorMessage(new Error("network"))).toContain(
			"Couldn't change the profile photo",
		);
	});
});
