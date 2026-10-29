import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
	block,
	favorite,
	follow,
	guardian_consent,
	media,
	member,
	moderation_case,
	moderation_report,
	story,
	story_comment,
	story_view_log,
	sync_keyring,
	sync_pairing,
	sync_push_dedupe,
	sync_record,
	sync_state,
	user,
	verification,
} from "../../db/schema.ts";
import { purgeIdentityVerifications } from "../adult-verification.ts";
import { deleteCommentsByAuthor } from "../comments.ts";
import { purgeMediaBytes } from "../media.ts";
import { deleteNotificationsForRecipient } from "../notifications.ts";
import { mediaStillReferencedByStories } from "../scene-image.ts";

/**
 * Account deletion, the only irreversible operation in the repository. The policy (what stays and
 * what goes) lives in AGENTS.md `## Account deletion`; this file holds only what makes it
 * structurally unrepresentable to get wrong.
 *
 * - Identity is one argument, the verified auth account id from the session. No member id or
 *   email is accepted: a caller would eventually pass a client value and this would delete someone
 *   else's account. Only the `beforeDelete` hook in `auth/index.ts` may fill it.
 * - The auth `user` row is deleted inside the same transaction. Split, "data gone but account
 *   alive" becomes representable. The library's later delete is an idempotent no-op that still
 *   expires the session cookie. Password verification is not repeated here; a copy would loosen on
 *   one side eventually.
 * - This function must be the only caller. Per-caller table cleanup misses the next new table,
 *   and the miss surfaces as "said deleted, still there".
 */
/**
 * Counts only, never what was deleted. It goes into the audit log, so there is no slot for titles,
 * emails or nicknames; re-erecting the deleted account's profile in the log would not be deletion.
 */
export interface AccountDeletionSummary {
	/** The deleted member id; opaque on its own. */
	memberId: string;
	/** Public stories kept in the catalogue with identity detached. */
	anonymizedStories: number;
	/** Private, unlisted and archived stories deleted. */
	deletedStories: number;
	/**
	 * Media kept (identity detached) because a surviving story still points at it. Pairs with
	 * `deletedMedia`: together they say how many of this account's images survived because of a public
	 * story.
	 */
	preservedStoryMedia: number;
	/** Deleted sync ciphertext records. */
	deletedSyncRecords: number;
	/** Deleted comments, including those on other people's stories. */
	deletedComments: number;
	/** Deleted reports: those carrying private conversation evidence and those whose target vanished. */
	deletedReports: number;
	/** Reports kept with only the reporter identity detached; review of others' content continues. */
	anonymizedReports: number;
	/** Deleted notifications, only those this member received. */
	deletedNotifications: number;
	/**
	 * Deleted guardian consent records, in-progress and confirmed alike. The row holds the guardian's
	 * name, contact and verification reference; keeping a third party's personal data only exists for
	 * the child's account, so the basis dies with it.
	 */
	deletedGuardianConsents: number;
	/**
	 * Deleted identity-verification attempts, in-progress and finished. The row holds an opaque
	 * authority reference and a was-19-or-older boolean; no identity is stored, so nothing to
	 * anonymize or keep.
	 */
	deletedIdentityVerifications: number;
	/**
	 * Deleted uploaded media, rows and bytes. Counted because this is the only deletion that escapes
	 * the transaction (step 8): FK cascade removes rows but not bytes behind the storage port, and a
	 * failed cleanup leaves someone's photo in our storage, so audit must show it.
	 */
	deletedMedia: number;
}

/**
 * Deletes one auth account and all product data attached to it.
 *
 * The member row may not exist: members are created on the first request (`auth/viewer.ts`), so a
 * signup that never did anything has none. The auth account must still go, so this does not throw.
 */
export async function deleteAccountForUser(
	authUserId: string,
): Promise<AccountDeletionSummary> {
	/**
	 * The transaction returns the summary and the byte keys to purge. Byte deletion sits outside it
	 * (step 8) because an irreversible delete must not run inside a section that can roll back.
	 */
	const { summary, mediaToPurge } = await db.transaction(async (tx) => {
		const [account] = await tx
			.select({ memberId: member.id })
			.from(member)
			.where(eq(member.user_id, authUserId))
			.limit(1);
		const memberId = account?.memberId ?? null;

		let anonymizedStories = 0;
		let deletedStories = 0;
		let deletedSyncRecords = 0;
		let deletedComments = 0;
		let deletedReports = 0;
		let anonymizedReports = 0;
		let deletedNotifications = 0;
		let deletedGuardianConsents = 0;
		let deletedIdentityVerifications = 0;
		/** Keys of bytes to purge; collected inside the transaction, deleted after commit (step 8). */
		let mediaToPurge: { id: string; storageKey: string }[] = [];
		let preservedStoryMedia = 0;

		if (memberId) {
			/**
			 * 1. Detach identity from public stories, before deleting.
			 *
			 * Order is policy: deleting the member row cascades through `story.owner` to every remaining
			 * story, so what is kept must be detached first or the policy silently becomes "delete all".
			 *
			 * Written as an allowlist (`= 'public'`): a "delete only private" form would drop new visibility
			 * values on the keep side, leaving personal data in the catalogue. `unlisted` is therefore
			 * deleted: it is not in the catalogue, and keeping it would create an ownerless work opening
			 * only by address, a state the policy never described. `hidden` is ignored (a reversible
			 * operator axis; deleting for it would remove the thing to unhide). `origin_draft_id` is cleared
			 * too: it keys publish idempotency and an ownerless story has no draft to republish, so keeping
			 * it leaves a deleted person's device identifier in the catalogue.
			 */
			const anonymized = await tx
				.update(story)
				.set({ owner: null, origin_draft_id: null })
				.where(and(eq(story.owner, memberId), eq(story.visibility, "public")))
				.returning({ id: story.id });
			anonymizedStories = anonymized.length;

			/**
			 * 2. Delete the remaining stories (private, unlisted, archived).
			 *
			 * Explicit rather than cascade so the intent is visible (covers, logs and favorites go with
			 * them) and the count can reach the audit record.
			 */
			/**
			 * Collect the doomed stories' and their comments' ids first: after the delete the cascade takes
			 * those rows and there is no way to know what vanished. Moderation cases hold target ids, and a
			 * case for content that no longer exists would keep an evidence snapshot of the deleted person's
			 * writing.
			 */
			const doomedStories = await tx
				.select({ id: story.id })
				.from(story)
				.where(eq(story.owner, memberId));
			const doomedStoryIds = doomedStories.map((row) => row.id);
			const doomedComments = doomedStoryIds.length
				? await tx
						.select({ id: story_comment.id })
						.from(story_comment)
						.where(inArray(story_comment.story_id, doomedStoryIds))
				: [];

			const deleted = await tx
				.delete(story)
				.where(eq(story.owner, memberId))
				.returning({ id: story.id });
			deletedStories = deleted.length;

			/**
			 * 3. Comments the member wrote, including those on other people's stories.
			 *
			 * The FK cascade would remove them anyway; deleting explicitly shows the policy (stories stay,
			 * comments go) and yields the count. Others' comments on this member's own stories are not
			 * touched here: surviving ones went with the story in step 2, and comments on anonymized public
			 * stories stay because someone else wrote them.
			 */
			/**
			 * With replies this splits in two: a top-level comment with other people's replies becomes a
			 * tombstone (row stays, body and identity go), everything else is deleted. Deleting all would
			 * erase others' replies, and keeping would leave the leaver's text and name readable. Order and
			 * failure direction belong to `deleteCommentsByAuthor`; code that skipped it would hit the FK
			 * and roll back the whole transaction instead of silently deleting others' replies.
			 */
			const { deletedIds: deletedCommentIds, tombstonedIds } =
				await deleteCommentsByAuthor(tx, memberId);
			deletedComments = deletedCommentIds.length + tombstonedIds.length;

			/**
			 * 3-b. Moderation data, which splits three ways.
			 *
			 * Deleted (1): reports carrying private conversation evidence. An `ai_response` report's
			 * evidence is the reporter's own conversation, the only plaintext that left E2EE, so it must go
			 * with the account; anonymizing a conversation log still leaves their writing.
			 *
			 * Deleted (2): cases whose target vanished with the account (the member, the stories and
			 * comments deleted above). Such a case would only hold someone's evidence snapshot with nothing
			 * to read or enforce. Deleting the case cascades its reports and actions.
			 *
			 * Identity detached: reports about others' content, since the target still exists. `reporter` is
			 * `set null` so the member delete does it, but they are counted here so the audit shows what
			 * stays.
			 *
			 * Kept (identity detached): actions this member took as an operator; they are records about
			 * other people and `actor` is `set null`. Sanction records against this member (actions,
			 * restrictions, appeals) cascade away; with no re-signup restriction or dispute handling,
			 * retaining them would be habit, not a basis.
			 */
			const privateEvidenceReports = await tx
				.delete(moderation_report)
				.where(
					and(
						eq(moderation_report.reporter, memberId),
						eq(moderation_report.target_type, "ai_response"),
					),
				)
				.returning({ caseId: moderation_report.case_id });
			deletedReports += privateEvidenceReports.length;

			/**
			 * Also delete AI-response cases emptied by the above: they have no target id (the server holds
			 * no such conversation), one report per case, so a deleted report leaves a shell pointing
			 * nowhere.
			 */
			const emptyCaseIds = privateEvidenceReports.map((row) => row.caseId);
			if (emptyCaseIds.length)
				await tx
					.delete(moderation_case)
					.where(
						and(
							inArray(moderation_case.id, emptyCaseIds),
							sql`not exists (select 1 from ${moderation_report} r where r.case_id = ${moderation_case.id})`,
						),
					);

			const goneTargets: { type: string; ids: string[] }[] = [
				{ type: "member", ids: [memberId] },
				{ type: "story", ids: doomedStoryIds },
				{
					type: "comment",
					/**
					 * Tombstoned ids are included: as a report target that line is gone too (no body, no author),
					 * and a case for it would keep only someone's evidence snapshot.
					 */
					ids: [
						...deletedCommentIds,
						...tombstonedIds,
						...doomedComments.map((row) => row.id),
					],
				},
			];
			for (const { type, ids } of goneTargets) {
				if (!ids.length) continue;
				const removed = await tx
					.delete(moderation_case)
					.where(
						and(
							eq(moderation_case.target_type, type),
							inArray(moderation_case.target_id, ids),
						),
					)
					.returning({ id: moderation_case.id });
				if (!removed.length) continue;
				/**
				 * Reports cascaded with these cases are not counted: cascade returns no count and recounting
				 * before the delete scans the same range twice. The audit needs only the private-evidence
				 * count, taken above.
				 */
			}

			const survivingReports = await tx
				.select({ id: moderation_report.id })
				.from(moderation_report)
				.where(eq(moderation_report.reporter, memberId));
			anonymizedReports = survivingReports.length;

			/**
			 * 3-c. Received notifications, the member's private inbox.
			 *
			 * Deleted explicitly although the FK cascades, for visibility and the count. Notifications in
			 * other people's inboxes where this member is the actor stay: they record something that
			 * happened to someone else, and `actor` is `set null`, so only identity goes. No nickname
			 * snapshot exists, so there is no name to erase. Notifications are not audit records;
			 * enforcement audit lives on the action rows.
			 */
			deletedNotifications = await deleteNotificationsForRecipient(
				tx,
				memberId,
			);

			/**
			 * 3-d. Guardian consent: in-progress requests and confirmed consents, all deleted.
			 *
			 * Explicit although the FK cascades. The row holds the guardian's personal data (name, contact,
			 * verification reference), kept only on the child account's basis, which disappears with the
			 * account. Open links die here too: the token 404s on lookup, so a guardian approval arriving
			 * afterwards opens nothing, and consent attached to a nonexistent account is not representable.
			 * No minimal "who consented when" record is kept; a retention duty would arrive with the code
			 * that reads it.
			 */
			const purgedGuardian = await tx
				.delete(guardian_consent)
				.where(eq(guardian_consent.member_id, memberId))
				.returning({ id: guardian_consent.id });
			deletedGuardianConsents = purgedGuardian.length;

			/**
			 * 3-e. Identity-verification attempts, in-progress and finished, all deleted.
			 *
			 * Explicit although the FK cascades. The case that matters is an open attempt: left behind, a
			 * completion request arriving after deletion would find a row holding the authority's reference,
			 * and adult entitlement could land on a nonexistent account. Nothing identifying is kept (only
			 * "someone was 19+"), so, as with guardian consent, nothing is left for any code to read.
			 */
			deletedIdentityVerifications = await purgeIdentityVerifications(
				tx,
				memberId,
			);

			/**
			 * 4. View records on other people's stories.
			 *
			 * Easy to miss: no member FK, so cascade does not reach it, yet `viewer` holds `m:<member.id>`,
			 * a record of who viewed what and when. Rows for the member's own stories already went in step
			 * 2.
			 */
			await tx
				.delete(story_view_log)
				.where(eq(story_view_log.viewer, `m:${memberId}`));

			/**
			 * 5. Favorites: roll back the aggregate before deleting.
			 *
			 * `story.favorites` is a denormalized counter, not derived from the log, so deleting rows alone
			 * leaves others' totals inflated forever with no self-healing. Remaining rows all point at
			 * surviving stories (the member's own were cascaded in step 2).
			 */
			const favorited = await tx
				.select({ storyId: favorite.story_id })
				.from(favorite)
				.where(eq(favorite.member_id, memberId));
			if (favorited.length)
				await tx
					.update(story)
					.set({ favorites: sql`greatest(${story.favorites} - 1, 0)` })
					.where(
						inArray(
							story.id,
							favorited.map((row) => row.storyId),
						),
					);
			await tx.delete(favorite).where(eq(favorite.member_id, memberId));

			/**
			 * 6. Social relations, both directions. A follow where this member is follower and one where
			 *    they are creator are different columns; deleting one side leaves relations pointing at
			 *    nobody. Same for blocks: a block on a deleted creator has nothing left to hide.
			 */
			await tx
				.delete(follow)
				.where(or(eq(follow.follower, memberId), eq(follow.creator, memberId)));
			await tx
				.delete(block)
				.where(or(eq(block.blocker, memberId), eq(block.creator, memberId)));

			/**
			 * 7. Encrypted sync: ciphertext is user data too.
			 *
			 * "The server cannot read it" is no reason to keep it; those bytes are the person's
			 * conversations and manuscripts. Keyring, cursor and idempotency records go as well, so the
			 * whole namespace disappears and a later signup with the same login method cannot inherit old
			 * sync.
			 *
			 * The keyring goes first (`docs/sync/ARCHITECTURE.md` §29.4). One transaction has no partial
			 * failure, but the order is the rule: cryptographic destruction is destroying key material.
			 * Deleting ciphertext first and leaving the key would leave backed-up ciphertext decryptable;
			 * the reverse leaves unreadable bytes.
			 */
			await tx.delete(sync_keyring).where(eq(sync_keyring.owner, memberId));
			/**
			 * Close in-progress device pairings too. The relay holds key material, so it belongs with
			 * keyring destruction and must leave no window for a new device to take an open envelope.
			 */
			await tx.delete(sync_pairing).where(eq(sync_pairing.owner, memberId));
			await tx
				.delete(sync_push_dedupe)
				.where(eq(sync_push_dedupe.owner, memberId));
			await tx.delete(sync_state).where(eq(sync_state.owner, memberId));
			const purgedRecords = await tx
				.delete(sync_record)
				.where(eq(sync_record.owner, memberId))
				.returning({ id: sync_record.id });
			deletedSyncRecords = purgedRecords.length;

			/**
			 * 8. Uploaded media: cascade removes rows, we remove bytes.
			 *
			 * The only deletion that does not finish in one transaction. Bytes sit behind `MediaBlobStore`,
			 * which Postgres cannot see; the current adapter sharing the database is no reason to lean on
			 * the transaction (switching to S3 would silently break it and leave deleted people's photos in
			 * the bucket). So only keys are collected here and deletion runs after commit: byte deletion is
			 * irreversible, and a rollback after it would leave a live account without its photos.
			 */
			/**
			 * 8-a. Detach media a surviving story still points at.
			 *
			 * The hardest place to undo: public stories were kept in the catalogue, and if their scene
			 * images rode the cascade, people conversing in them would lose pictures silently (the room
			 * opens and text appears, only the image slot 404s). The basis is `story_media`, not
			 * `play_payload`; parsing the JSON would return an empty list the day the playback contract
			 * changes (`db/tables/story-media.ts`).
			 *
			 * The order is the point: stories to delete are already gone, and their reference rows cascaded
			 * with them, so every remaining reference belongs to a surviving story. The query therefore
			 * needs no "which story lives" condition, and an image shared by two stories where one was
			 * deleted comes out right. It does not filter by kind either; `kind = 'scene_image'` would drop
			 * covers silently the day they use this table.
			 */
			const preservedMediaIds = await mediaStillReferencedByStories(
				tx,
				memberId,
			);
			if (preservedMediaIds.length)
				await tx
					.update(media)
					.set({ owner: null, updated_at: new Date() })
					.where(inArray(media.id, preservedMediaIds));
			preservedStoryMedia = preservedMediaIds.length;

			/**
			 * Delete what remains. Rows detached above no longer match `owner = memberId`, so they stay out
			 * of this list and the cascade, and row and bytes survive together. The `restrict` on `media_id`
			 * is the safety net: a missed image makes the member delete fail loudly, which beats a surviving
			 * story losing its image silently.
			 */
			mediaToPurge = await tx
				.select({ id: media.id, storageKey: media.storage_key })
				.from(media)
				.where(eq(media.owner, memberId));

			await tx.delete(member).where(eq(member.id, memberId));
		}

		/**
		 * 9. Verification tokens left on the auth side. `verification` is Better Auth's and the only
		 *    table without an FK, so cascade misses it. It holds password-reset and account-deletion
		 *    tokens (value is the user id) and email verification tokens (identifier is the email); both
		 *    go so no personal identifier remains.
		 */
		const [authUser] = await tx
			.select({ email: user.email })
			.from(user)
			.where(eq(user.id, authUserId))
			.limit(1);
		await tx
			.delete(verification)
			.where(
				authUser
					? or(
							eq(verification.value, authUserId),
							eq(verification.identifier, authUser.email),
						)
					: eq(verification.value, authUserId),
			);

		/**
		 * 10. The auth account, last. This one delete cascades through FKs to sessions and login
		 *     methods (password hash, OAuth tokens), ending every device's session; there is no secondary
		 *     session store like Redis (`auth/index.ts`), so the session row is the whole session.
		 */
		await tx.delete(user).where(eq(user.id, authUserId));

		return {
			summary: {
				memberId: memberId ?? "",
				anonymizedStories,
				preservedStoryMedia,
				deletedStories,
				deletedSyncRecords,
				deletedComments,
				deletedReports,
				anonymizedReports,
				deletedNotifications,
				deletedGuardianConsents,
				deletedIdentityVerifications,
			},
			mediaToPurge,
		};
	});

	/**
	 * Delete the bytes after commit. The account is already gone, so a failure here does not fail the
	 * deletion: the leftover is unreferenced bytes, and reporting failure would show an error to a
	 * user whose account no longer exists. It is the only step that can fail silently, so the count
	 * goes into the summary for operations to notice.
	 */
	const deletedMedia = await purgeMediaBytes(mediaToPurge);
	return { ...summary, deletedMedia };
}
