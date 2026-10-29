import type { SceneImageAssetDto } from "@rowcat/contracts";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { media, story_media } from "../db/schema.ts";
import { normalizeImage } from "../lib/media/image.ts";
import { SCENE_IMAGE_POLICY } from "../lib/media/policy.ts";
import { createMedia, imageDimensionsOf, mediaUrl } from "./media.ts";
import type { Tx } from "./story/index.ts";

/**
 * Scene image assets: uploading, deciding whether a publish request's references can be trusted,
 * and keeping published references in `story_media`.
 *
 * Unlike avatars there is no server-side pointer: references live in device drafts and in published
 * playback snapshots, so there is no replace, no old-asset cleanup and no pointer-locking
 * transaction.
 *
 * - `createSceneImageAsset`: bytes -> validate/normalize -> one media row.
 * - `findUnusableSceneImages`: is each reference this creator's scene image.
 * - `syncStorySceneImageReferences`: reconcile published references with `story_media` in the
 *   same transaction as the payload commit, so account deletion can ask "is this still needed"
 *   without parsing JSON (`db/tables/story-media.ts`).
 *
 * No delete: an image removed from a draft may remain in a published snapshot, and rooms built from
 * it may be open on other people's devices right now. Removing it from a list is not erasing it
 * from the world. The cost is orphan media rows (orphan cleanup in `services/media.ts`); account
 * deletion takes them via the `media.owner` cascade.
 */

/**
 * Stores one scene image. Normalization runs before the DB (same order as covers and avatars), so a
 * broken file never creates a row.
 */
export async function createSceneImageAsset(
	ownerId: string,
	rawBytes: Buffer,
): Promise<SceneImageAssetDto> {
	const image = await normalizeImage(rawBytes, SCENE_IMAGE_POLICY);
	const created = await createMedia({
		ownerId,
		kind: "scene_image",
		image,
	});
	return {
		mediaId: created.id,
		url: mediaUrl(created.id),
		...imageDimensionsOf(created),
	};
}

/**
 * Whether every reference is a scene image owned by this member.
 *
 * The predicate pins `id ∈ …`, `owner` and `kind` together. Ownership is not read and compared
 * separately because that comparison eventually gets dropped; `kind` is there because without it an
 * avatar id could be published as a scene image.
 *
 * `status` is not checked because every media created today is `ready`; a future safety check that
 * creates `pending` would be added here (same axis as the read predicate rule in
 * `services/media.ts`).
 *
 * Returns the missing references; the route turns them into an error. No copy is made here, or the
 * next consumer would inherit it.
 */
export async function findUnusableSceneImages(
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
				eq(media.kind, "scene_image"),
			),
		);
	const owned = new Set(rows.map((row) => row.id));
	return wanted.filter((id) => !owned.has(id));
}

export const SCENE_IMAGE_ROLE = "scene_image";

/**
 * Reconciles a story's scene image references to exactly the currently published snapshot.
 *
 * It sets the final state rather than adding (`A, B` then `A, C` gives `A, C`). Adding only would
 * leave B forever "still in use" and account deletion would keep it, turning this table into a list
 * of every image ever used, i.e. the indefinite retention we decided against.
 *
 * The caller passes the transaction (no `db` default) because this sync must share the playback
 * payload commit's transaction; otherwise "new payload, old references" or the reverse becomes
 * representable. The type enforces it (`recordAudit` does the same).
 *
 * Whether each reference is this creator's scene image is not asked here; the publish boundary
 * already decided (`findUnusableSceneImages`) and a second implementation would drift.
 */
export async function syncStorySceneImageReferences(
	tx: Tx,
	storyId: string,
	assetIds: readonly string[],
): Promise<void> {
	const wanted = [...new Set(assetIds.filter(Boolean))];

	/**
	 * Remove dropped references first. `notInArray` does not hold on an empty array, so that case
	 * deletes the whole role, which is exactly an update with no images.
	 */
	await tx
		.delete(story_media)
		.where(
			wanted.length
				? and(
						eq(story_media.story_id, storyId),
						eq(story_media.role, SCENE_IMAGE_ROLE),
						notInArray(story_media.media_id, wanted),
					)
				: and(
						eq(story_media.story_id, storyId),
						eq(story_media.role, SCENE_IMAGE_ROLE),
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
				role: SCENE_IMAGE_ROLE,
			})),
		)
		.onConflictDoNothing();
}

/**
 * Ids of this member's media that a still-live story points at. Account deletion calls it.
 *
 * It joins `story_media` directly and does not open `play_payload`: that parsing in the deletion
 * path would silently return an empty list when the playback contract changes.
 *
 * It does not ask which story points at it (one remaining reference preserves the media), and it
 * does not filter by role even though `story_media` now has two (`scene_image`, `runtime_asset`).
 * The question is "does anyone still use this media", not "as what", so runtime images get the same
 * retention automatically; naming roles in the predicate would let a forgotten new value cost a
 * buyer their image.
 */
export async function mediaStillReferencedByStories(
	tx: Tx,
	ownerId: string,
): Promise<string[]> {
	const rows = await tx
		.selectDistinct({ id: media.id })
		.from(media)
		.innerJoin(story_media, eq(story_media.media_id, media.id))
		.where(eq(media.owner, ownerId));
	return rows.map((row) => row.id);
}
