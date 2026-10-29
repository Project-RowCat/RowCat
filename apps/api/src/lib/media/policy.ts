import {
	AVATAR_LIMITS,
	AVATAR_STORED_EDGE,
	MEDIA_ERROR_CODE,
	type MediaKind,
	RUNTIME_IMAGE_LIMITS,
	SCENE_IMAGE_LIMITS,
	STORY_COVER_ERROR_CODE,
	STORY_COVER_LIMITS,
} from "@rowcat/contracts";

/**
 * Media policy: the boundary between what is shared and what is not.
 *
 * Avatars and covers carry the same risks (untrusted bytes, MIME spoofing, image bombs, EXIF
 * leakage), so there is one validation and normalization pipeline; with two copies only one would
 * loosen and become the vulnerability. Their product rules are opposite:
 *
 * ```text
 *              cover                         avatar
 * byte cap     5MiB (catalogue images)       2MiB (every member uploads)
 * output       within 1200x1600, ratio kept  exactly 512x512, square
 * crop         no                            yes (centre)
 * min size     none                          64px (something must remain to crop)
 * animation    accepted (GIF, up to 20MiB)   not accepted
 * error codes  story_cover_*                 media_*
 * ```
 *
 * So the policy is passed as an argument rather than splitting the pipeline: `normalizeImage`
 * follows one policy, and a media kind without a policy cannot exist.
 *
 * The policy owns the error vocabulary because covers already have a live wire contract: the web
 * branches on codes like `story_cover_too_large` (`features/create/cover-file.ts`), and renaming
 * them to `media_too_large` would drop every cover failure on deployed screens into the `default`
 * branch ("could not change the cover" instead of "file exceeds 5MB"). That regression is not a
 * compile error, only worse copy, so each consumer keeps its own contract.
 */

/** Reasons normalization can reject; each policy fills in its own code strings. */
export interface MediaErrorVocabulary {
	tooLarge: string;
	empty: string;
	unsupportedType: string;
	invalidImage: string;
	invalidDimensions: string;
}

/**
 * Output geometry: two shapes, and they are different product decisions. `inside` fits within the
 * box preserving ratio (cover); `cover` fills the box and crops the overflow (avatar). Avatars crop
 * because they are drawn inside a circular mask, and one predictable server-side crop beats screens
 * cropping differently. Covers do not crop because a screen fitting a 3:4 box with `object-cover`
 * differs from the server cutting to 3:4, which is irreversible.
 */
export type MediaFit = "inside" | "cover";

/**
 * Extra budget for media that accept animated input (GIF); `null` means not accepted at all. It is
 * one object because the axes must switch on and off together: a frame cap without a total pixel
 * budget lets a 300-frame 4K GIF through, and the reverse lets a million-frame 1x1 through. It is
 * separate from the still budget because the cost shape differs: a GIF holds a full palette image
 * per frame (so the byte cap is far more generous), while decoding multiplies pixels by frame count
 * in memory (hence a separate pixel budget). Bytes are loosened, pixels are locked.
 */
export interface MediaAnimationPolicy {
	/** Body cap for animated input; deliberately different from the still `maxBytes`. */
	maxBytes: number;
	/** Pixels across all frames; libvips treats an animation as one vertically stacked image. */
	maxPixels: number;
	maxFrames: number;
	/**
	 * Animated output box, smaller than the still one because frames multiply: a 60-frame 1200x1600
	 * WebP is several MB per card, and a gallery screen of two dozen such cards would not open. This
	 * size suffices for where covers are actually drawn (cards a few hundred px, the 3:4 detail box).
	 */
	output: { width: number; height: number };
	/** Code for exceeding the frame/pixel budget; must differ from the resolution-exceeded code. */
	tooManyFrames: string;
}

export interface MediaPolicy {
	kind: MediaKind;
	/**
	 * Name used in failure copy (`cover`, `profile photo`). Only the name is carried, not whole sentences,
	 * because the sentence skeleton is shared; diverging would make the two media's guidance go wrong
	 * in different ways for no gain. It has no particle attached: the particle depends on final
	 * consonants and the sentence templates only ever continue with the Korean topic particle.
	 */
	label: string;
	/** Request body cap; the route enforces the same value before reading the whole body. */
	maxBytes: number;
	/** Total decoded pixels; an axis file size cannot express (compression bombs). */
	maxPixels: number;
	/** Per-side cap; blocks shapes like 1x2,000,000,000 that still satisfy the pixel total. */
	maxDimension: number;
	/**
	 * Minimum of the shorter side; `null` skips the check. Only meaningful for cropping (`cover`): a
	 * 16x2000 strip cropped square leaves 16x16, and stretching that to 512px yields a smeared square.
	 * Asking for a larger image is more honest than reporting it saved.
	 */
	minDimension: number | null;
	output: {
		width: number;
		height: number;
		fit: MediaFit;
		quality: number;
	};
	/**
	 * Whether animated input is accepted; `null` rejects GIF as `unsupportedType`. Animated WebP folds
	 * to its first frame regardless of this axis (see the pipeline in `image.ts`): someone choosing
	 * GIF expects motion, while someone choosing WebP often does not know it has several frames.
	 */
	animation: MediaAnimationPolicy | null;
	errors: MediaErrorVocabulary;
}

/**
 * Avatar: square 512px WebP. 512 leaves headroom over the drawn size (about 96px): retina 2x/3x and
 * a later larger slot (profile header), while staying far smaller than the original. No responsive
 * variants are made; the only slot today is a circular thumbnail, so variants would only add
 * storage and invalidation (add them with the screen that needs them).
 */
export const AVATAR_POLICY: MediaPolicy = {
	kind: "avatar",
	label: "profile photo",
	maxBytes: AVATAR_LIMITS.maxBytes,
	maxPixels: AVATAR_LIMITS.maxPixels,
	maxDimension: AVATAR_LIMITS.maxDimension,
	minDimension: AVATAR_LIMITS.minDimension,
	/**
	 * The edge comes from the contract because there are two consumers: the size normalized here and
	 * the size the two apps' crop screens produce must derive from one value (see
	 * `AVATAR_STORED_EDGE`). A hand-written 512 would, the day it changes, upscale only cropped
	 * uploads, which shows up as quality and not as an error.
	 */
	output: {
		width: AVATAR_STORED_EDGE,
		height: AVATAR_STORED_EDGE,
		fit: "cover",
		quality: 82,
	},
	/**
	 * Avatars do not animate. The basis is where they are drawn: covers are a few catalogue images per
	 * screen, but avatars appear by the dozen in comment lists, notifications and profiles, where
	 * dozens of running animations hinder reading. A GIF is rejected as an unsupported format rather
	 * than quietly folded to its first frame, since the user chose a moving picture and must be told
	 * it would become still.
	 */
	animation: null,
	errors: {
		tooLarge: MEDIA_ERROR_CODE.tooLarge,
		empty: MEDIA_ERROR_CODE.empty,
		unsupportedType: MEDIA_ERROR_CODE.unsupportedType,
		invalidImage: MEDIA_ERROR_CODE.invalidImage,
		invalidDimensions: MEDIA_ERROR_CODE.invalidDimensions,
	},
};

/**
 * Story cover: within a 3:4 box, ratio preserved. Numbers and error vocabulary are unchanged from
 * before the shared pipeline; covers moved here to share the implementation, not to change
 * behaviour, which `routes/stories/cover.test.ts` passing unchanged confirms.
 */
export const STORY_COVER_POLICY: MediaPolicy = {
	kind: "story_cover",
	label: "cover",
	maxBytes: STORY_COVER_LIMITS.maxBytes,
	maxPixels: STORY_COVER_LIMITS.maxPixels,
	maxDimension: STORY_COVER_LIMITS.maxDimension,
	/** Covers are not cropped, so "is something left to crop" never arises. */
	minDimension: null,
	output: { width: 1200, height: 1600, fit: "inside", quality: 82 },
	/**
	 * Covers can animate; that is why GIF is accepted. Keeping only the first frame would defeat
	 * accepting GIF. The stored format is still one (WebP), which carries animation, so `mime` stays
	 * truthful and the test matrix stays single.
	 */
	animation: {
		maxBytes: STORY_COVER_LIMITS.maxAnimatedBytes,
		maxPixels: STORY_COVER_LIMITS.maxAnimatedPixels,
		maxFrames: STORY_COVER_LIMITS.maxFrames,
		output: { width: 600, height: 800 },
		tooManyFrames: STORY_COVER_ERROR_CODE.tooManyFrames,
	},
	errors: {
		tooLarge: STORY_COVER_ERROR_CODE.tooLarge,
		empty: STORY_COVER_ERROR_CODE.empty,
		unsupportedType: STORY_COVER_ERROR_CODE.unsupportedType,
		invalidImage: STORY_COVER_ERROR_CODE.invalidImage,
		/** For covers this code only means "too large", since there is no minimum. */
		invalidDimensions: STORY_COVER_ERROR_CODE.dimensionsTooLarge,
	},
};

/**
 * Scene image: within 1200x1200, ratio preserved. The box is lower than the cover's (1200x1600)
 * because of where it stands: the body width inside a conversation line is around 700px on desktop,
 * and a tall picture filling a screen would push the text being read out of view. It is not
 * cropped; the creator knows which part is the scene. The error vocabulary is `media_*` because
 * this resource has no live contract to preserve (covers had to keep `story_cover_*`).
 */
export const SCENE_IMAGE_POLICY: MediaPolicy = {
	kind: "scene_image",
	label: "scene image",
	maxBytes: SCENE_IMAGE_LIMITS.maxBytes,
	maxPixels: SCENE_IMAGE_LIMITS.maxPixels,
	maxDimension: SCENE_IMAGE_LIMITS.maxDimension,
	minDimension: SCENE_IMAGE_LIMITS.minDimension,
	output: { width: 1200, height: 1200, fit: "inside", quality: 82 },
	/**
	 * Does not animate because it stands in the middle of text being read. Covers represent the work
	 * on a card or detail header, but this picture sits between paragraphs inside the conversation's
	 * rhythm, where motion hinders reading (avatars made the same call).
	 */
	animation: null,
	errors: {
		tooLarge: MEDIA_ERROR_CODE.tooLarge,
		empty: MEDIA_ERROR_CODE.empty,
		unsupportedType: MEDIA_ERROR_CODE.unsupportedType,
		invalidImage: MEDIA_ERROR_CODE.invalidImage,
		invalidDimensions: MEDIA_ERROR_CODE.invalidDimensions,
	},
};

/**
 * Creator runtime image: within 1200x1200, ratio preserved. The numbers currently equal the scene
 * image's, yet the policy stays separate; an alias (`RUNTIME_IMAGE_POLICY = SCENE_IMAGE_POLICY`)
 * would make a commit changing one cap silently change two products. The media really differ: a
 * scene image stands alone at body width, while runtime images are parts of a creator-built screen
 * (portraits, backgrounds, icons, several at once). When that difference splits the numbers, the
 * change ends at this one constant.
 *
 * Not cropped, as with scene images: the creator knows which part is the picture. No minimum size
 * either, since a runtime image may be a 16x16 icon. The vocabulary is `media_*` because no
 * deployed screen branches on a live contract here.
 */
export const RUNTIME_IMAGE_POLICY: MediaPolicy = {
	kind: "runtime_image",
	label: "runtime image",
	maxBytes: RUNTIME_IMAGE_LIMITS.maxBytes,
	maxPixels: RUNTIME_IMAGE_LIMITS.maxPixels,
	maxDimension: RUNTIME_IMAGE_LIMITS.maxDimension,
	minDimension: RUNTIME_IMAGE_LIMITS.minDimension,
	output: { width: 1200, height: 1200, fit: "inside", quality: 82 },
	/**
	 * Does not animate because both renderers must draw the same thing. The cover's and scene image's
	 * reasons do not apply here: this picture is drawn by web `<img>` and native `Image` from the same
	 * patch bundle, and nothing guarantees both draw an animated WebP at the same frame; the mismatch
	 * would only show when the creator compares two devices, after publishing.
	 */
	animation: null,
	errors: {
		tooLarge: MEDIA_ERROR_CODE.tooLarge,
		empty: MEDIA_ERROR_CODE.empty,
		unsupportedType: MEDIA_ERROR_CODE.unsupportedType,
		invalidImage: MEDIA_ERROR_CODE.invalidImage,
		invalidDimensions: MEDIA_ERROR_CODE.invalidDimensions,
	},
};
