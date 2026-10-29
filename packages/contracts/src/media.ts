import { z } from "zod";

/**
 * Image media: the limits, vocabulary and failure reasons shared across domains.
 *
 * This file exists because of a second consumer. With only covers, the limits and error vocabulary
 * in `story-cover.ts` were correct there. Avatars run the same pipeline (signature, decode,
 * normalize), and that rule was about to exist in two copies. Duplicated rules diverge in a
 * predictable direction: one side loosens, and the looser side becomes the vulnerability.
 *
 * - Shared: accepted formats, the failure vocabulary, and the validation pipeline.
 * - Not shared: numeric limits, output sizes, gates, and ownership rules. Covers are 3:4 catalog
 *   images and avatars are 96px circles, so one limit would be wrong for one of them. Share the
 *   infrastructure, not the product rules.
 * - No image bytes (no `avatarBase64`, `dataUrl` or `bytes`, now or later). Bytes travel only
 *   through a dedicated binary endpoint, and JSON carries only addresses. Legacy rows held data
 *   URLs, and list responses that never used them still shipped several MB (see the header of
 *   `story-cover.ts`).
 * - No original file name or storage path. File names often contain personal names and local
 *   folder conventions. Storage keys are server-issued internal identities. If a client could name
 *   a key, that would be a way to write into someone else's location.
 * - No arbitrary remote URLs (no `{ avatarUrl: 'https://…' }`). Such a field would make a photo
 *   the user never agreed to publish into their profile face, let an uncontrolled host see viewers'
 *   IPs, and become an SSRF surface once the server fetches it. Profile images come only from
 *   RowCat-validated, stored media.
 */

/**
 * Media kinds: a **closed vocabulary**. Each value carries a policy (limits, output size, ownership
 * rule). Adding values without a policy means knowing about media that cannot be validated. This is
 * the same rule as the moderation capability and the identity verifier. Adding a kind happens in
 * the same commit as the path that actually creates it.
 *
 * `story_cover` is here because that resource is the pipeline's second consumer. It does not mean
 * cover bytes moved into the `media` table. Covers remain in their own table, and what is shared is
 * the validation and normalization boundary. See the header of `apps/api/src/lib/media/policy.ts`.
 */
export const MEDIA_KIND = [
	"avatar",
	"story_cover",
	"scene_image",
	"runtime_image",
	/**
	 * A **sound** the creator runtime refers to by logical name. The entire reason this value exists
	 * is that it does not reuse `runtime_image`. In this pipeline the kind is authorization: the
	 * predicate in `findUnusableRuntimeImages` checks the three axes together.
	 *
	 * If one value carried both media, a request publishing audio into an image slot (or an image into
	 * a sound slot) would pass the predicate. That publish would succeed silently, and nothing would
	 * happen on the playback screen.
	 *
	 * It is not inferred from the MIME type either. How bytes parse and what purpose the media was
	 * uploaded for are different questions. Only the second answers whether this person chose to place
	 * it here.
	 */
	"runtime_audio",
] as const;
export const MediaKind = z.enum(MEDIA_KIND);
export type MediaKind = z.infer<typeof MediaKind>;

/**
 * File-picker hint. This is not a validation boundary. The `accept` attribute is only the dialog's
 * default filter. Users can pick 'all files' and upload anything, and the browser's Content-Type is
 * usually guessed from the extension. Real judgment is made by the server, which decodes the bytes
 * (`apps/api/src/lib/media/image.ts`).
 *
 * The list is short on purpose. A browser being able to draw a format is no reason to accept it.
 * GIF, AVIF, HEIC, BMP and TIFF are not needed for a profile photo.
 *
 * SVG is not in the list, and its absence is the most important fact about this constant. SVG is a
 * document rather than an image. It can carry scripts, external entities and remote fonts.
 * Accepting it safely requires a sanitization pipeline, which this repository does not have.
 * Building one for an avatar would make the least trustworthy input the first consumer of that
 * pipeline. This is the same call that rejected a Markdown renderer for comments.
 */
export const MEDIA_INPUT_MIME = [
	"image/jpeg",
	"image/png",
	"image/webp",
] as const;

export const MEDIA_ACCEPT = MEDIA_INPUT_MIME.join(",");

/**
 * Avatar upload limits. The server is the final authority. The screen only shows the same values in
 * advance. They are kept in one place to prevent copy drift. If the screen says `up to 2MB` and the
 * server rejects at 1MB, the user followed our guidance and still failed. The reverse would block
 * files that can be accepted.
 *
 * - maxBytes: request-body limit, enforced before the body is fully read (the route's bodyLimit).
 * - maxPixels: total decoded pixels. This is the axis that stops high-compression bomb images,
 *   which file size cannot express. A few hundred KB can expand to billions of pixels.
 * - maxDimension: limit per side. It blocks shapes such as 1x2,000,000,000 while still bounding
 *   total pixels.
 * - minDimension: rejects originals that are too small (see below).
 *
 * The limit is smaller than the cover's 5 MiB. Avatars are drawn as 96px circles, so originals
 * rarely need to be large. More importantly, this value is the memory one request can claim. Every
 * member uploads avatars, so a higher limit multiplies cost.
 *
 * Why there is a minimum size: avatars are cropped to a square on save, and covers are not.
 * Cropping a 16x2000 strip to a square leaves a 16x16 fragment, and scaling that to 96px produces a
 * smeared square. It is more honest to ask for a larger image than to report 'saved'.
 */
export const AVATAR_LIMITS = {
	maxBytes: 2 * 1024 * 1024,
	maxPixels: 24_000_000,
	maxDimension: 10_000,
	/**
	 * Images whose shorter side is below this are rejected, because nothing would remain to crop into
	 * a square.
	 */
	minDimension: 64,
} as const;

/**
 * The edge length of the avatar the server stores. This is an output, not a limit, so it is kept
 * out of `AVATAR_LIMITS`. That object answers 'what is accepted'. This value answers 'what
 * remains'. Mixing them would eventually let someone read `maxDimension` and this value on the same
 * axis.
 *
 * It is in the contract because there are now two consumers. The server normalization policy
 * (`AVATAR_POLICY.output`) uses it, and the crop screens in both apps derive their output edge from
 * it (`avatarCropOutputEdge` in `@rowcat/domain`). If they were separate copies, they would diverge
 * in a predictable direction. If a screen hard-coded 512 while the server moved to 1024, cropped
 * uploads would be upscaled and stored blurry. That difference shows up as lost quality rather than
 * as an error.
 *
 * 512 is justified in the policy file as a headroom multiple over the ~96px displayed size.
 */
export const AVATAR_STORED_EDGE = 512;

/**
 * Scene-image upload limits, placed between the cover and avatar limits. The numbers differ because
 * of where the image is drawn. Scene images sit inline in dialogue at body-text width, so they are
 * much larger than avatars. Unlike the catalog cover, they do not fill the detail screen.
 *
 * Most importantly, one work can have several of them. A cover is one per work, so 5 MiB is the
 * work's whole cost. Here the same limit could multiply up to 40 times.
 *
 * Animated input is not accepted. The cover accepts GIF because 'what the user picked is a moving
 * image'. Here the reasoning flips. The image sits in the middle of body text, and an image that
 * loops between paragraphs distracts rather than expresses. Avatars made the same call.
 */
export const SCENE_IMAGE_LIMITS = {
	maxBytes: 3 * 1024 * 1024,
	maxPixels: 24_000_000,
	maxDimension: 10_000,
	/** Not cropped, so there is no 'is anything left after cropping' question at all. */
	minDimension: null,
} as const;

/**
 * Limits for runtime images that the creator runtime refers to by logical name. The values match
 * scene images, yet the constant is not reused. Do not write an alias such as `RUNTIME_IMAGE_LIMITS
 * = SCENE_IMAGE_LIMITS`.
 *
 * The products differ. Scene images stand inside dialogue and interrupt the rhythm of reading.
 * Runtime images are part of a screen the creator built, and their placement varies (portraits,
 * backgrounds, icons). If the limits diverge later, an alias would make a change to one silently
 * change the other, and the diff would not show it. Starting from the same value with separate
 * names means that day's change touches one constant.
 *
 * Animated input is not accepted for a different reason than scene images. Here it is because both
 * renderers must draw the same thing. Animated WebP cannot be guaranteed to show the same frames
 * and scene in the web `<img>` and the native `Image`. The mismatch becomes visible only when the
 * creator puts the two devices side by side.
 */
export const RUNTIME_IMAGE_LIMITS = {
	maxBytes: 3 * 1024 * 1024,
	maxPixels: 24_000_000,
	maxDimension: 10_000,
	/** Not cropped, so there is no 'is anything left after cropping' question at all. */
	minDimension: null,
} as const;

/**
 * File-picker hint for sounds. This is not a validation boundary. It is short for the same reason
 * as the image list. A browser being able to play a format is no reason to accept it. Each added
 * format widens the server's container parser, which reads untrusted input.
 *
 * There are two formats because of two platforms. MP3 plays everywhere. M4A (AAC) is what Apple
 * devices produce by default, so a creator's file is usually one of those two. Browsers attach
 * inconsistent MIME types to `.m4a` files (`audio/x-m4a`, or an empty string), so aliases are
 * included in this hint list. But the stored formats are only the two that the container check
 * identifies.
 */
export const RUNTIME_AUDIO_INPUT_MIME = [
	"audio/mpeg",
	"audio/mp4",
	"audio/x-m4a",
	"audio/m4a",
	"audio/aac",
] as const;

export const RUNTIME_AUDIO_ACCEPT = [
	...RUNTIME_AUDIO_INPUT_MIME,
	".mp3",
	".m4a",
].join(",");

/**
 * The format the server **stores** for sound. It is the result of container inspection, not a value
 * the request claimed. Aliases are deliberately absent. A file uploaded as `audio/x-m4a` is stored
 * as `audio/mp4`, so the same container is not served under different names on different devices.
 */
export const RUNTIME_AUDIO_OUTPUT_MIME = ["audio/mpeg", "audio/mp4"] as const;
export type RuntimeAudioMime = (typeof RUNTIME_AUDIO_OUTPUT_MIME)[number];

/**
 * Upload limits for runtime audio. **Does not reuse `RUNTIME_IMAGE_LIMITS`.** The axes are entirely
 * different. An image's cost is pixels, and a sound's cost is **duration**. There is nowhere to
 * apply a pixel limit to sound, and a duration limit means nothing for an image.
 *
 * - maxBytes: request-body limit, enforced before the body is fully read (the route's bodyLimit).
 * - maxDurationMs: duration as stated by the container. Bytes alone cannot guard against long
 *   audio. A file encoded at 8 kbps can run for hours and still be small.
 *
 * 10 MiB and 10 minutes sit at the upper end of what this slice offers (scene BGM, sound effects,
 * short lines). Widening is always possible. Narrowing would make already-uploaded assets
 * impossible to publish.
 *
 * No re-encoding. The verified original is stored as-is. Adding transcoding would turn this repo
 * into a media processing platform (ffmpeg binary, job queue, failure states). The only gain would
 * be unifying the format, and both formats already play on web and native, so that gain does not
 * exist.
 */
export const RUNTIME_AUDIO_LIMITS = {
	maxBytes: 10 * 1024 * 1024,
	maxDurationMs: 10 * 60 * 1000,
} as const;

/**
 * A stored avatar: **the address, and only the values the screen needs to lay itself out.**
 * `storageKey`, `ownerId`, `byteSize`, `status` and `createdAt` are deliberately absent. They
 * belong to storage implementation and internal lifecycle, so there is no reason to read them from
 * outside. If a storage key appeared in the response, a copy would exist on clients and go stale
 * the day storage changes. A test that counts the response's keys enforces this boundary.
 *
 * `mediaId` is for cache identity. Changing the avatar changes this value, and therefore the whole
 * `url`. Because the same address is never overwritten, browsers and CDNs have no way to keep
 * drawing an old image. The screen never uses it directly, but it feeds the render key and
 * diagnostics.
 */
export const AvatarDto = z.object({
	mediaId: z.string(),
	/**
	 * The address this avatar is fetched from. **The server builds it.** The screen must not keep its
	 * own copy of a rule such as `${base}/media/${id}`. That copy goes stale when deployment changes
	 * the path or origin, and the symptom is broken images across the whole profile. The screen's only
	 * job is to bind this string to `<img src>`.
	 */
	url: z.string(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
});
export type AvatarDto = z.infer<typeof AvatarDto>;

/**
 * Response to replacing or deleting an avatar: **the avatar after the change, or none.** `null` is
 * the authoritative representation of 'no avatar', so there is no separate `removed: true` flag.
 * That flag would state the same fact twice. A successful delete always returns `{ avatar: null }`,
 * so a client that retries after losing the response gets the same value. Idempotency shows in the
 * response shape itself.
 *
 * The response does not return the whole viewer (`ViewerDto`). `/me` is the hottest read, used by
 * SSR, the document head and the auth guard. If this write were tied to that shape, the avatar
 * field would be embedded in every route's HTML. Instead it returns only the slot this write
 * changed, so the screen can place it straight into the public profile cache (the same shape as bio
 * updates).
 */
export const AvatarResponse = z.object({ avatar: AvatarDto.nullable() });
export type AvatarResponse = z.infer<typeof AvatarResponse>;

/**
 * A just-saved scene image: **only the reference and the values needed to lay it out.** It has the
 * same shape as `AvatarDto` but is not reused. The two answer different questions: what my face is
 * now, versus which identity the just-uploaded image has. `AvatarDto` also rests on the property
 * 'one per member', so its lifetime differs from this list-backed resource.
 *
 * `url` is here for the **preview right after upload**. The draft stores only `mediaId`
 * (`ChatSeedSceneImageDto`), and the rule that builds a URL from that ID lives in the SDK. The
 * screen therefore does not restate it.
 */
export const SceneImageAssetDto = z.object({
	mediaId: z.string(),
	url: z.string(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
});
export type SceneImageAssetDto = z.infer<typeof SceneImageAssetDto>;

/**
 * Upload response: always exactly one asset. Failures come back as error codes, not in this shape.
 */
export const SceneImageUploadResponse = z.object({ asset: SceneImageAssetDto });
export type SceneImageUploadResponse = z.infer<typeof SceneImageUploadResponse>;

/**
 * A just-saved runtime image: **the reference, and the values the studio needs to list it.** It has
 * the same fields as `SceneImageAssetDto` but is not reused. The two answer different questions:
 * which image to attach to this dialogue line, versus which image this code project will refer to
 * by name.
 *
 * The lifetimes also differ. Once bound to a logical path, this resource outlives the trigger. A
 * scene image's reference disappears when its trigger does. Here the same media can be bound to
 * several logical names at once.
 *
 * `mime` is the one place this diverges. The studio's asset list shows the format beside each
 * thumbnail, because what normalization produced is a fact the creator actually sees. If the screen
 * guessed it from the extension, that line would go stale the day normalization changes the output
 * format.
 */
export const RuntimeImageAssetDto = z.object({
	mediaId: z.string(),
	/**
	 * The address this image is fetched from. **The server builds it.** The draft stores only
	 * `mediaId`, and the rule that builds the URL from it lives in the SDK (`media.url`). If the
	 * screen restated that rule, the copy would go stale when deployment moves the origin. The field
	 * is included only as a convenience for the **preview right after upload**.
	 */
	url: z.string(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	mime: z.string(),
});
export type RuntimeImageAssetDto = z.infer<typeof RuntimeImageAssetDto>;

/**
 * Upload response: always exactly one asset. Failures come back as error codes, not in this shape.
 */
export const RuntimeImageUploadResponse = z.object({
	asset: RuntimeImageAssetDto,
});
export type RuntimeImageUploadResponse = z.infer<
	typeof RuntimeImageUploadResponse
>;

/**
 * A just-saved runtime audio clip: **the reference, and the values the studio needs to list it.**
 * What separates it from `RuntimeImageAssetDto` is the nature of the media. It has no dimensions
 * and **has a duration**. Sound takes no layout space, so there is no value to know in advance for
 * layout. What the creator actually checks in the list is how long the track runs.
 *
 * The server supplies this instead of the screen measuring it with a player, because the server
 * already knows it. Upload validation read the container to determine the duration, and that
 * determination is the basis of the limit. Measuring it again on the client would compute the same
 * fact twice.
 *
 * `byteSize`, `storageKey`, `ownerId` and `status` are absent for the same reason as for images,
 * and the key-counting test enforces it.
 */
export const RuntimeAudioAssetDto = z.object({
	mediaId: z.string(),
	/**
	 * The address this sound is fetched from. **The server builds it.** The draft stores only
	 * `mediaId`, and the rule that builds the URL from it lives in the SDK (`media.url`). Same rule
	 * and same reason as for images.
	 */
	url: z.string(),
	mime: z.string(),
	/**
	 * Duration in milliseconds, as reported by the container. It is the basis of the limit and the
	 * fact the list displays.
	 */
	durationMs: z.number().int().positive(),
});
export type RuntimeAudioAssetDto = z.infer<typeof RuntimeAudioAssetDto>;

/**
 * Upload response: always exactly one asset. Failures come back as error codes, not in this shape.
 */
export const RuntimeAudioUploadResponse = z.object({
	asset: RuntimeAudioAssetDto,
});
export type RuntimeAudioUploadResponse = z.infer<
	typeof RuntimeAudioUploadResponse
>;

/**
 * Reasons a media upload is rejected. **Codes differ whenever the screen must do something
 * different.** That is why they are not collapsed. A file that is too large means the user must
 * pick a smaller one. A wrong format means the screen must say which formats are accepted. A
 * resolution that is too big means shrink it; too small means pick a larger one. Collapsing
 * everything into `Couldn't upload the image` makes the user re-upload the same file without knowing what to
 * fix.
 *
 * **Ownership and existence failures are not here.** A foreign media item and a nonexistent one get
 * the **same 404**, so the media path cannot serve as an existence oracle. The cover endpoint
 * already made this decision.
 *
 * Only storage failure (`storageFailed`) is a 5xx. Everything else is a 400 the user can fix. That
 * distinction decides whether the screen offers 'retry' or 'choose another file'. A retry button on
 * a failure that would recur identically is a lie.
 */
export const MEDIA_ERROR_CODE = {
	/** The body exceeded the limit. It is rejected before the body is fully read. */
	tooLarge: "media_too_large",
	/** The body is empty: no file was chosen, or the file has zero bytes. */
	empty: "media_empty",
	/** Not an accepted format (SVG, GIF, AVIF, HEIC and the like). */
	unsupportedType: "media_unsupported_type",
	/**
	 * The format is correct but the data does not decode: truncated, corrupted, or a plausible header
	 * only.
	 */
	invalidImage: "media_invalid_image",
	/** The decoded result hit `maxPixels`, `maxDimension` or `minDimension`. */
	invalidDimensions: "media_invalid_dimensions",
	/**
	 * The container cannot be read as audio: truncated, a plausible header only, or only the extension
	 * says audio. Kept apart from `invalidImage` because the screen must say different things. An
	 * image failure cannot say `Choose an MP3 or M4A file`, and the reverse holds too.
	 */
	invalidAudio: "media_invalid_audio",
	/**
	 * The container's stated duration exceeded `maxDurationMs`. This is a different axis from file
	 * size.
	 */
	audioTooLong: "media_audio_too_long",
	/**
	 * The bytes could not be stored. **This is the only 5xx.** It is the only failure the user cannot
	 * fix, and the one where retrying may actually help. So the screen offers a different action
	 * (retry). Vendor error text from storage is never shown to users. It leaks internal paths, bucket
	 * names and credential hints.
	 */
	storageFailed: "media_storage_failed",
} as const;
export type MediaErrorCode =
	(typeof MEDIA_ERROR_CODE)[keyof typeof MEDIA_ERROR_CODE];
