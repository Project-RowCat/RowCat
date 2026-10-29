import { describe, expect, it } from "vitest";
import {
	MEDIA_ERROR_CODE,
	MEDIA_KIND,
	RUNTIME_AUDIO_INPUT_MIME,
	RUNTIME_AUDIO_LIMITS,
	RUNTIME_AUDIO_OUTPUT_MIME,
	RUNTIME_IMAGE_LIMITS,
	RuntimeAudioAssetDto,
	RuntimeImageAssetDto,
} from "./media.ts";
import {
	RUNTIME_MANAGED_ASSET_KINDS,
	StoryPublishRuntimeAsset,
} from "./story-runtime.ts";

/**
 * Media vocabulary. Adding a kind happens in the commit that adds the path creating that kind. This
 * file pins three things: the vocabulary is closed, the audio limit is a different axis from the
 * image limit, and the `kind` in the publish contract is optional. An old client's republish must
 * not be blocked.
 */

describe("media kinds", () => {
	it("the vocabulary has five values", () => {
		expect([...MEDIA_KIND]).toEqual([
			"avatar",
			"story_cover",
			"scene_image",
			"runtime_image",
			"runtime_audio",
		]);
	});

	/**
	 * In this slice, the security boundary is that audio does not reuse `runtime_image`. If one value
	 * carried both media types, a request publishing audio into an image slot (or an image into an
	 * audio slot) would pass the predicate.
	 */
	it("sound has its own kind", () => {
		expect(MEDIA_KIND).toContain("runtime_audio");
		expect(
			MEDIA_KIND.filter((kind) => kind.startsWith("runtime_")),
		).toHaveLength(2);
	});
});

describe("runtime audio caps", () => {
	/**
	 * Duration is a different axis from size. A file encoded at 8 kbps that runs for hours is small,
	 * and only the duration limit guards against it. If that field disappeared, that guard would
	 * disappear with it.
	 */
	it("bytes and duration stand together", () => {
		expect(RUNTIME_AUDIO_LIMITS.maxBytes).toBeGreaterThan(0);
		expect(RUNTIME_AUDIO_LIMITS.maxDurationMs).toBeGreaterThan(0);
	});

	/** Does not alias the image limit. The two media have different cost axes. */
	it("separate from the image caps", () => {
		expect(RUNTIME_AUDIO_LIMITS.maxBytes).not.toBe(
			RUNTIME_IMAGE_LIMITS.maxBytes,
		);
		expect(RUNTIME_AUDIO_LIMITS).not.toHaveProperty("maxPixels");
		expect(RUNTIME_IMAGE_LIMITS).not.toHaveProperty("maxDurationMs");
	});

	/**
	 * Input hints include aliases, but the stored-format list does not. Browsers attach inconsistent
	 * MIME types to `.m4a` files, so the accepted side must be wide. If the stored values were
	 * widened, the same container would be stored under different names on different devices.
	 */
	it("the input hint is wider than the stored format", () => {
		expect([...RUNTIME_AUDIO_OUTPUT_MIME]).toEqual(["audio/mpeg", "audio/mp4"]);
		for (const mime of RUNTIME_AUDIO_OUTPUT_MIME)
			expect(RUNTIME_AUDIO_INPUT_MIME).toContain(mime);
		expect(RUNTIME_AUDIO_INPUT_MIME.length).toBeGreaterThan(
			RUNTIME_AUDIO_OUTPUT_MIME.length,
		);
	});

	/**
	 * A too-long duration is a different code from a too-large file. The screen says different things
	 * for each.
	 */
	it("duration and size rejections differ", () => {
		expect(MEDIA_ERROR_CODE.audioTooLong).not.toBe(MEDIA_ERROR_CODE.tooLarge);
		expect(MEDIA_ERROR_CODE.invalidAudio).not.toBe(
			MEDIA_ERROR_CODE.invalidImage,
		);
	});
});

describe("upload responses", () => {
	/**
	 * Audio has a duration but no dimensions. That asymmetry is why this DTO exists, and why the image
	 * DTO is not reused.
	 */
	it("the sound DTO carries duration and no dimensions", () => {
		const parsed = RuntimeAudioAssetDto.parse({
			mediaId: "media-A",
			url: "https://api.example/v2/media/media-A",
			mime: "audio/mpeg",
			durationMs: 102_000,
			/** The contract silently drops keys it does not know, so response assembly cannot carry them. */
			width: 640,
		});
		expect(Object.keys(parsed).sort()).toEqual([
			"durationMs",
			"mediaId",
			"mime",
			"url",
		]);
	});

	it("a sound without duration is refused", () => {
		expect(
			RuntimeAudioAssetDto.safeParse({
				mediaId: "media-A",
				url: "u",
				mime: "audio/mpeg",
			}).success,
		).toBe(false);
	});

	/** Guards that the audio addition left the image DTO unchanged. */
	it("the image DTO is unchanged", () => {
		const parsed = RuntimeImageAssetDto.parse({
			mediaId: "media-A",
			url: "u",
			width: 640,
			height: 480,
			mime: "image/webp",
		});
		expect(Object.keys(parsed).sort()).toEqual([
			"height",
			"mediaId",
			"mime",
			"url",
			"width",
		]);
	});
});

describe("publication binding kinds", () => {
	it("the vocabulary has two values", () => {
		expect([...RUNTIME_MANAGED_ASSET_KINDS]).toEqual(["image", "audio"]);
	});

	/**
	 * This is the most expensive line in this file. If `kind` were required, clients that do not know
	 * this axis could not republish their own works. A missing `kind` is read as `image`. The release
	 * that lacked the axis had only image managed assets, so the absence is itself accurate.
	 */
	it("an old client's binding (no kind) passes", () => {
		const parsed = StoryPublishRuntimeAsset.parse({
			path: "characters/sena/smile",
			assetId: "media-A",
		});
		expect(parsed.kind).toBeUndefined();
	});

	it("sound states its kind", () => {
		expect(
			StoryPublishRuntimeAsset.parse({
				path: "audio/bgm/main",
				assetId: "media-B",
				kind: "audio",
			}).kind,
		).toBe("audio");
	});

	/**
	 * Kinds outside the vocabulary are rejected. Mapping an unknown value to an image would let
	 * something that is not an image slip in later.
	 */
	it("an unknown kind is refused", () => {
		expect(
			StoryPublishRuntimeAsset.safeParse({
				path: "a/b",
				assetId: "media-A",
				kind: "video",
			}).success,
		).toBe(false);
	});
});
