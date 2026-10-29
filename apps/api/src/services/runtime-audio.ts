import type { RuntimeAudioAssetDto } from "@rowcat/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { media } from "../db/schema.ts";
import { validateAudio } from "../lib/media/audio.ts";
import { createMedia, mediaUrl } from "./media.ts";

/**
 * Managed runtime audio: uploading, and deciding whether a publish request's references can be
 * trusted.
 *
 * - `createRuntimeAudioAsset`: bytes -> container check -> one media row.
 * - `findUnusableRuntimeAudio`: is each reference in a publish request this creator's runtime
 *   audio.
 *
 * Kept apart from `runtime-image.ts` because `kind` is the authorization. The predicate here
 * hardcodes the kind as a literal; the publish boundary picks which function to call from the
 * request's `kind`, so that branch never flows in as an argument. Otherwise a dropped argument
 * would let an image be published into a sound slot or vice versa, which compiles, passes tests and
 * shows no symptom (the asset just silently does nothing).
 *
 * `story_media.role` is not split: audio is also `runtime_asset`. That table answers "does the
 * story stand without this media", which has no medium in it. Splitting roles would make lifecycle
 * code walk both, and missing one would make a buyer's sound vanish. What it is drawn with is the
 * publication snapshot binding's answer.
 *
 * There is no delete: references are spread across drafts, other devices and published snapshots,
 * and the last may be running on someone else's device. Studio `Remove` only unbinds from one draft.
 */

/**
 * Stores one runtime audio file.
 *
 * Validation runs before the DB, so a broken file never creates a row. Unlike images the stored
 * bytes are the original (rationale in the `lib/media/audio.ts` header); `mime` is still true
 * because it is the value judged from the container, not the request's claim.
 *
 * There is no replace: swapping a sound is calling this again (a new media row) and pointing the
 * draft binding at the new identity. Overwriting existing bytes would change the sound of a
 * published work without republishing.
 */
export async function createRuntimeAudioAsset(
	ownerId: string,
	rawBytes: Buffer,
): Promise<RuntimeAudioAssetDto> {
	const audio = validateAudio(rawBytes);
	const created = await createMedia({
		ownerId,
		kind: "runtime_audio",
		audio,
	});
	return {
		mediaId: created.id,
		url: mediaUrl(created.id),
		mime: created.mime,
		/**
		 * The just-judged value is returned as-is; re-reading the row would force folding the nullable
		 * type here, making a "sound with no length" state expressible.
		 */
		durationMs: audio.durationMs,
	};
}

/**
 * Whether every reference is a runtime audio owned by this member and currently servable.
 *
 * The predicate pins `id ∈ …`, `owner`, `kind` and `status`. `kind` is a literal on purpose: as an
 * argument, an image call could pass through here and the answer to "can a sound be published as an
 * image" would depend on call-site diligence.
 *
 * `status` is checked because `pending` is where a future safety check will sit
 * (`db/tables/media.ts`). Without this line, a pending sound could be published while `GET
 * /v2/media/:id` serves only `ready` (404), leaving the work silent until republished. The read
 * predicate already checks it (`getReadableMedia`); publication must only commit what playback can
 * open.
 *
 * Returns the missing references; the publish boundary turns them into an error and no copy is made
 * here. The rejection copy likewise never names `pending` (missing, someone else's and
 * not-yet-publishable are one sentence).
 */
export async function findUnusableRuntimeAudio(
	ownerId: string,
	assetIds: readonly string[],
): Promise<string[]> {
	const wanted = [...new Set(assetIds.filter(Boolean))];
	if (wanted.length === 0) return [];
	const rows = await db
		.select({ id: media.id })
		.from(media)
		.where(
			and(
				inArray(media.id, wanted),
				eq(media.owner, ownerId),
				eq(media.kind, "runtime_audio"),
				eq(media.status, "ready"),
			),
		);
	const owned = new Set(rows.map((row) => row.id));
	return wanted.filter((id) => !owned.has(id));
}
