import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import {
	checkRuntimeAudioFile,
	formatRuntimeAudioDuration,
	looksLikeRuntimeAudio,
	runtimeAudioErrorMessage,
	runtimeAudioIssueMessage,
} from "./audio-file.ts";
import { checkRuntimeImageFile } from "./file.ts";

/**
 * Pre-check for sound files: guidance, not validation. The server parses the container and makes
 * the final decision. Two things are pinned as values. First, this check decides which pipeline a
 * file goes to; if it were wrong, an MP3 would be routed to the image path. Second, failure wording
 * differs by media type. Saying 'smaller file' for an over-length audio file would make the user
 * receive the same rejection again.
 */

const file = (name: string, type: string, size = 1024) => ({
	name,
	type,
	size,
});

describe("which pipeline it belongs to", () => {
	it.each([
		["audio/mpeg", "bgm.mp3"],
		["audio/mp4", "bgm.m4a"],
		["audio/x-m4a", "bgm.m4a"],
		["audio/aac", "bgm.m4a"],
	])("%s is a sound", (type, name) => {
		expect(looksLikeRuntimeAudio(file(name, type))).toBe(true);
	});

	/**
	 * Browsers attach inconsistent MIME types to `.m4a` files, and sometimes none at all. Checking
	 * MIME alone would route a valid `.m4a` to the image pipeline.
	 */
	it("decides by extension when the type is empty", () => {
		expect(looksLikeRuntimeAudio(file("bgm.m4a", ""))).toBe(true);
		expect(looksLikeRuntimeAudio(file("BGM.MP3", ""))).toBe(true);
		expect(looksLikeRuntimeAudio(file("sena.png", ""))).toBe(false);
	});

	it("a picture is not a sound", () => {
		expect(looksLikeRuntimeAudio(file("sena.webp", "image/webp"))).toBe(false);
	});

	/**
	 * The two checks must not interfere. Audio is checked first, and that order is the rule. Reversing
	 * it would reject an `.m4a` with an empty MIME type as an unsupported image format, so a user who
	 * picked audio would be told about images.
	 */
	it("the image check doesn't pass sounds", () => {
		expect(checkRuntimeImageFile(file("bgm.mp3", "audio/mpeg"))).toBe(
			"unsupported_type",
		);
	});
});

describe("pre-check", () => {
	it("an empty file is not a format problem", () => {
		expect(checkRuntimeAudioFile(file("bgm.mp3", "audio/mpeg", 0))).toBe(
			"empty",
		);
	});

	it("accepted formats pass", () => {
		expect(checkRuntimeAudioFile(file("bgm.mp3", "audio/mpeg"))).toBeNull();
	});

	it("OGG is not accepted", () => {
		expect(checkRuntimeAudioFile(file("bgm.ogg", "audio/ogg"))).toBeNull();
	});

	it("a file over the limit is blocked on size", () => {
		expect(
			checkRuntimeAudioFile(file("bgm.mp3", "audio/mpeg", 20 * 1024 * 1024)),
		).toBe("too_large");
	});

	/**
	 * Length is not measured here. Browser decoders and the server parser can disagree near the limit,
	 * so the screen would pass a file the server then rejects. The limit is judged on a single axis.
	 */
	it("this layer has no duration axis", () => {
		expect(checkRuntimeAudioFile(file("bgm.mp3", "audio/mpeg"))).toBeNull();
	});
});

describe("copy", () => {
	/**
	 * Over-length and over-size produce different messages. Merged, a user who compressed harder would
	 * get the same rejection again and never learn that length, not size, must shrink.
	 */
	it("too long and too large are separate", () => {
		const tooLong = runtimeAudioErrorMessage(
			new RowCatApiError({
				status: 400,
				code: "media_audio_too_long",
				message: "",
			}),
		);
		const tooLarge = runtimeAudioIssueMessage("too_large");
		expect(tooLong).not.toBe(tooLarge);
		expect(tooLong).toContain("minutes");
		expect(tooLarge).toContain("MB");
	});

	it("an unknown failure speaks in sound vocabulary", () => {
		expect(runtimeAudioErrorMessage(new Error("boom"))).toContain("sound");
	});
});

describe("duration display", () => {
	it.each([
		[0, "0:00"],
		[1_000, "0:01"],
		[102_000, "1:42"],
		[600_000, "10:00"],
		[3_723_000, "1:02:03"],
	])("%dms → %s", (ms, expected) => {
		expect(formatRuntimeAudioDuration(ms)).toBe(expected);
	});
});
