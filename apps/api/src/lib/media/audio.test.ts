import { describe, expect, test } from "vitest";
import {
	buildM4a,
	buildMp3,
	MP3_FRAME_BYTES,
	MP3_FRAME_MS,
} from "../../test/audio-fixture.ts";
import { ApiError } from "../errors.ts";
import { validateAudio } from "./audio.ts";

/**
 * Audio judgement boundary; the bytes are the final authority. Checks that the two accepted
 * containers pass, that bytes merely named like audio are blocked, and that duration is a different
 * axis from size (the one new axis here): a multi-hour file encoded at 8kbps is small, and a byte
 * cap alone cannot stop it.
 */

const codeOf = (run: () => unknown): string => {
	try {
		run();
	} catch (error) {
		if (error instanceof ApiError) return error.code;
		throw error;
	}
	throw new Error("was not rejected");
};

describe("MP3", () => {
	test("measures the length from the CBR frame sequence", () => {
		const audio = validateAudio(buildMp3({ frames: 100 }));
		expect(audio.mime).toBe("audio/mpeg");
		// bytes * 8 / bitrate; within 1% of the frame-count value is the same fact.
		expect(audio.durationMs).toBeGreaterThan(100 * MP3_FRAME_MS * 0.98);
		expect(audio.durationMs).toBeLessThan(100 * MP3_FRAME_MS * 1.02);
	});

	// ID3v2 size is a syncsafe integer; read as plain big-endian it puts the tag end too far out and
	// the first-frame search starts in the middle of audio.
	test("skips the ID3v2 tag", () => {
		const audio = validateAudio(buildMp3({ frames: 50, id3: 2048 }));
		expect(audio.mime).toBe("audio/mpeg");
		expect(audio.durationMs).toBeGreaterThan(0);
	});

	// With Xing, trust its frame count; computing from the first frame's bitrate on a VBR file is off
	// by multiples.
	test("the Xing header's frame count beats the CBR estimate", () => {
		const audio = validateAudio(buildMp3({ frames: 10, xingFrames: 1000 }));
		expect(Math.round(audio.durationMs)).toBe(Math.round(1000 * MP3_FRAME_MS));
	});

	test("a trailing ID3v1 is left out of the audio bytes", () => {
		const withTag = validateAudio(buildMp3({ frames: 20, id3v1: true }));
		const without = validateAudio(buildMp3({ frames: 20 }));
		expect(withTag.durationMs).toBe(without.durationMs);
	});

	test("no sync word means it isn't sound", () => {
		expect(codeOf(() => validateAudio(Buffer.alloc(4096)))).toBe(
			"media_unsupported_type",
		);
	});

	// Extensions and request claims are not read; arbitrary renamed bytes do not pass.
	test("bytes that are sound only by name are blocked", () => {
		const text = Buffer.from("this is not sound".repeat(200), "utf8");
		expect(codeOf(() => validateAudio(text))).toBe("media_unsupported_type");
	});

	// Reserved versions/layers and free/bad bitrates are not frames: their duration cannot be
	// computed, and folding that to 0 would let damaged files pass.
	test("reserved version bits are not a frame", () => {
		const broken = buildMp3({ frames: 30 });
		for (let at = 0; at + 1 < broken.byteLength; at += MP3_FRAME_BYTES)
			broken[at + 1] = 0xeb; // version = 01 (reserved)
		expect(codeOf(() => validateAudio(broken))).toBe("media_unsupported_type");
	});

	// A file with only one plausible header: without the next frame in place it is not sync.
	test("a file with only one header line is blocked", () => {
		const fake = Buffer.alloc(4096);
		Buffer.from([0xff, 0xfb, 0x90, 0xc0]).copy(fake, 0);
		expect(codeOf(() => validateAudio(fake))).toBe("media_unsupported_type");
	});
});

describe("M4A", () => {
	test("measures the length from mvhd's timescale and duration", () => {
		const audio = validateAudio(
			buildM4a({ timescale: 44100, duration: 44100 * 30 }),
		);
		expect(audio.mime).toBe("audio/mp4");
		expect(audio.durationMs).toBe(30_000);
	});

	test("an unfamiliar major brand is accepted if its compatible list has one we know", () => {
		expect(validateAudio(buildM4a({ brand: "qt  " })).mime).toBe("audio/mp4");
	});

	// `.m4a` and `.mp4` are the same container; a file with a video track stored as `runtime_audio`
	// would carry video under a name that says sound.
	test("not accepted when it has a video track", () => {
		expect(codeOf(() => validateAudio(buildM4a({ video: true })))).toBe(
			"media_unsupported_type",
		);
	});

	/**
	 * The walker stops at its box cap. Judging only what it reached let a video track hidden behind
	 * four thousand filler boxes pass as audio; reaching the cap now rejects the file.
	 */
	test("a video track hidden past the box cap is not accepted either", () => {
		expect(
			codeOf(() =>
				validateAudio(buildM4a({ video: true, fillerBoxes: 4_100 })),
			),
		).toBe("media_invalid_audio");
	});

	test("no sound track means it is damaged", () => {
		expect(codeOf(() => validateAudio(buildM4a({ silent: true })))).toBe(
			"media_invalid_audio",
		);
	});

	test("zero length means it is damaged", () => {
		expect(codeOf(() => validateAudio(buildM4a({ duration: 0 })))).toBe(
			"media_invalid_audio",
		);
	});

	// A box size pointing past the resource stops traversal: no infinite loop, no over-read.
	test("a truncated file is damaged", () => {
		const truncated = buildM4a().subarray(0, 40);
		expect(codeOf(() => validateAudio(truncated))).toBe("media_invalid_audio");
	});
});

describe("limits", () => {
	test("an empty body is not a format problem", () => {
		expect(codeOf(() => validateAudio(Buffer.alloc(0)))).toBe("media_empty");
	});

	// Duration is a different axis from size: this file is small (Xing states the frame count) and
	// long, which a byte cap cannot stop; that is why this cap exists separately.
	test("a small but long file is blocked by length", () => {
		const long = buildMp3({ frames: 10, xingFrames: 60_000 });
		expect(long.byteLength).toBeLessThan(64 * 1024);
		expect(codeOf(() => validateAudio(long))).toBe("media_audio_too_long");
	});

	test("a body over the limit is blocked by size", () => {
		const huge = Buffer.concat([
			buildMp3({ frames: 4 }),
			Buffer.alloc(11 * 1024 * 1024),
		]);
		expect(codeOf(() => validateAudio(huge))).toBe("media_too_large");
	});
});

describe("what is stored", () => {
	// The original bytes are stored unchanged: pins the decision not to re-encode; its cost (container
	// tags survive) is documented in the `lib/media/audio.ts` header.
	test("does not touch the bytes", () => {
		const raw = buildMp3({ frames: 12 });
		expect(validateAudio(raw).bytes).toBe(raw);
	});
});
