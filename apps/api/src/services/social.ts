import { SOCIAL_ERROR_CODE } from "@rowcat/contracts";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
	block,
	download_log,
	favorite,
	follow,
	member,
	story,
	story_view_log,
} from "../db/schema.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import {
	deleteSocialNotificationsFromActor,
	notificationSourceKey,
	notifySocialEvent,
} from "./notifications.ts";

/**
 * A connection or a transaction. Relationship writes must count and check existence in the same
 * transaction as the change; an optional argument would let a caller silently count outside it, a
 * mismatch that shows only under concurrent requests.
 */
type DbLike =
	| typeof db
	| Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/**
 * Sets the favorite state. It takes the desired state, not a toggle: a client that lost the
 * response and retries a toggle flips the heart back off.
 *
 * The counter update shares the transaction because a row inserted without the counter rising never
 * heals. The counter moves only when a row actually changed, so re-favoriting an already favorited
 * story does not raise the total.
 */
export async function setFavorite(
	storyId: string,
	memberId: string,
	favorited: boolean,
): Promise<{ favorited: boolean; favorites: number } | null> {
	return db.transaction(async (tx) => {
		const [target] = await tx
			.select({ favorites: story.favorites })
			.from(story)
			.where(eq(story.id, storyId))
			.limit(1);
		if (!target) return null;

		const changed = favorited
			? (
					await tx
						.insert(favorite)
						.values({ story_id: storyId, member_id: memberId })
						.onConflictDoNothing()
				).rowCount
			: (
					await tx
						.delete(favorite)
						.where(
							and(
								eq(favorite.story_id, storyId),
								eq(favorite.member_id, memberId),
							),
						)
				).rowCount;

		if (!changed) return { favorited, favorites: target.favorites };

		const [updated] = await tx
			.update(story)
			.set({
				// Add in the DB instead of ±1 on the read value so concurrent requests do not overwrite each
				// other's increments. greatest(...) keeps past counter drift from going negative.
				favorites: favorited
					? sql`${story.favorites} + 1`
					: sql`greatest(${story.favorites} - 1, 0)`,
			})
			.where(eq(story.id, storyId))
			.returning({ favorites: story.favorites });

		return { favorited, favorites: updated?.favorites ?? target.favorites };
	});
}

/** All story ids I favorited, to paint list-card hearts in one go, so no pagination. */
export async function listFavoriteIds(memberId: string): Promise<string[]> {
	const rows = await db
		.select({ id: favorite.story_id })
		.from(favorite)
		.where(eq(favorite.member_id, memberId));
	return rows.map((r) => r.id);
}

/**
 * A creator's follower count, a public aggregate.
 *
 * There is no denormalized counter: one count over `idx_follow_creator` is enough, and a column
 * would add drift to manage like favorites. The PK blocks duplicate follows, so each count is
 * exact.
 *
 * It accepts a transaction handle because follow and block count after changing, inside the same
 * transaction; counting outside mixes in other commits and returns a number that disagrees with the
 * operation just performed.
 */
export async function countFollowers(
	creatorId: string,
	tx: DbLike = db,
): Promise<number> {
	const [row] = await tx
		.select({ n: count() })
		.from(follow)
		.where(eq(follow.creator, creatorId));
	return row?.n ?? 0;
}

/**
 * Requires the target member to exist, folding absence into a 404.
 *
 * Without it a follow to a nonexistent id is an FK violation and a 500, counted as a server
 * incident though the client erred, with nothing in the body for the screen to branch on.
 *
 * A nonexistent id and a deleted id are the same 404, as with public profiles; splitting them would
 * make the response "this id existed" and let an erased identity be re-confirmed by id.
 */
async function requireMember(memberId: string, tx: DbLike): Promise<void> {
	const [row] = await tx
		.select({ id: member.id })
		.from(member)
		.where(eq(member.id, memberId))
		.limit(1);
	if (!row) throw notFound("Creator not found.", SOCIAL_ERROR_CODE.notFound);
}

/**
 * Sets the follow state; not a toggle, for the same reason as favorites.
 *
 * Three rejections stand here regardless of hidden buttons: the endpoint can be called directly,
 * and self-follow, an FK violation on a missing member and following someone I blocked must not be
 * representable.
 *
 * Everything is one transaction because of the final count: if existence check, block check, write
 * and aggregate were split, other commits would mix in and the response (which the screen treats as
 * authoritative) would disagree with the operation just performed.
 */
export async function setFollow(
	followerId: string,
	creatorId: string,
	following: boolean,
): Promise<{ following: boolean; followers: number }> {
	// Self-follow would mix one's own stories into the following feed and void its meaning.
	if (followerId === creatorId)
		throw badRequest(
			"You can't follow yourself.",
			SOCIAL_ERROR_CODE.selfFollow,
		);

	return db.transaction(async (tx) => {
		await requireMember(creatorId, tx);

		if (following) {
			/**
			 * A blocked creator cannot be followed again. This pairs with block severing the follow
			 * (`setBlock`); without it one follow right after blocking revives "blocked but following" and
			 * the blocked person's stories return to the following feed (the feed predicate also filters by
			 * block, but that is a second line of defence, not an invariant). Read inside the same
			 * transaction, or a concurrent block and follow could both pass.
			 */
			const [blockedRow] = await tx
				.select({ creator: block.creator })
				.from(block)
				.where(and(eq(block.blocker, followerId), eq(block.creator, creatorId)))
				.limit(1);
			if (blockedRow)
				throw badRequest(
					"You can't follow a creator you blocked. Unblock them and try again.",
					SOCIAL_ERROR_CODE.blockedTarget,
				);

			/**
			 * `.returning()` tells whether a row was actually inserted. The API is an idempotent
			 * desired-state call, so an already-following person resending is the normal path (retry,
			 * mashing, another tab); notifying without checking would add a line to the creator's inbox on
			 * every press.
			 */
			const [inserted] = await tx
				.insert(follow)
				.values({ follower: followerId, creator: creatorId })
				.onConflictDoNothing()
				.returning({ creator: follow.creator });

			/**
			 * Notify only when the relation was actually created. The key is per actor (`follow:<me>`), so
			 * unfollow then follow again leaves one line, moved to the top and unread again (`refresh`); a
			 * per-event key would let follow/unfollow cycling fill someone's inbox. Self-follow is blocked
			 * above, and a recipient who blocked me is folded by `notifySocialEvent`, whose check must run
			 * inside this transaction too.
			 */
			if (inserted)
				await notifySocialEvent(tx, {
					recipientId: creatorId,
					actorId: followerId,
					kind: "follow",
					sourceKey: notificationSourceKey.follow(followerId),
					refresh: true,
				});
		} else
			await tx
				.delete(follow)
				.where(
					and(eq(follow.follower, followerId), eq(follow.creator, creatorId)),
				);

		return { following, followers: await countFollowers(creatorId, tx) };
	});
}

export async function listFollowing(memberId: string): Promise<string[]> {
	const rows = await db
		.select({ id: follow.creator })
		.from(follow)
		.where(eq(follow.follower, memberId));
	return rows.map((r) => r.id);
}

/**
 * Sets the block state. Blocking also severs the follow, or the blocked person's stories would keep
 * showing in the following feed and blocking would be half-done.
 *
 * Doing both in one transaction is the point: split, "blocked but still following" can commit and
 * never heals. Leaving the unfollow to the screen (two requests) is worse, since the second can
 * fail.
 *
 * Unblocking does not restore the follow; that would mean keeping the relation the user removed.
 * Following again must be an explicit action.
 *
 * The follower total is returned because this operation changes it (by the severed follow). If the
 * response omitted it, a profile screen would guess whether I was following and apply ±1, and a
 * wrong guess drifts the number.
 */
export async function setBlock(
	blockerId: string,
	creatorId: string,
	blocked: boolean,
): Promise<{ blocked: boolean; followers: number }> {
	if (blockerId === creatorId)
		throw badRequest("You can't block yourself.", SOCIAL_ERROR_CODE.selfBlock);

	return db.transaction(async (tx) => {
		await requireMember(creatorId, tx);

		if (blocked) {
			await tx
				.insert(block)
				.values({ blocker: blockerId, creator: creatorId })
				.onConflictDoNothing();
			await tx
				.delete(follow)
				.where(
					and(eq(follow.follower, blockerId), eq(follow.creator, creatorId)),
				);
			/**
			 * Also sweep the social notifications this person already made for me, in the same transaction.
			 * Only blocking future ones would leave their follow and comment notices in the blocker's inbox
			 * and still counted unread. Moderation notifications are untouched (no actor), so blocking
			 * someone cannot erase notices about sanctions on my own account. Unblocking does not restore
			 * them, same rule as follows.
			 */
			await deleteSocialNotificationsFromActor(tx, blockerId, creatorId);
		} else
			await tx
				.delete(block)
				.where(and(eq(block.blocker, blockerId), eq(block.creator, creatorId)));

		return { blocked, followers: await countFollowers(creatorId, tx) };
	});
}

/**
 * Creators I blocked. Queried on every gallery request, so it is fetched as a list and put into the
 * predicate; a per-request join would add one more join to the dominant path.
 */
export async function listBlocked(memberId: string): Promise<string[]> {
	const rows = await db
		.select({ id: block.creator })
		.from(block)
		.where(eq(block.blocker, memberId));
	return rows.map((r) => r.id);
}

/** UTC date key (YYYY-MM-DD), the axis of the daily view dedupe. */
const utcDay = (): string => new Date().toISOString().slice(0, 10);

/**
 * Records one view. The (story, viewer, day) PK enforces once a day, so refreshes and bot repeats
 * cannot inflate the count. The owner's own views are not counted.
 *
 * Non-core aggregate, so failure does not throw: a detail screen failing to open over view
 * recording would cost far more.
 */
export async function recordView(
	storyId: string,
	viewerKey: string,
	ownerId: string | null,
	viewerId: string | null,
): Promise<void> {
	if (ownerId && viewerId && ownerId === viewerId) return;
	try {
		await db.transaction(async (tx) => {
			const inserted = await tx
				.insert(story_view_log)
				.values({ story_id: storyId, viewer: viewerKey, day: utcDay() })
				.onConflictDoNothing();
			if (!inserted.rowCount) return;
			await tx
				.update(story)
				.set({ views: sql`${story.views} + 1` })
				.where(eq(story.id, storyId));
		});
	} catch (err) {
		console.warn("[views] failed to record", err);
	}
}

/**
 * Records one download. Both the counter column and the log are written: the column feeds all-time
 * popularity and the log answers period windows (day/week/month); neither alone does both.
 */
export async function recordDownload(storyId: string): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.insert(download_log).values({ story_id: storyId });
		await tx
			.update(story)
			.set({ downloads: sql`${story.downloads} + 1` })
			.where(eq(story.id, storyId));
	});
}
