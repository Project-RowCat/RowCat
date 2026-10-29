import { STORY_COVER_ERROR_CODE, STORY_COVER_LIMITS } from "@rowcat/contracts";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors.ts";
import { normalizeImage } from "./image.ts";
import {
	AVATAR_POLICY,
	type MediaPolicy,
	STORY_COVER_POLICY,
} from "./policy.ts";

/**
 * Animated covers (GIF), tested without a database. Split from `image.test.ts` because this axis is
 * switched by one policy (`MediaPolicy.animation`); that file covers the still-image matrix and
 * where the two policies diverge, this one only checks that animation survives and that its budget
 * holds.
 *
 * Fixtures are hand-written because sharp can read animated GIF but not write it (this build's
 * libvips does not encode a raw stack as multiple pages), and a committed binary cannot be
 * re-checked. The generator writes GIF89a to spec but does not compress with LZW: with a minimum
 * code size of 7 every code is exactly 8 bits (byte-aligned) and CLEAR is re-emitted every 120
 * codes so the code table never grows to 9 bits. Only frame count and geometry need to be exact.
 */

/** Minimal animated GIF89a with exact frame count and geometry. */
function animatedGif(width: number, height: number, frames: number): Buffer {
	const out: number[] = [];
	const push = (...bytes: number[]) => out.push(...bytes);
	const u16 = (n: number) => push(n & 0xff, (n >> 8) & 0xff);

	push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"
	u16(width);
	u16(height);
	push(0x86, 0x00, 0x00); // global color table, 128 colors
	for (let i = 0; i < 128; i++)
		push((i * 2) & 0xff, (255 - i * 2) & 0xff, (i * 3) & 0xff);
	// NETSCAPE2.0: infinite loop; also the signal that tells the decoder there are several frames.
	push(
		0x21,
		0xff,
		0x0b,
		...Buffer.from("NETSCAPE2.0"),
		0x03,
		0x01,
		0x00,
		0x00,
		0x00,
	);

	for (let frame = 0; frame < frames; frame++) {
		push(0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00); // graphic control (delay 10)
		push(0x2c);
		u16(0);
		u16(0);
		u16(width);
		u16(height);
		push(0x00);
		push(0x07); // minimum code size 7, so every code is 8 bits

		const codes: number[] = [128]; // CLEAR
		let sinceClear = 0;
		for (let i = 0; i < width * height; i++) {
			if (sinceClear >= 120) {
				codes.push(128);
				sinceClear = 0;
			}
			codes.push((frame * 11 + i) % 128);
			sinceClear++;
		}
		codes.push(129); // END
		for (let i = 0; i < codes.length; i += 255) {
			const chunk = codes.slice(i, i + 255);
			push(chunk.length, ...chunk);
		}
		push(0x00);
	}
	push(0x3b);
	return Buffer.from(out);
}

/** Still PNG, for regression checks. */
const png = (width: number, height: number) =>
	sharp({
		create: { width, height, channels: 3, background: "#2a9d8f" },
	})
		.png()
		.toBuffer();

const expectRejected = async (
	input: Buffer,
	code: string,
	policy: MediaPolicy = STORY_COVER_POLICY,
): Promise<void> => {
	let thrown: unknown;
	try {
		await normalizeImage(input, policy);
	} catch (error) {
		thrown = error;
	}
	expect(thrown).toBeInstanceOf(ApiError);
	const error = thrown as ApiError;
	expect(error.status).toBe(400);
	expect(error.code).toBe(code);
};

/** Frame count of the result, re-read from the stored bytes. */
const framesOf = async (bytes: Buffer): Promise<number> =>
	(await sharp(bytes, { animated: true }).metadata()).pages ?? 1;

describe("animated cover — the motion survives", () => {
	// The most important assertion in this file: keeping only the first frame would defeat accepting
	// GIF, and silently turning a chosen animation into a still is a quiet loss.
	it("a six-frame GIF is stored as a six-frame WebP", async () => {
		const result = await normalizeImage(
			animatedGif(300, 400, 6),
			STORY_COVER_POLICY,
		);

		expect(result.mime).toBe("image/webp");
		expect(await framesOf(result.bytes)).toBe(6);
	});

	// The stored format is still one, so `story_cover.mime` stays a verified fact and the read path
	// does not branch per format.
	it("even animated, the stored format is WebP alone", async () => {
		const result = await normalizeImage(
			animatedGif(120, 160, 3),
			STORY_COVER_POLICY,
		);
		expect(result.mime).toBe("image/webp");
	});

	// The returned height must be one frame's height. libvips treats an animation as an image with
	// frames stacked vertically; using that directly would store metadata saying "300x2400 cover" and
	// break every 3:4 box computation.
	it("the geometry describes one frame, not the stack", async () => {
		const result = await normalizeImage(
			animatedGif(300, 400, 6),
			STORY_COVER_POLICY,
		);
		expect({ width: result.width, height: result.height }).toEqual({
			width: 300,
			height: 400,
		});
	});

	/** A single-frame GIF is identical to a still image and does not take the animation path. */
	it("a single-frame GIF is treated as a still image", async () => {
		const result = await normalizeImage(
			animatedGif(200, 300, 1),
			STORY_COVER_POLICY,
		);
		expect(await framesOf(result.bytes)).toBe(1);
		expect({ width: result.width, height: result.height }).toEqual({
			width: 200,
			height: 300,
		});
	});

	// Animated output fits a smaller box (frames multiply); checks that the cap really holds and that
	// the ratio is preserved.
	it("large frames shrink into the animated box with the aspect ratio kept", async () => {
		const result = await normalizeImage(
			animatedGif(900, 1200, 4),
			STORY_COVER_POLICY,
		);
		expect({ width: result.width, height: result.height }).toEqual({
			width: 600,
			height: 800,
		});
		expect(await framesOf(result.bytes)).toBe(4);
	});

	/** The cap is a ceiling, not a target: small GIFs are not enlarged. */
	it("a small GIF is not enlarged", async () => {
		const result = await normalizeImage(
			animatedGif(80, 100, 3),
			STORY_COVER_POLICY,
		);
		expect({ width: result.width, height: result.height }).toEqual({
			width: 80,
			height: 100,
		});
	});
});

describe("animated cover — budget", () => {
	// The frame cap must be exact at the boundary: off by one either rejects a user who followed the
	// limit or lets an over-limit file through.
	it("a frame count equal to the cap passes", async () => {
		const result = await normalizeImage(
			animatedGif(2, 2, STORY_COVER_LIMITS.maxFrames),
			STORY_COVER_POLICY,
		);
		expect(await framesOf(result.bytes)).toBe(STORY_COVER_LIMITS.maxFrames);
	});

	it("one frame over the cap is rejected", async () => {
		await expectRejected(
			animatedGif(2, 2, STORY_COVER_LIMITS.maxFrames + 1),
			STORY_COVER_ERROR_CODE.tooManyFrames,
		);
	});

	// The total pixel budget is checked with a small policy: a fixture over the real cap (40M) costs
	// hundreds of MB to build, and the point is that the branch holds, not the number.
	it("there is a pixel budget across all frames combined", async () => {
		const animation = STORY_COVER_POLICY.animation;
		if (!animation) throw new Error("the cover policy must have animation on");
		const strict: MediaPolicy = {
			...STORY_COVER_POLICY,
			animation: { ...animation, maxPixels: 1_000 },
		};
		// 40x50x6 = 12,000 pixels: frame count is within the cap but the total is over.
		await expectRejected(
			animatedGif(40, 50, 6),
			STORY_COVER_ERROR_CODE.tooManyFrames,
			strict,
		);
	});

	// Must differ from the resolution-overrun code because the user's fix differs: someone who only
	// lowered resolution after "reduce the size" would get the same rejection again.
	it("a frame overrun is a different code from a resolution overrun", () => {
		expect(STORY_COVER_ERROR_CODE.tooManyFrames).not.toBe(
			STORY_COVER_ERROR_CODE.dimensionsTooLarge,
		);
	});
});

describe("animated cover — the body limit differs per format", () => {
	// The reason this slice was requested: GIF holds a full palette image per frame, so the same scene
	// is tens of times the bytes of a JPEG. Binding it to the still-image cap would block many real
	// GIFs, so bytes are loosened and pixels are locked.
	it("a GIF larger than the still limit passes too", async () => {
		const padded = Buffer.concat([
			animatedGif(40, 50, 3),
			// Bytes after the GIF trailer (0x3b) are ignored by the decoder; this only grows the size.
			Buffer.alloc(STORY_COVER_LIMITS.maxBytes + 1024),
		]);
		expect(padded.length).toBeGreaterThan(STORY_COVER_LIMITS.maxBytes);

		const result = await normalizeImage(padded, STORY_COVER_POLICY);
		expect(await framesOf(result.bytes)).toBe(3);
	});

	it("over the animated limit is rejected", async () => {
		const tooBig = Buffer.concat([
			animatedGif(2, 2, 2),
			Buffer.alloc(STORY_COVER_LIMITS.maxAnimatedBytes + 1024),
		]);
		await expectRejected(tooBig, STORY_COVER_ERROR_CODE.tooLarge);
	});

	/** The narrow still-image cap is unchanged: loosening GIF did not loosen everything. */
	it("the still-image limit stays 5MiB", async () => {
		const tooBig = Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			Buffer.alloc(STORY_COVER_LIMITS.maxBytes + 1024),
		]);
		await expectRejected(tooBig, STORY_COVER_ERROR_CODE.tooLarge);
	});
});

describe("animated cover — the policies split", () => {
	// Avatars do not accept GIF: sharing a pipeline must not make the two media kinds' product rules
	// equal (the premise of `policy.ts`, locked here). Silently folding to the first frame is also
	// avoided, since the user chose an animation and must be told it became a still.
	it("avatars reject GIF by format", async () => {
		let thrown: unknown;
		try {
			await normalizeImage(animatedGif(100, 100, 4), AVATAR_POLICY);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(ApiError);
		expect((thrown as ApiError).code).toBe(
			AVATAR_POLICY.errors.unsupportedType,
		);
	});

	/** Covers still accept still images as before; enabling animation changes nothing else. */
	it("the cover's still path did not change by a character", async () => {
		const result = await normalizeImage(
			await png(3000, 4000),
			STORY_COVER_POLICY,
		);
		expect({
			mime: result.mime,
			width: result.width,
			height: result.height,
		}).toEqual({ mime: "image/webp", width: 1200, height: 1600 });
	});

	// Animated WebP folds to the first frame, unlike GIF, based on user expectation: someone choosing
	// GIF expects motion, while someone choosing WebP often does not know it has several frames. It is
	// not rejected for the same reason (it looks like an ordinary WebP).
	it("an animated WebP is not rejected but folds to its first frame", async () => {
		const animated = await sharp(animatedGif(60, 80, 4), { animated: true })
			.webp()
			.toBuffer();
		expect(await framesOf(animated)).toBe(4);

		const result = await normalizeImage(animated, STORY_COVER_POLICY);
		expect(await framesOf(result.bytes)).toBe(1);
	});
});
