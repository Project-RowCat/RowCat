import type { RuntimeImageAssetDto } from "@rowcat/contracts";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { media, story_media } from "../db/schema.ts";
import { normalizeImage } from "../lib/media/image.ts";
import { RUNTIME_IMAGE_POLICY } from "../lib/media/policy.ts";
import { createMedia, imageDimensionsOf, mediaUrl } from "./media.ts";
import type { Tx } from "./story/index.ts";

/**
 * Managed runtime images: uploading, deciding whether a publish request's references can be
 * trusted, and keeping published references in `story_media`.
 *
 * - `createRuntimeImageAsset`: bytes -> validate/normalize -> one media row.
 * - `findUnusableRuntimeImages`: is each reference this creator's runtime image.
 * - `syncStoryRuntimeAssetReferences`: reconcile published references with `story_media`.
 *
 * Separate from scene images because `kind` is the authorization: the `findUnusable*` predicate
 * pins the kind, and if both kinds shared one function a dropped argument would let a scene image
 * id be published as a runtime asset (compiles, passes tests, no symptom). `role` is the same axis:
 * if both roles shared one sync function, a runtime publish could strip a scene image's references,
 * and account deletion would then erase buyers' images.
 *
 * No delete, one layer stronger than scene images: references live in this device's draft, in the
 * same draft synced elsewhere, and in the snapshot of an already-published work that may be running
 * on someone else's device. A creator removing it from their list is not erasing it from the world;
 * that needs publication dependencies, retention and account deletion to answer together. The cost
 * is orphan media rows (see orphan cleanup in `services/media.ts`); account deletion takes them via
 * the `media.owner` cascade, except what a published work still points at (`story_media` records
 * that).
 */

/**
 * Stores one runtime image.
 *
 * Normalization runs before the DB, same as covers, avatars and scene images, so a broken file
 * never creates a row.
 *
 * There is no replace: swapping an image is calling this again (a new media row) and pointing the
 * draft binding at the new identity. Overwriting existing bytes would change the screen of a
 * published work without republishing.
 */
export async function createRuntimeImageAsset(
	ownerId: string,
	rawBytes: Buffer,
): Promise<RuntimeImageAssetDto> {
	const image = await normalizeImage(rawBytes, RUNTIME_IMAGE_POLICY);
	const created = await createMedia({
		ownerId,
		kind: "runtime_image",
		image,
	});
	return {
		mediaId: created.id,
		url: mediaUrl(created.id),
		...imageDimensionsOf(created),
		mime: created.mime,
	};
}

/**
 * Whether every reference is a runtime image owned by this member and currently servable.
 *
 * The predicate pins `id ∈ …`, `owner`, `kind` and `status`. Ownership is not read and compared
 * separately because that comparison eventually gets dropped. `kind` is there because without it an
 * avatar, cover or scene image id could be published as a runtime asset: it renders, but it is a
 * photo the creator never chose to put there.
 *
 * `status` has the same reason as in `services/runtime-audio.ts`: publication commits only media
 * playback can open, since the read predicate checks `ready`.
 *
 * Returns the missing references; the publish boundary turns them into an error. No copy is made
 * here, or the next consumer would inherit HTTP vocabulary.
 */
export async function findUnusableRuntimeImages(
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
				eq(media.kind, "runtime_image"),
				eq(media.status, "ready"),
			),
		);
	const owned = new Set(rows.map((row) => row.id));
	return wanted.filter((id) => !owned.has(id));
}

/**
 * `story_media.role` for this slice. Kept distinct from the scene image role: sharing one name
 * would let a runtime publish drop scene image dependencies, a loss that stays silent until account
 * deletion.
 */
export const RUNTIME_ASSET_ROLE = "runtime_asset";

/**
 * Reconciles a story's runtime asset references to exactly the currently published snapshot.
 *
 * It sets the final state rather than adding (`A, B` then `A, C` gives `A, C`), same rule as
 * `syncStorySceneImageReferences`. Adding only would leave B forever "still in use" and account
 * deletion would keep it, turning this table into a list of every image ever used.
 *
 * The delete is narrowed by `role`; without it this would also remove the same story's scene image
 * references.
 *
 * The caller passes the transaction (no `db` default) because this sync must share the artifact
 * commit's transaction; otherwise "new artifact, old references" or the reverse becomes
 * representable.
 *
 * Whether each reference is this creator's runtime image is not asked here; the publish boundary
 * already decided (`findUnusableRuntimeImages`) and a second implementation would drift.
 *
 * One media bound to several logical names is still one dependency row, since the table answers
 * "does the story stand without this media" and not how often it is used.
 */
export async function syncStoryRuntimeAssetReferences(
	tx: Tx,
	storyId: string,
	assetIds: readonly string[],
): Promise<void> {
	const wanted = [...new Set(assetIds.filter(Boolean))];

	/**
	 * Remove dropped references first. `notInArray` does not hold on an empty array, so that case
	 * deletes the whole role, which is exactly an update with no assets or the runtime disabled.
	 */
	await tx
		.delete(story_media)
		.where(
			wanted.length
				? and(
						eq(story_media.story_id, storyId),
						eq(story_media.role, RUNTIME_ASSET_ROLE),
						notInArray(story_media.media_id, wanted),
					)
				: and(
						eq(story_media.story_id, storyId),
						eq(story_media.role, RUNTIME_ASSET_ROLE),
					),
		);

	if (!wanted.length) return;

	/** Existing pairs are left alone; the primary key is the idempotency authority. */
	await tx
		.insert(story_media)
		.values(
			wanted.map((mediaId) => ({
				story_id: storyId,
				media_id: mediaId,
				role: RUNTIME_ASSET_ROLE,
			})),
		)
		.onConflictDoNothing();
}
