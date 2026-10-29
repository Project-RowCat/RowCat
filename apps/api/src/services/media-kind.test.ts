import { MEDIA_KIND } from "@rowcat/contracts";
import { describe, expect, test } from "vitest";
import type { ValidatedAudio } from "../lib/media/audio.ts";
import type { NormalizedImage } from "../lib/media/image.ts";
import { createMedia, MEDIA_MEDIUM } from "./media.ts";

/**
 * Media kind and payload pairing; what this file catches is compilation, not values.
 *
 * With `media.width`/`height` nullable (for audio), the schema no longer blocks this row:
 *
 * ```text
 * kind = runtime_audio · mime = image/webp · width = 640 · height = 480 · duration = null
 * ```
 *
 * It is dangerous because the publication predicate uses the kind as authorization
 * (`findUnusableRuntimeAudio` pins ownership, `kind` and `status = 'ready'` and never asks what the
 * bytes are). A row with a false kind would publish picture bytes as sound, visible only at
 * playback and silently. The defence is the one trusted write API and cannot be checked by runtime
 * assertions: the only value-level check is that the medium table is exhaustive, and the rest is
 * whether the probes below compile.
 */

/**
 * Never executed: the body is a test read by the type checker. A `@ts-expect-error` line passes
 * only if that line really is a compile error, so widening `CreateMediaInput`'s `kind` back to
 * `MediaKind` makes the directive unused and breaks type checking, which is how this file catches
 * the original defect.
 */
function mediaInputTypeProbes(image: NormalizedImage, audio: ValidatedAudio) {
	// @ts-expect-error audio kinds do not accept an image payload.
	createMedia({ ownerId: "m", kind: "runtime_audio", image });

	// @ts-expect-error image kinds do not accept an audio payload.
	createMedia({ ownerId: "m", kind: "runtime_image", audio });

	// @ts-expect-error avatars are images too, so no audio payload.
	createMedia({ ownerId: "m", kind: "avatar", audio });

	// @ts-expect-error a request carrying both is not expressible.
	createMedia({ ownerId: "m", kind: "runtime_image", image, audio });

	// Valid pairs still pass: narrowing must not block valid calls.
	createMedia({ ownerId: "m", kind: "runtime_image", image });
	createMedia({ ownerId: "m", kind: "runtime_audio", audio });
	createMedia({ ownerId: "m", kind: "avatar", image });
	createMedia({ ownerId: "m", kind: "scene_image", image });
	createMedia({ ownerId: "m", kind: "story_cover", image });
}

describe("media kinds ↔ payloads", () => {
	/**
	 * The probe is not called (it would touch storage and the DB). This only confirms the function
	 * still exists; the real test is the directives above.
	 */
	test("the type probe compiles", () => {
		expect(mediaInputTypeProbes).toBeTypeOf("function");
	});

	/**
	 * The medium table covers the vocabulary exactly. `satisfies Record<MediaKind, ...>` already
	 * breaks compilation when kinds grow; this assertion checks the other direction, a stale key left
	 * in the table after an old kind was removed.
	 */
	test("every kind has a medium", () => {
		expect(Object.keys(MEDIA_MEDIUM).sort()).toEqual([...MEDIA_KIND].sort());
	});

	// There is exactly one audio kind today; everything else is an image.
	test("the sound kind is a single runtime sound", () => {
		expect(
			Object.entries(MEDIA_MEDIUM)
				.filter(([, medium]) => medium === "audio")
				.map(([kind]) => kind),
		).toEqual(["runtime_audio"]);
	});
});
