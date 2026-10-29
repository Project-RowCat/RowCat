import sharp from "sharp";
import { ApiError } from "../errors.ts";
import type { MediaPolicy } from "./policy.ts";

/**
 * Validation and normalization boundary for images: untrusted bytes in, bytes in the form we
 * decided to store out. Ownership, DB, HTTP and storage are not here, so this runs without
 * Postgres. It was moved out of the cover-only `lib/cover-image.ts` when avatars became a second
 * consumer, with the policy as an argument; copying would have let the next vulnerability fix land
 * in only one copy.
 *
 * The format the request claims is not trusted (`Content-Type` is usually a browser guess from the
 * extension). The check has two stages:
 *
 * ```text
 * 1. magic bytes   is it one of the allowed signatures; otherwise the decoder never sees it
 * 2. real decode   can libvips actually read the bytes as an image
 * ```
 *
 * Stage 1 exists for attack surface, not speed: libvips also reads SVG through librsvg's XML parser
 * (external entities, fonts, filters), and the signature check keeps that parser from ever running
 * on our server. Stage 1 alone is not enough, since a file with only an 8-byte PNG header passes
 * it.
 *
 * Normalizing keeps `mime` a verified fact instead of a transcribed claim (stored formats would
 * otherwise equal the number of inputs). Re-encoding also applies EXIF orientation to pixels,
 * strips location and device metadata, and avoids keeping multi-MB originals. The metadata point
 * matters most for avatars: a just-taken phone photo carries GPS coordinates and a device serial,
 * and publishing those as a public profile image would disclose a location the user never agreed to
 * share.
 *
 * Output is WebP only because the consumers are our web and Expo apps; both render it, it keeps
 * alpha, and it is smaller than JPEG at the same quality. One format means one `mime` and one test
 * matrix.
 */

/** The single stored format; goes into the media row's `mime` as-is. */
export const MEDIA_OUTPUT_MIME = "image/webp";

/**
 * Magic bytes of the allowed formats; neither extension nor `Content-Type` is read. WebP needs two
 * checks: WAV and AVI also start with `RIFF`, so `WEBP` after 8 bytes must be confirmed.
 */
type SniffedFormat = "jpeg" | "png" | "webp" | "gif";

const SIGNATURES: readonly {
	format: SniffedFormat;
	test: (bytes: Buffer) => boolean;
}[] = [
	{
		format: "jpeg",
		test: (b) =>
			b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	},
	{
		format: "png",
		test: (b) =>
			b.length >= 8 &&
			b
				.subarray(0, 8)
				.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
	},
	{
		format: "webp",
		test: (b) =>
			b.length >= 12 &&
			b.subarray(0, 4).toString("latin1") === "RIFF" &&
			b.subarray(8, 12).toString("latin1") === "WEBP",
	},
	{
		/**
		 * Both versions are accepted. Whether it animates is answered by the decoder's frame count, not
		 * the header's version string, which only says "these bytes are GIF".
		 */
		format: "gif",
		test: (b) =>
			b.length >= 6 &&
			(b.subarray(0, 6).toString("latin1") === "GIF87a" ||
				b.subarray(0, 6).toString("latin1") === "GIF89a"),
	},
];

const sniff = (bytes: Buffer): SniffedFormat | null =>
	SIGNATURES.find((candidate) => candidate.test(bytes))?.format ?? null;

const SNIFFED_MIME: Readonly<Record<SniffedFormat, string>> = {
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
};

/**
 * The image MIME from magic bytes only, with no decode. Exported so the remote image proxy
 * (`lib/remote-image`) shares this signature table; with two tables only one would learn a new
 * format, surfacing as files that work in the proxy but not in upload. Later checks (dimensions,
 * frames, re-encode) belong to upload; the proxy serves original bytes.
 */
export function sniffImageMime(bytes: Buffer): string | null {
	const format = sniff(bytes);
	return format === null ? null : SNIFFED_MIME[format];
}

/**
 * Names the formats this policy accepts so failure copy is exact per policy; a fixed string would
 * tell an avatar user whose GIF was rejected that GIF is allowed.
 */
const acceptedLabel = (policy: MediaPolicy): string =>
	policy.animation ? "JPEG · PNG · WebP · GIF" : "JPEG · PNG · WebP";

/**
 * The annotation sits on the variable so TypeScript narrows code after a call as unreachable,
 * letting guards above stand in for `null` checks below.
 */
const reject: (code: string, message: string) => never = (code, message) => {
	throw new ApiError(400, code, message);
};

/** MB for user-facing copy; raw bytes are not meaningful to users. */
const megabytes = (bytes: number): number => Math.floor(bytes / (1024 * 1024));

/** Normalized image; storage and metadata use these values directly. */
export interface NormalizedImage {
	bytes: Buffer;
	/** Format actually encoded, not what the request claimed. */
	mime: string;
	width: number;
	height: number;
}

/**
 * Failures are all 400 `ApiError`. It finishes before touching storage, so a replacement that fails
 * to decode cannot delete the existing image; losing a good avatar to one broken file is
 * irreversible, and the ordering blocks it structurally.
 */
export async function normalizeImage(
	input: Buffer,
	policy: MediaPolicy,
): Promise<NormalizedImage> {
	if (input.length === 0)
		reject(policy.errors.empty, "Please choose an image file.");
	return withDecodeSlot(() => normalizeImageNow(input, policy));
}

/**
 * Caps concurrent decodes. The real cost is the sum of unpacked pixels, and one request may
 * legitimately use up to the policy cap (24M pixels, about 96MB), so without a concurrency cap one
 * member could multiply it. The rate limiter counts starts; this counts what is open now.
 */
const MAX_CONCURRENT_DECODES = 4;
let activeDecodes = 0;
const decodeWaiters: Array<() => void> = [];

async function withDecodeSlot<T>(work: () => Promise<T>): Promise<T> {
	if (activeDecodes >= MAX_CONCURRENT_DECODES)
		await new Promise<void>((resume) => decodeWaiters.push(resume));
	activeDecodes += 1;
	try {
		return await work();
	} finally {
		activeDecodes -= 1;
		decodeWaiters.shift()?.();
	}
}

async function normalizeImageNow(
	input: Buffer,
	policy: MediaPolicy,
): Promise<NormalizedImage> {
	// The route already capped the body before reading it. Checks here cover callers that skip that
	// middleware (tests, future entry points); being safe on its own defines this boundary.
	const sniffed = sniff(input);
	// Signature before size cap: otherwise someone uploading a 20MiB executable would be told the size
	// limit, shrink it, and only then learn the format is unsupported.
	if (!sniffed || (sniffed === "gif" && !policy.animation))
		reject(
			policy.errors.unsupportedType,
			`Only ${acceptedLabel(policy)} images can be used as a ${policy.label}.`,
		);

	/**
	 * The byte cap differs per format: a GIF carries a full palette image per frame, so holding it to
	 * the still-image cap would reject many real GIFs (`MediaAnimationPolicy` in `policy.ts`). The
	 * route's `bodyLimit` uses the larger of the two since the format is unknown before reading the
	 * body; the narrower promise is enforced here.
	 */
	const byteLimit =
		sniffed === "gif" && policy.animation
			? policy.animation.maxBytes
			: policy.maxBytes;
	if (input.length > byteLimit)
		reject(
			policy.errors.tooLarge,
			`A ${policy.label} can be up to ${megabytes(byteLimit)}MB.`,
		);

	/**
	 * Header-only probe, so the pixel limit is turned off here. With it on, libvips throws "Input
	 * image exceeds pixel limit" while reading the header, the catch below turns that into
	 * `invalidImage`, and someone uploading a 30M-pixel photo is told to check for corruption when the
	 * file is fine and they need to shrink it. It is safe to disable because this call does not unpack
	 * pixels (only raster headers, after the signature check, with the body already capped). The real
	 * decode below keeps the limit and catches files whose header lies.
	 */
	const meta = await sharp(input, { limitInputPixels: false })
		.metadata()
		.catch(() => null);
	if (!meta || !meta.format || !meta.width || !meta.height)
		reject(
			policy.errors.invalidImage,
			"Couldn't read the image. Please check that the file isn't damaged.",
		);

	// Signature and decoder must name the same format. This once only checked allowlist membership,
	// which let "PNG signature + WebP body" through; we cannot say what such a file is, and the byte
	// cap chosen above would be another format's.
	if (meta.format !== sniffed)
		reject(
			policy.errors.unsupportedType,
			`Only ${acceptedLabel(policy)} images can be used as a ${policy.label}.`,
		);

	// Oriented photos record width and height swapped, so limits use the product and the maximum of
	// the sides, which are rotation-invariant; otherwise one portrait photo would bypass the rule.
	if (
		meta.width > policy.maxDimension ||
		meta.height > policy.maxDimension ||
		meta.width * meta.height > policy.maxPixels
	)
		reject(
			policy.errors.invalidDimensions,
			"The image resolution is too large. Please make it smaller and upload again.",
		);

	/**
	 * Frame budget, applied only to animated input. `pages` is present in still-mode metadata, so the
	 * frame count is known and judged before unpacking; loading 4,000 frames into memory to reject
	 * them would defeat the purpose. Still-mode `width`/`height` are one frame's size, so total pixels
	 * is one multiplication. The code differs from the resolution rejection because the fix differs:
	 * shorten or thin frames, whereas lowering only the resolution would be rejected again.
	 */
	const frames = meta.pages ?? 1;
	if (policy.animation && frames > 1) {
		if (frames > policy.animation.maxFrames)
			reject(
				policy.animation.tooManyFrames,
				`A ${policy.label} can have up to ${policy.animation.maxFrames} frames. Please choose a shorter image.`,
			);
		if (meta.width * meta.height * frames > policy.animation.maxPixels)
			reject(
				policy.animation.tooManyFrames,
				`The animated ${policy.label} is too large. Lower the resolution or choose a shorter image.`,
			);
	}

	// The minimum uses the shorter side (also rotation-invariant): measured by the long side, a
	// 16x2000 strip would pass and crop to 16x16.
	if (
		policy.minDimension !== null &&
		Math.min(meta.width, meta.height) < policy.minDimension
	)
		reject(
			policy.errors.invalidDimensions,
			`A ${policy.label} must be at least ${policy.minDimension}px wide and tall. Please choose a larger image.`,
		);

	/**
	 * Whether to keep the motion: policy allows it, format is GIF, and there are several frames.
	 * Format is in the condition because animated WebP also has `pages > 1` but folds to its first
	 * frame: someone choosing GIF expects motion, while someone choosing WebP often does not know it
	 * has several frames. Folding instead of rejecting follows the same reasoning (it looks like an
	 * ordinary WebP, so a rejection would be unexplainable).
	 */
	const animate = Boolean(policy.animation) && sniffed === "gif" && frames > 1;

	/**
	 * Real decode: `limitInputPixels` here catches files whose header lies (the probe only proved the
	 * claimed size is within the cap). Animated input is capped by total pixel budget because libvips
	 * unpacks an animation as one image with frames stacked vertically, and that image's pixels are
	 * the memory we pay.
	 */
	const pipeline = sharp(input, {
		limitInputPixels:
			animate && policy.animation
				? policy.animation.maxPixels
				: policy.maxPixels,
		animated: animate,
	});

	// Animated output goes in a smaller box because frames multiply (`MediaAnimationPolicy.output`).
	const box =
		animate && policy.animation ? policy.animation.output : policy.output;

	let bytes: Buffer;
	try {
		// `.rotate()` only for still input. GIF has no EXIF orientation to apply, and on an animated
		// pipeline libvips could rotate the whole vertically stacked image, breaking frame boundaries.
		const oriented = animate ? pipeline : pipeline.rotate();
		bytes = await oriented
			.resize({
				width: box.width,
				height: box.height,
				fit: policy.output.fit,
				/**
				 * The limit is a ceiling, not a target: upscaling a 600px image to 1200px only grows the file.
				 * With `cover` this flag does nothing: sharp leaves a small original smaller than the box if it
				 * is combined with `cover`, and avatars already filter such input via `minDimension`, so it is
				 * always a downscale in practice. Enlargement must still happen when that minimum is below the
				 * output (64 < 512) to guarantee a square, and sharp ignores the flag under `cover`.
				 */
				withoutEnlargement: policy.output.fit === "inside",
				/** Where to keep when cropping; faces are usually centred. */
				position: "centre",
			})
			/**
			 * Sharp drops all metadata by default (GPS, device serial, capture software, embedded thumbnail,
			 * XMP, IPTC). The ICC profile is the one exception: it is colour-rendering information, not
			 * personal data, and dropping it makes wide-gamut photos look oversaturated.
			 */
			.keepIccProfile()
			.webp({ quality: policy.output.quality })
			.toBuffer();
	} catch {
		/**
		 * Decoder error text is not sent to the user: libvips messages carry internal paths and loader
		 * names, and the user's next step is the same for any failure. Original bytes are not logged
		 * either, since they are someone's photo.
		 */
		throw new ApiError(
			400,
			policy.errors.invalidImage,
			"Couldn't read the image. Please check that the file isn't damaged.",
		);
	}

	// Re-read the encoded size instead of recomputing from resize arguments, which would copy the
	// `inside`/`cover`/`withoutEnlargement` rules and diverge the day a limit changes.
	const out = await sharp(bytes).metadata();
	return {
		bytes,
		mime: MEDIA_OUTPUT_MIME,
		width: out.width ?? 0,
		/**
		 * For animated results this is one frame's height: libvips treats an animation as frames stacked
		 * vertically, so `height` is `pageHeight x pages`, and returning it would record a "600x48000
		 * cover" that breaks any 3:4 box calculation. The screen draws one frame's geometry.
		 */
		height: out.pageHeight ?? out.height ?? 0,
	};
}
