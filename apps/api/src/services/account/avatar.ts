import type { AvatarDto } from "@rowcat/contracts";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { media, member } from "../../db/schema.ts";
import { notFound } from "../../lib/errors.ts";
import { normalizeImage } from "../../lib/media/image.ts";
import { AVATAR_POLICY } from "../../lib/media/policy.ts";
import {
	createMedia,
	imageDimensionsOf,
	MEDIA_COLUMNS,
	type MediaRecord,
	mediaUrl,
	purgeMedia,
} from "../media.ts";

/**
 * Profile avatar, the first consumer of the media pipeline. It owns only which media is a member's
 * avatar; validation, normalization and storage live in `lib/media/*` and `services/media.ts`.
 *
 * Replacement is not delete-then-upload, because a failure after deleting would cost the user a
 * working photo. The order is:
 *
 * 1. validate and normalize   failure changes nothing
 * 2. store new bytes         failure leaves the old avatar
 * 3. new media row           failure leaves the old avatar
 * 4. move the pointer        one UPDATE, so partial success is inexpressible
 * 5. clean up the old media  failure is invisible to the user
 *
 * Step 4 locks the member row with `FOR UPDATE`. Without it two concurrent uploads by the same
 * person both read the same old pointer and both purge the old media, leaving the loser's new media
 * unreferenced and never cleaned up. With the lock the second request reads the first's new pointer
 * and purges exactly what it displaces.
 */

/**
 * Media row to wire DTO, as an allowlist: a new column stays private until listed here, unlike
 * `const { storageKey, ...rest }`, which would leak it automatically.
 */
const toAvatarDto = (record: MediaRecord): AvatarDto => ({
	mediaId: record.id,
	url: mediaUrl(record.id),
	...imageDimensionsOf(record),
});

/**
 * Uploads or replaces the avatar. The target comes only from the session, so a request that changes
 * someone else's avatar is inexpressible. It takes raw bytes, never a file name or a client-claimed
 * `Content-Type`; the bytes decide what was uploaded.
 */
export async function setAvatar(
	memberId: string,
	rawBytes: Buffer,
): Promise<AvatarDto> {
	/**
	 * Step 1 finishes before touching storage or the DB, so every failure (all 400) leaves the avatar
	 * untouched. It stays outside the transaction because decode, resize and re-encode take hundreds
	 * of milliseconds and would hold a scarce pool connection (covers decided the same).
	 */
	const image = await normalizeImage(rawBytes, AVATAR_POLICY);

	/** Steps 2-3. Still invisible to everyone. */
	const created = await createMedia({
		ownerId: memberId,
		kind: "avatar",
		image,
	});

	let replaced: MediaRecord | null;
	try {
		/** Step 4: the only point where what the user sees changes. */
		replaced = await db.transaction(async (tx) => {
			/** The lock rules out a concurrent upload of the same member claiming the same old media. */
			const [current] = await tx
				.select({ avatarMediaId: member.avatar_media_id })
				.from(member)
				.where(eq(member.id, memberId))
				.for("update")
				.limit(1);
			/**
			 * The member vanished (deletion finished during normalization). Throwing makes the `catch` purge
			 * the new media; without this check the UPDATE would match 0 rows and succeed silently.
			 */
			if (!current) throw notFound("Member not found.");

			const previousId = current.avatarMediaId;

			await tx
				.update(member)
				.set({ avatar_media_id: created.id })
				.where(eq(member.id, memberId));

			if (!previousId) return null;

			/**
			 * Read the displaced media inside the same transaction; after commit another request may have
			 * deleted it already. The owner predicate guards against broken data where this cleanup would
			 * delete someone else's bytes.
			 */
			const [previous] = await tx
				.select(MEDIA_COLUMNS)
				.from(media)
				.where(and(eq(media.id, previousId), eq(media.owner, memberId)))
				.limit(1);
			return previous ?? null;
		});
	} catch (error) {
		/**
		 * The pointer did not move, so the new media is unreferenced: purge it and rethrow. If the purge
		 * fails the row stays findable by `findOrphanedAvatarMedia`; the old avatar is intact.
		 */
		await purgeMedia(created);
		throw error;
	}

	/**
	 * Step 5, after commit. Deleting inside the transaction would leave a rolled-back pointer at bytes
	 * that are already gone (a broken avatar). Failures are swallowed: leftover bytes are harmless,
	 * and reporting an error would show a failure message beside the new avatar.
	 */
	if (replaced) await purgeMedia(replaced);

	return toAvatarDto(created);
}

/**
 * Removes the avatar; idempotent (`{ avatar: null }` when none exists), since a retry that only
 * lost its response must not look like an error. The gate is `requireViewer` because removing is a
 * withdrawal, so a sanctioned member must be able to take down the photo that caused it (same axis
 * as cover deletion under a `story.publish` restriction).
 */
export async function removeAvatar(memberId: string): Promise<void> {
	const detached = await db.transaction(async (tx) => {
		const [current] = await tx
			.select({ avatarMediaId: member.avatar_media_id })
			.from(member)
			.where(eq(member.id, memberId))
			.for("update")
			.limit(1);
		if (!current) throw notFound("Member not found.");
		if (!current.avatarMediaId) return null;

		/**
		 * Clear the pointer first. Relying on the FK's `set null` from deleting the media row leaves the
		 * pointer alive if the byte deletion fails, so the photo the user removed keeps showing.
		 */
		await tx
			.update(member)
			.set({ avatar_media_id: null })
			.where(eq(member.id, memberId));

		const [row] = await tx
			.select(MEDIA_COLUMNS)
			.from(media)
			.where(
				and(eq(media.id, current.avatarMediaId), eq(media.owner, memberId)),
			)
			.limit(1);
		return row ?? null;
	});

	/**
	 * Post-commit cleanup. A failure here leaves only an unreferenced row, which the orphan query
	 * finds; the state the user asked for (default avatar) is already true.
	 */
	if (detached) await purgeMedia(detached);
}
