import { STORY_COVER_LIMITS } from "@rowcat/contracts";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import type { PickedImage } from "../../lib/image-picker.ts";
import {
	COVER_INPUT_HINT,
	checkPickedCover,
	coverErrorMessage,
	coverIssueMessage,
} from "./cover-file.ts";

/**
 * Checks that the cover's pre-flight hint agrees with the server. The pre-flight is not a
 * validation boundary, so the test pins two things: unknown values pass (blocking would reject a
 * fine picture that lacks metadata), and the limits come from the contract, never hand-written.
 */

const picked = (patch: Partial<PickedImage> = {}): PickedImage => ({
	uri: "file:///cover.jpg",
	mimeType: "image/jpeg",
	byteSize: 1024,
	width: 1200,
	height: 1600,
	...patch,
});

describe("checkPickedCover", () => {
	it("an ordinary picture passes", () => {
		expect(checkPickedCover(picked())).toBeNull();
	});

	it("an empty file comes first — there's no format or size to judge", () => {
		expect(
			checkPickedCover(picked({ byteSize: 0, mimeType: "image/tiff" })),
		).toBe("empty");
	});

	it("states the unaccepted format", () => {
		expect(checkPickedCover(picked({ mimeType: "image/tiff" }))).toBe(
			"unsupported_type",
		);
	});

	/* Some picker paths report no format or size; the server decodes the bytes and makes the final call. */
	it("doesn't block unknown values", () => {
		expect(
			checkPickedCover(
				picked({ mimeType: null, byteSize: null, width: null, height: null }),
			),
		).toBeNull();
	});

	/* Limits differ per format: a single limit would either pass an oversized PNG or block an accepted GIF. */
	it("GIF's byte limit is more generous than still images'", () => {
		const overStill = STORY_COVER_LIMITS.maxBytes + 1;
		expect(
			checkPickedCover(picked({ mimeType: "image/png", byteSize: overStill })),
		).toBe("too_large");
		expect(
			checkPickedCover(picked({ mimeType: "image/gif", byteSize: overStill })),
		).toBeNull();
		expect(
			checkPickedCover(
				picked({
					mimeType: "image/gif",
					byteSize: STORY_COVER_LIMITS.maxAnimatedBytes + 1,
				}),
			),
		).toBe("too_large");
	});

	/* File size does not bound pixels: a small file can unfold to tens of millions of pixels. */
	it("checks one side and total pixels separately", () => {
		expect(
			checkPickedCover(
				picked({
					byteSize: 1024,
					width: STORY_COVER_LIMITS.maxDimension + 1,
					height: 10,
				}),
			),
		).toBe("too_many_pixels");
		expect(
			checkPickedCover(picked({ byteSize: 1024, width: 9000, height: 9000 })),
		).toBe("too_many_pixels");
	});
});

describe("copy", () => {
	/* The hint and the failure copy are derived from the same contract numbers. */
	it("one line of guidance states format and limit together", () => {
		expect(COVER_INPUT_HINT).toContain("JPEG");
		expect(COVER_INPUT_HINT).toContain("GIF");
		expect(COVER_INPUT_HINT).toContain(
			String(Math.floor(STORY_COVER_LIMITS.maxBytes / (1024 * 1024))),
		);
	});

	/* Too many frames needs different copy from oversized resolution: shrinking the size does not fix frame count. */
	it("tells frame overruns from resolution overruns", () => {
		const frames = coverErrorMessage(
			new RowCatApiError({
				status: 400,
				code: "story_cover_too_many_frames",
				message: "x",
			}),
		);
		const pixels = coverErrorMessage(
			new RowCatApiError({
				status: 400,
				code: "story_cover_dimensions_too_large",
				message: "x",
			}),
		);
		expect(frames).not.toBe(pixels);
		expect(frames).toContain(String(STORY_COVER_LIMITS.maxFrames));
		expect(pixels).toBe(coverIssueMessage("too_many_pixels"));
	});

	/* The server folds someone else's story and a missing one into one 404 on purpose; the copy must not separate them. */
	it("a 404 doesn't state the reason", () => {
		expect(
			coverErrorMessage(
				new RowCatApiError({ status: 404, code: "not_found", message: "x" }),
			),
		).toBe("The story couldn't be found.");
	});

	/* Sanctions point to the account screen; the reason is shown there, not in the cover flow. */
	it("sanctions point to the account screen", () => {
		expect(
			coverErrorMessage(
				new RowCatApiError({
					status: 403,
					code: "account_restricted",
					message: "x",
				}),
			),
		).toContain("account screen");
	});

	it("a failure without an envelope has a sentence too", () => {
		expect(coverErrorMessage(new Error("network"))).toBeTruthy();
	});
});
