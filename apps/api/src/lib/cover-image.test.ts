import { STORY_COVER_ERROR_CODE, STORY_COVER_LIMITS } from "@rowcat/contracts";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeCoverImage } from "./cover-image.ts";
import { ApiError } from "./errors.ts";

/**
 * Cover normalization boundary, tested without a database. Most api tests use real Postgres and
 * skip without it; `normalizeCoverImage` is only "bytes in, bytes we store out", with no ownership,
 * transactions or HTTP, so it always runs, even where a skipping net would not guard the rule most
 * likely to be wrong.
 *
 * Fixtures are built by sharp at test time, not committed: a committed binary cannot be re-checked
 * (which encoder, which options) or read in review.
 *
 * Not covered here: ownership, `story_cover` rows, `coverUrl` assembly and `Cache-Control`
 * (`services/story/cover.ts`, `routes/stories/cover.ts`; those need a real DB).
 */

/** Deterministic pattern; a fixture that cannot be reproduced by hand from a failed CI explains nothing. */
const pattern = (width: number, height: number) => {
	const bytes = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y += 1)
		for (let x = 0; x < width; x += 1) {
			const at = (y * width + x) * 3;
			bytes[at] = (x * 7 + y * 3) % 256;
			bytes[at + 1] = (x * 3 + y * 11) % 256;
			bytes[at + 2] = (x * 13 + y * 5) % 256;
		}
	return sharp(bytes, { raw: { width, height, channels: 3 } });
};

/** Flat color for large images only: a 6000x5000 pattern would build a 90MB buffer, and the pixel-limit check looks at size, not content. */
const flat = (width: number, height: number) =>
	sharp({
		create: {
			width,
			height,
			channels: 3,
			background: { r: 10, g: 120, b: 200 },
		},
	});

/** Checks one rejection fully: kind, status and code. */
const expectRejected = async (input: Buffer, code: string) => {
	const thrown = await normalizeCoverImage(input).then(
		() => null,
		(error: unknown) => error,
	);
	// Clients branch on `code`, not status, so a plain `Error` would defeat that branch entirely.
	expect(thrown).toBeInstanceOf(ApiError);
	const error = thrown as ApiError;
	expect(error.status).toBe(400);
	expect(error.code).toBe(code);
};

describe("accepted formats", () => {
	// If the input format leaked into the output, `story_cover.mime` would be a copied claim, shown
	// only as another format's bytes served with an `image/webp` header.
	it("accepts JPEG · PNG · WebP and always returns WebP", async () => {
		const inputs = [
			await pattern(300, 200).jpeg().toBuffer(),
			await pattern(300, 200).png().toBuffer(),
			await pattern(300, 200).webp().toBuffer(),
		];

		for (const input of inputs) {
			const cover = await normalizeCoverImage(input);
			// Written as a literal: asserting a constant against a constant guards nothing.
			expect(cover.mime).toBe("image/webp");
			// The bytes decide whether `mime` is true.
			expect((await sharp(cover.bytes).metadata()).format).toBe("webp");
			expect(cover.width).toBe(300);
			expect(cover.height).toBe(200);
		}
	});
});

describe("rejection", () => {
	// Passing an empty body to the decoder yields "could not read the image", which reads as a broken
	// file to someone who picked no file.
	it("an empty body is empty", async () => {
		await expectRejected(Buffer.alloc(0), STORY_COVER_ERROR_CODE.empty);
	});

	// Callers that skip the route's `bodyLimit` (tests, future entry points) would otherwise send an
	// oversized buffer to the decoder, failing only after reading all 5MB.
	//
	// The signature must be present for this axis to be checked, because format is judged before size
	// (intentional: telling a wrong-format file to "shrink" makes the user shrink and re-upload only
	// to then see "unsupported format"). A contentless buffer would stop at `unsupportedType` first
	// and verify nothing.
	it("over the body limit is tooLarge", async () => {
		await expectRejected(
			Buffer.concat([
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
				Buffer.alloc(STORY_COVER_LIMITS.maxBytes + 1),
			]),
			STORY_COVER_ERROR_CODE.tooLarge,
		);
	});

	// SVG is a document, not an image. If the signature check broke, librsvg's XML parser (external
	// entities, fonts, filters) would run on our server and the cover would still be created normally,
	// so nothing in the response would show it.
	it("an SVG document is unsupportedType", async () => {
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
			"utf8",
		);
		await expectRejected(svg, STORY_COVER_ERROR_CODE.unsupportedType);
	});

	// GIF is accepted now, to keep the motion. This used to be a rejection case because passing it
	// would store only the first frame and the creator would never learn why their cover is still; the
	// answer changed from folding to first frame to keeping the motion
	// (`lib/media/animated-image.test.ts` checks the frame count). This placeholder stays so the file
	// does not go silent about GIF.
	it("a GIF passes and is stored as webp", async () => {
		const result = await normalizeCoverImage(
			await flat(10, 10).gif().toBuffer(),
		);
		expect(result.mime).toBe("image/webp");
	});

	// Passing on the signature alone would let this file through: faking 8 bytes is easy and only the
	// decoder knows what follows.
	it("junk after a PNG signature is invalidImage", async () => {
		const fake = Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			Buffer.from("this is not a PNG, just bytes", "utf8"),
		]);
		await expectRejected(fake, STORY_COVER_ERROR_CODE.invalidImage);
	});

	// A file with an intact header and truncated data is the most common result of an interrupted
	// upload. If decoder warnings were not failures, a half-gray cover would be stored as an artwork
	// rather than an error.
	it("a truncated JPEG is invalidImage", async () => {
		const jpeg = await pattern(200, 200).jpeg().toBuffer();
		await expectRejected(
			jpeg.subarray(0, Math.floor(jpeg.length / 2)),
			STORY_COVER_ERROR_CODE.invalidImage,
		);
	});

	// Without a per-side cap, shapes like 10001x2 slip under the total pixel limit; such an image
	// draws as a one-line strip in the cover box, and unless rejected the creator is never told.
	it("a side over maxDimension is dimensionsTooLarge", async () => {
		await expectRejected(
			await flat(STORY_COVER_LIMITS.maxDimension + 1, 2)
				.png()
				.toBuffer(),
			STORY_COVER_ERROR_CODE.dimensionsTooLarge,
		);
	});

	// Pixel-axis rejection must use the same code as the side-length axis. A 400KB 6000x5000 PNG
	// cannot be stopped by file size (hence `maxPixels`), and both sides are under `maxDimension`, so
	// only this axis catches it.
	//
	// Checking the code is the point: `limitInputPixels` once also applied to the header probe, so
	// libvips threw inside `metadata()` and the exception passed through `.catch(() => null)` to
	// become `invalidImage`; someone uploading a 30-megapixel photo was told to check for a damaged
	// file when the fix was to shrink it. The real decode still carries the limit (a lying header is
	// cut there), so the fix does not reduce protection.
	it("an image over the total pixel budget is blocked with the resolution code", async () => {
		await expectRejected(
			await flat(6000, 5000).png().toBuffer(),
			STORY_COVER_ERROR_CODE.dimensionsTooLarge,
		);
	}, 30_000);
});

describe("size", () => {
	// If `fit: "inside"` broke, images would be cropped (content lost) or stretched (ratio broken);
	// both are unrecoverable losses with a success response.
	it("an image over the limit shrinks with its aspect ratio kept", async () => {
		const cover = await normalizeCoverImage(
			await flat(3000, 4000).jpeg().toBuffer(),
		);
		expect(cover.width).toBe(1200);
		expect(cover.height).toBe(1600);
	});

	// The cap is a ceiling, not a target: without `withoutEnlargement` a 100x100 icon would be
	// stretched to 1200x1200, growing the file with no quality gain and bandwidth every month.
	it("does not enlarge a small image", async () => {
		const cover = await normalizeCoverImage(
			await pattern(100, 100).png().toBuffer(),
		);
		expect(cover.width).toBe(100);
		expect(cover.height).toBe(100);
	});
});

describe("metadata", () => {
	// Surviving EXIF would carry capture location, device serial and software out with a publicly
	// published medium, invisibly and irreversibly.
	it("strips EXIF", async () => {
		// EXIF string tags are ASCII, so writing them in Hangul leaves no original text in the fixture.
		const copyright = "(c) 2026 RowCat Cover Fixture Photographer";
		const source = await pattern(80, 60)
			.withExif({
				IFD0: { Copyright: copyright, Software: "RowCat Cover Fixture" },
			})
			.jpeg()
			.toBuffer();
		// The fixture must really carry EXIF for this test to guard anything.
		expect((await sharp(source).metadata()).exif).toBeDefined();
		expect(source.includes(Buffer.from(copyright))).toBe(true);

		const cover = await normalizeCoverImage(source);
		expect((await sharp(cover.bytes).metadata()).exif).toBeUndefined();
		// Outlasts a parser answer of "no EXIF block": if the metadata parser changes or the data moves
		// to another chunk, original strings left in the bytes mean it leaked.
		expect(cover.bytes.includes(Buffer.from(copyright))).toBe(false);
	});

	// If the orientation tag is not baked into pixels, the cover lies sideways in the one screen that
	// ignores it, and only user reports find the defect.
	it("applies the EXIF orientation to the pixels", async () => {
		// orientation 6: the image must be viewed rotated 90 degrees clockwise.
		const source = await pattern(40, 20)
			.withMetadata({ orientation: 6 })
			.jpeg()
			.toBuffer();

		const cover = await normalizeCoverImage(source);
		expect(cover.width).toBe(20);
		expect(cover.height).toBe(40);
		expect((await sharp(cover.bytes).metadata()).orientation).toBeUndefined();
	});
});

describe("animation", () => {
	// Without `animated: false`, a 3-frame input decodes as one image of three frames stacked
	// vertically and is stored with no error: a cover three times as tall showing only its top third
	// in the 3:4 box.
	it("a multi-frame WebP becomes a single frame", async () => {
		const frames = [];
		for (const background of [
			{ r: 220, g: 40, b: 40 },
			{ r: 40, g: 220, b: 40 },
			{ r: 40, g: 40, b: 220 },
		])
			frames.push(
				await sharp({
					create: { width: 40, height: 20, channels: 3, background },
				})
					.png()
					.toBuffer(),
			);
		const animated = await sharp(frames, { join: { animated: true } })
			.webp()
			.toBuffer();
		// The fixture must really have several frames, or this test checks nothing.
		expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(
			3,
		);

		const cover = await normalizeCoverImage(animated);
		expect(cover.width).toBe(40);
		expect(cover.height).toBe(20);
		const out = await sharp(cover.bytes, { animated: true }).metadata();
		expect(out.pages ?? 1).toBe(1);
		expect(out.height).toBe(20);
	});
});

describe("determinism", () => {
	// The cache version is the sha256 of stored bytes (`story_cover.version`, a generated column). If
	// the same input encoded to different bytes each time, the version would change every time and
	// addresses marked `immutable` for a year would be invalidated for no reason, with only bandwidth
	// leaking.
	it("the same input gives the same bytes", async () => {
		const source = await pattern(300, 400).jpeg().toBuffer();
		const first = await normalizeCoverImage(source);
		const second = await normalizeCoverImage(source);
		expect(first.bytes.equals(second.bytes)).toBe(true);
	});
});
