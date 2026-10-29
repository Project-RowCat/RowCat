import { normalizeImage } from "./media/image.ts";
import { STORY_COVER_POLICY } from "./media/policy.ts";

/**
 * Cover normalization: passes the cover policy to the shared media pipeline (`lib/media/image.ts`).
 *
 * This is the one place that picks the cover policy; letting routes call `normalizeImage` directly
 * invites an avatar policy being passed there and covers being cropped to 512x512. Error codes
 * (`story_cover_*`) are unchanged because the web branches on them
 * (`features/create/cover-file.ts`); the policy carries the error vocabulary
 * (`lib/media/policy.ts`).
 */

export type { NormalizedImage as NormalizedCover } from "./media/image.ts";

/**
 * Turns uploaded bytes into a cover; every failure is a 400 `ApiError`.
 *
 * Runs before storage is touched, so a failed decode cannot erase an existing good cover.
 */
export const normalizeCoverImage = (input: Buffer) =>
	normalizeImage(input, STORY_COVER_POLICY);
