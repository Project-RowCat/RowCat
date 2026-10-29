import {
	CAPABILITY_ERROR_CODE,
	STORY_COVER_ERROR_CODE,
	STORY_COVER_LIMITS,
} from "@rowcat/contracts";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import {
	checkCoverFile,
	coverErrorMessage,
	coverInputHint,
	coverIssueMessage,
} from "./file.ts";

/**
 * Checks the cover file guidance without rendering. A wrong verdict fails silently: too loose lets
 * the server reject a fully uploaded file; too strict blocks files the server would accept. Neither
 * throws, so review does not catch it.
 */

/** Reproduces the server's thrown error as-is. The screen always receives this shape. */
const apiError = (code: string, status: number): RowCatApiError =>
	new RowCatApiError({
		status,
		code,
		message: "what the server tells developers",
	});

describe("cover file pre-check", () => {
	/**
	 * The exact upper bound must pass. A wrong inequality would block files at exactly the contract's
	 * limit (5 MiB), and only a file of that exact size would reveal it.
	 */
	it("a size exactly at the limit passes", () => {
		expect(
			checkCoverFile({
				type: "image/jpeg",
				size: STORY_COVER_LIMITS.maxBytes,
			}),
		).toBeNull();
	});

	/**
	 * One byte over the limit must be rejected. The check must sit where the server's bodyLimit does.
	 */
	it("one byte over the limit fails on size", () => {
		expect(
			checkCoverFile({
				type: "image/png",
				size: STORY_COVER_LIMITS.maxBytes + 1,
			}),
		).toBe("too_large");
	});

	/**
	 * A 0-byte file has no size or type to check. Without this branch, an empty file would be reported
	 * as a format mismatch, and re-picking a valid JPEG would show the same sentence.
	 */
	it("a zero-byte file is reported as empty", () => {
		expect(checkCoverFile({ type: "image/jpeg", size: 0 })).toBe("empty");
	});

	/**
	 * Unsupported format. SVG is excluded explicitly because it is a document that can run scripts,
	 * not an image.
	 */
	it("an unaccepted format fails on format", () => {
		expect(checkCoverFile({ type: "image/svg+xml", size: 1024 })).toBe(
			"unsupported_type",
		);
		expect(checkCoverFile({ type: "image/avif", size: 1024 })).toBe(
			"unsupported_type",
		);
	});

	/** The four accepted formats pass unchanged. GIF is accepted because of its animation. */
	it("JPEG, PNG, WebP and GIF pass", () => {
		expect(checkCoverFile({ type: "image/jpeg", size: 1024 })).toBeNull();
		expect(checkCoverFile({ type: "image/png", size: 1024 })).toBeNull();
		expect(checkCoverFile({ type: "image/webp", size: 1024 })).toBeNull();
		expect(checkCoverFile({ type: "image/gif", size: 1024 })).toBeNull();
	});

	/**
	 * Per-format limits are the point of this guidance. One large limit would let PNGs over 5 MB pass
	 * the screen and fail on the server, which is the round trip the guidance exists to save. One
	 * small limit would block GIFs the server accepts. Both failures look like the guidance was
	 * followed and the result differs.
	 */
	it("a GIF passes even over the still-image limit", () => {
		const overStill = STORY_COVER_LIMITS.maxBytes + 1;
		expect(checkCoverFile({ type: "image/png", size: overStill })).toBe(
			"too_large",
		);
		expect(checkCoverFile({ type: "image/gif", size: overStill })).toBeNull();
	});

	it("a GIF can't exceed its own limit", () => {
		expect(
			checkCoverFile({
				type: "image/gif",
				size: STORY_COVER_LIMITS.maxAnimatedBytes,
			}),
		).toBeNull();
		expect(
			checkCoverFile({
				type: "image/gif",
				size: STORY_COVER_LIMITS.maxAnimatedBytes + 1,
			}),
		).toBe("too_large");
	});

	/**
	 * Unknown types are not blocked. A file without an extension gets an empty MIME string, and
	 * rejecting it would block a valid image the server could decode. This check is guidance, not
	 * validation.
	 */
	it("a file with an unknown MIME is left to the server", () => {
		expect(checkCoverFile({ type: "", size: 1024 })).toBeNull();
	});

	/**
	 * Format is checked before size. Do not tell the user to shrink a file that could not be uploaded
	 * anyway.
	 */
	it("when both format and size are wrong, format is reported first", () => {
		expect(
			checkCoverFile({
				type: "image/svg+xml",
				size: STORY_COVER_LIMITS.maxAnimatedBytes + 1,
			}),
		).toBe("unsupported_type");
	});
});

describe("cover hint copy", () => {
	/**
	 * The size message must come from the contract's limits, not hand-typed numbers. Hand-typed
	 * numbers stay stale after a contract change, and users following them fail.
	 */
	it("the size hint comes from the contract limit", () => {
		const megabytes = Math.floor(STORY_COVER_LIMITS.maxBytes / (1024 * 1024));
		expect(coverIssueMessage("too_large")).toContain(`${megabytes}MB`);
		expect(coverInputHint()).toContain(`${megabytes}MB`);
	});

	/** Naming the accepted formats matters. Without it, users try formats one at a time. */
	it("the format hint lists the accepted formats", () => {
		expect(coverIssueMessage("unsupported_type")).toContain("JPEG");
		expect(coverIssueMessage("unsupported_type")).toContain("PNG");
		expect(coverIssueMessage("unsupported_type")).toContain("WebP");
		expect(coverInputHint()).toContain("WebP");
	});

	/**
	 * For an empty file, tell the user to pick another one, since there is nothing to shrink or
	 * convert.
	 */
	it("the empty-file message says to choose again", () => {
		expect(coverIssueMessage("empty")).toContain("choose");
	});
});

describe("cover failure messages", () => {
	/**
	 * The five server codes must map to five distinct sentences. Merging them leaves the user unable
	 * to tell what to fix, so they re-upload the same file. That is why the server splits its codes.
	 */
	it("the server's five codes become five different sentences", () => {
		const messages = [
			STORY_COVER_ERROR_CODE.tooLarge,
			STORY_COVER_ERROR_CODE.empty,
			STORY_COVER_ERROR_CODE.unsupportedType,
			STORY_COVER_ERROR_CODE.invalidImage,
			STORY_COVER_ERROR_CODE.dimensionsTooLarge,
		].map((code) => coverErrorMessage(apiError(code, 400)));
		expect(new Set(messages).size).toBe(messages.length);
	});

	/**
	 * The size rejection uses the same sentence as the pre-check. The same fact is not stated two
	 * different ways.
	 */
	it("the size rejection is the same sentence as the pre-check", () => {
		expect(
			coverErrorMessage(apiError(STORY_COVER_ERROR_CODE.tooLarge, 413)),
		).toBe(coverIssueMessage("too_large"));
	});

	it("the empty-body rejection is the same sentence as the pre-check", () => {
		expect(coverErrorMessage(apiError(STORY_COVER_ERROR_CODE.empty, 400))).toBe(
			coverIssueMessage("empty"),
		);
	});

	/**
	 * The same applies to format rejections, including those the server reaches after reading the
	 * bytes.
	 */
	it("the format rejection is the same sentence as the pre-check", () => {
		expect(
			coverErrorMessage(apiError(STORY_COVER_ERROR_CODE.unsupportedType, 400)),
		).toBe(coverIssueMessage("unsupported_type"));
	});

	/**
	 * The file is a valid format but fails to decode. Calling it a format mismatch would make the user
	 * re-convert a file that already has the right format.
	 */
	it("a broken image mentions possible damage", () => {
		expect(
			coverErrorMessage(apiError(STORY_COVER_ERROR_CODE.invalidImage, 400)),
		).toContain("damaged");
	});

	/**
	 * The resolution limits also come from the contract, and a message must name the value to reduce.
	 * Both axes must be named. The server sends one code for a side that is too long and for too many
	 * total pixels. A message naming only the long side would send someone with a 6000x5000 photo
	 * (both sides under the limit, 30 MP) to fix a condition they already meet, and they would never
	 * pass.
	 */
	it("the resolution rejection states both contract limits", () => {
		expect(
			coverErrorMessage(
				apiError(STORY_COVER_ERROR_CODE.dimensionsTooLarge, 400),
			),
		).toContain(`${STORY_COVER_LIMITS.maxDimension}px`);
		expect(
			coverErrorMessage(
				apiError(STORY_COVER_ERROR_CODE.dimensionsTooLarge, 400),
			),
		).toContain(
			`${Math.round(STORY_COVER_LIMITS.maxPixels / 1_000_000)} megapixels`,
		);
	});

	/**
	 * Restriction responses repeat the same answer on retry. Folding them into a generic failure would
	 * make the user keep retrying with 'try again later' and never point them to the account screen.
	 */
	it("capability limits and account sanctions point to the account screen", () => {
		expect(
			coverErrorMessage(apiError(CAPABILITY_ERROR_CODE.restricted, 403)),
		).toContain("account screen");
		expect(coverErrorMessage(apiError("account_restricted", 403))).toContain(
			"account screen",
		);
	});

	/**
	 * A 403 without a readable envelope is also treated as a restriction. Only the status code remains
	 * as a clue, so it is used.
	 */
	it("a 403 with no envelope is treated as a restriction", () => {
		expect(coverErrorMessage(apiError("http_error", 403))).toContain(
			"account screen",
		);
	});

	/**
	 * The 404 reason is not explained further. The server deliberately folds missing, others', and
	 * inaccessible works into one 404. If the screen separated them, the cover path would work as an
	 * existence probe.
	 */
	it("a 404 only says not found, without a reason", () => {
		const message = coverErrorMessage(apiError("not_found", 404));
		expect(message).toBe("The story couldn't be found.");
		expect(message).not.toContain("private");
		expect(message).not.toContain("permission");
	});

	/** Login expiry does not resolve by retrying, so the message says what to do. */
	it("a lost sign-in gets its own sentence", () => {
		expect(coverErrorMessage(apiError("login_required", 401))).toContain(
			"sign in",
		);
	});

	/**
	 * Non-SDK errors (network failure, TypeError) must still produce a sentence. If undefined leaked
	 * out, the role="alert" region would stay empty and the user would think nothing happened.
	 */
	it("an unknown failure still gives a try-again sentence", () => {
		const fallback = coverErrorMessage(new TypeError("Failed to fetch"));
		expect(fallback).toContain("try again");
		expect(coverErrorMessage(undefined)).toBe(fallback);
		expect(coverErrorMessage("string error")).toBe(fallback);
	});

	/** Server messages are not shown verbatim. They are written for developers. */
	it("does not copy the server message to the screen", () => {
		expect(
			coverErrorMessage(apiError(STORY_COVER_ERROR_CODE.invalidImage, 400)),
		).not.toContain("developers");
	});
});
