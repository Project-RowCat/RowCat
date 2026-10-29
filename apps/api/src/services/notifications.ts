import {
	type ModerationActionKind,
	NOTIFICATION_MAX_PAGE_SIZE,
	type NotificationDto,
	type NotificationKind,
	type NotificationsPage,
} from "@rowcat/contracts";
import {
	and,
	desc,
	eq,
	isNull,
	lt,
	or,
	type SQLWrapper,
	sql,
} from "drizzle-orm";
import { type Db, db } from "../db/client.ts";
import {
	block,
	follow,
	member,
	moderation_action,
	moderation_appeal,
	notification,
	story,
	story_comment,
} from "../db/schema.ts";
import { decodeTimelineCursor, encodeTimelineCursor } from "../lib/cursor.ts";
import { newId } from "../lib/id.ts";
import { avatarUrlOf, memberAvatarMediaId } from "./media.ts";
import { enqueuePushDeliveries } from "./push/enqueue.ts";

/**
 * In-app notification rules: writing to the ledger and reading it both live here.
 *
 * What this file does not do:
 *
 * - It does not decide anything. Whether to hide a story, block a member or accept an appeal is
 *   settled by the caller; only already-decided events arrive here. A notification helper able to
 *   change that decision would make enforcement authority two.
 * - It does not send anything outward (push, mail, webhooks, queues). The INSERTs here share the
 *   originating transaction's correctness boundary; external delivery is a separate problem after
 *   commit.
 * - It is not a generic event bus. There are seven wiring points (comment, follow, new public
 *   story, action, appeal, report closure, app-update notice); a dispatcher would hide which write
 *   produces which notification from grep.
 *
 * Social events pass one more gate: no notification when the recipient has blocked the actor
 * (`notifySocialEvent`). Filtering on screen is not enough, because the row must never enter the
 * inbox or count as unread. The multi-recipient path (`notifyFollowersOfSocialEvent`) applies the
 * same gates inside SQL using the same predicate fragment, so the two cannot diverge.
 */

/** The transaction handle callers pass in: exactly the type drizzle gives its callback. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * A connection or a transaction.
 *
 * No default and not optional: a notification write must run in the same transaction as the event
 * that caused it, or it silently commits outside and "comment rolled back, notification kept"
 * becomes representable.
 */
export type NotificationExecutor = Db | Tx;

/* ══════════════════════════════════════════════════════════════════════════
 * Writes
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Idempotency key shapes; this object is the only authority. Assembling the string at call sites
 * lets a typo become "a second row for the same event", invisible in review.
 *
 * Only follow is per actor, deliberately: per event, follow/unfollow cycling could pile unbounded
 * rows into someone else's inbox.
 */
export const notificationSourceKey = {
	comment: (commentId: string) => `comment:${commentId}`,
	/**
	 * Per reply. The prefix must differ from `comment:`: otherwise someone who receives both a comment
	 * notification (as story owner) and a reply notification (as comment author), e.g. another person
	 * replying to their own comment on their own story, hits a key collision and the second is
	 * silently dropped.
	 */
	commentReply: (replyId: string) => `comment-reply:${replyId}`,
	follow: (actorId: string) => `follow:${actorId}`,
	actionApplied: (actionId: string) => `moderation-action:${actionId}:applied`,
	actionReversed: (actionId: string) =>
		`moderation-action:${actionId}:reversed`,
	appealResolved: (appealId: string) => `appeal:${appealId}:resolved`,
	/**
	 * Per report, not per case: with a case-level key, reports by different people on one target would
	 * share a key and the first closed report's notification would swallow the rest
	 * (`onConflictDoNothing` drops the second). Recipients differ so it rarely collides, but one
	 * person filing two reports on the same case hits exactly that.
	 *
	 * A report never reopens once closed (the transition is conditional on `status = 'open'`), so this
	 * key is true once per case and `refresh` is not used.
	 */
	reportReviewed: (reportId: string) => `report:${reportId}:reviewed`,
	/**
	 * Per platform and version, not per broadcast: a per-broadcast key would add a row to every inbox
	 * on each operator re-run, and re-running is this operation's normal path (a request that lost its
	 * response can only be retried by pressing again). The version in the key makes the next floor a
	 * different event. The platform is there because there are two floors; without it, announcing iOS 1.4.0 would make
	 * announcing Android 1.4.0 impossible (same key, second silently dropped), and two platforms
	 * sharing a version is common.
	 */
	appUpdate: (platform: string, appVersion: string) =>
		`app-update:${platform}:${appVersion}`,
	/**
	 * Per story: this key is the whole product invariant, one follower + one story = at most one row.
	 * With unique `(recipient, source_key)`, a story re-entering public (public → private → public), a
	 * retried publish or a rerun transaction adds nothing for someone who already got it.
	 *
	 * A per-event key would make all three new rows; a per-creator key errs the other way and silently
	 * swallows the second story. No `refresh`, since a story is first published once.
	 */
	storyPublished: (storyId: string) => `story-published:${storyId}`,
} as const;

export interface CreateNotificationInput {
	recipientId: string;
	kind: NotificationKind;
	sourceKey: string;
	actorId?: string | null;
	storyId?: string | null;
	commentId?: string | null;
	moderationActionId?: string | null;
	moderationAppealId?: string | null;
	/**
	 * Platform and version an app-floor notice announces; always NULL for other kinds. Values rather
	 * than a reference to the floor row: that row keeps changing, so a reference would let the next
	 * floor change rewrite the meaning of every notification already sent.
	 */
	appPlatform?: string | null;
	appVersion?: string | null;
	/**
	 * Whether to revive an existing row. Only follow sets it: a relationship cut and re-made is a
	 * genuinely new event that should return to the top as unread, and creating a new row would pile
	 * up unbounded. Everything else is a one-time event, so a second INSERT is a retry, and moving its
	 * timestamp forward would let retries reorder the list.
	 */
	refresh?: boolean;
}

/**
 * Writes one notification row; the only place in this file that creates them. It takes the executor
 * so it runs in the originating event's transaction, and neither "comment saved, no notification"
 * nor the reverse can commit.
 */
export async function createNotification(
	executor: NotificationExecutor,
	input: CreateNotificationInput,
): Promise<void> {
	const values = {
		id: newId(),
		recipient: input.recipientId,
		kind: input.kind,
		source_key: input.sourceKey,
		actor: input.actorId ?? null,
		story_id: input.storyId ?? null,
		comment_id: input.commentId ?? null,
		moderation_action_id: input.moderationActionId ?? null,
		moderation_appeal_id: input.moderationAppealId ?? null,
		app_platform: input.appPlatform ?? null,
		app_version: input.appVersion ?? null,
	};

	const insert = executor.insert(notification).values(values);
	const written = await (input.refresh
		? insert.onConflictDoUpdate({
				target: [notification.recipient, notification.source_key],
				/**
				 * Revival touches only the timestamp and read state. Overwriting references too would quietly
				 * turn it into a different row if another event ever reused the key, erasing the signal that
				 * the key design is wrong.
				 */
				set: { created_at: new Date(), read_at: null },
			})
		: /**
			 * A retry does nothing; touching the existing row would turn a network retry into an
			 * already-read notification becoming unread.
			 */
			insert.onConflictDoNothing()
	).returning({ id: notification.id });

	/**
	 * Push delivery attaches only to events that actually happened. `returning` is empty in exactly
	 * one case, a retry swallowed by `onConflictDoNothing`: no visible event, nothing to deliver. A
	 * row revived by `refresh` is a new event (a follow cut and re-made), so the prior delivery is
	 * cleared and a new one made; revival reuses the row id, and without that the delivery's unique
	 * constraint would silently swallow the second dispatch.
	 *
	 * Passing through the same executor is the whole of this layer. Moved outside, a window opens
	 * where the notification committed without a delivery, and a process that died there never pushes
	 * it (idempotency blocks a second insert). No outbound request enters here:
	 * `enqueuePushDeliveries` is one INSERT.
	 */
	await enqueuePushDeliveries(
		executor,
		written.map((row) => row.id),
		{ resetExisting: input.refresh === true },
	);
}

/**
 * Whether this recipient has blocked that actor: the social-notification gate as one SQL fragment.
 *
 * It is a fragment because there are two consumers. The single-recipient path reads it to decide
 * (`notifySocialEvent`); the all-followers path attaches it to the set INSERT's `where`
 * (`notifyFollowersOfSocialEvent`). Pulling it into the application to filter would be one round
 * trip per follower, and passing the whole block list as an array grows the query parameters.
 *
 * Both paths must use the same statement; written separately, one gets fixed and the other stays,
 * and the symptom is "I blocked them and still get their notifications". `recipient` is a SQL
 * fragment because it is a column on the set path and a constant on the single path.
 */
function blockedActorPredicate(recipient: SQLWrapper, actorId: string) {
	return sql`exists (
		select 1 from ${block}
		where ${block.blocker} = ${recipient}
			and ${block.creator} = ${actorId}
	)`;
}

/**
 * Whether the recipient has blocked the actor. Read in the same transaction: checked outside, a
 * block and a comment arriving together could both pass.
 */
async function hasBlocked(
	executor: NotificationExecutor,
	blockerId: string,
	creatorId: string,
): Promise<boolean> {
	const result = await executor.execute(
		sql`select ${blockedActorPredicate(sql`${blockerId}`, creatorId)} as blocked`,
	);
	return Boolean(result.rows[0]?.blocked);
}

/**
 * Notification for an event with an actor; passes two gates.
 *
 * ```text
 * no self-notification     your own comment on your own story is not an event
 * no notice for blocked    removing that person was the user's choice
 * ```
 *
 * Both live here because there are four callers; written per caller, one is eventually missed and
 * the symptom is "I blocked them and still get notified".
 */
export async function notifySocialEvent(
	executor: NotificationExecutor,
	input: CreateNotificationInput & { actorId: string },
): Promise<void> {
	if (input.recipientId === input.actorId) return;
	if (await hasBlocked(executor, input.recipientId, input.actorId)) return;
	await createNotification(executor, input);
}

export interface NotifyFollowersInput {
	/**
	 * The person who caused the event = the follow target. Recipients are all of their current
	 * followers. The recipient list is deliberately not an argument: the caller would read every
	 * follower to build it (thousands of rows through application memory and query parameters), and a
	 * window opens between the read and the write.
	 */
	actorId: string;
	kind: NotificationKind;
	sourceKey: string;
	/** The story this event points at. A reference (`set null`); if it disappears only the row remains. */
	storyId?: string | null;
}

/**
 * Notifies all of the actor's followers of one event with a single statement.
 *
 * The set version of `notifySocialEvent`, with the same three gates:
 *
 * ```text
 * no self-notification     follower <> actor (self-follow is blocked anyway, but keeping it in
 *                          the predicate makes the boundary readable from this statement alone)
 * no notice for blocked    blockedActorPredicate, the same fragment as the single path
 * one row per event        unique(recipient, source_key) is the final authority
 * ```
 *
 * Not a loop because calling `notifySocialEvent` per follower costs a round trip per follower while
 * the transaction stays open, and its block check would be one SELECT per follower (N+1). The app-update
 * announcement has the same shape for the same reason (set INSERT + `returning` → deliveries
 * as a set).
 *
 * `not exists` is an optimization and `on conflict do nothing` is the authority. With only the
 * former, two simultaneous requests could both read an empty result and make two rows for one
 * person; with only the latter it is correct but each rerun builds and discards one row per
 * follower.
 *
 * Returns the number of rows actually created. 0 is normal: no followers, everyone already
 * notified, or the rest all blocked the actor.
 */
export async function notifyFollowersOfSocialEvent(
	executor: NotificationExecutor,
	input: NotifyFollowersInput,
): Promise<number> {
	const result = await executor.execute(sql`
		insert into ${notification} (
			"id", "recipient", "kind", "source_key", "actor", "story_id"
		)
		select
			/*
			 * The DB makes the id: if the application made one UUID per follower and passed them in,
			 * that whole array would become a query parameter. The shape matches lib/id.ts
			 * (32 hex characters without hyphens).
			 */
			replace(gen_random_uuid()::text, '-', ''),
			${follow.follower},
			${input.kind},
			${input.sourceKey},
			${input.actorId},
			${input.storyId ?? null}
		from ${follow}
		where ${follow.creator} = ${input.actorId}
			and ${follow.follower} <> ${input.actorId}
			and not ${blockedActorPredicate(follow.follower, input.actorId)}
			and not exists (
				select 1 from ${notification}
				where ${notification.recipient} = ${follow.follower}
					and ${notification.source_key} = ${input.sourceKey}
			)
		on conflict ("recipient", "source_key") do nothing
		returning "id"
	`);

	/**
	 * Push deliveries are made as a set too, so it is not a round trip per follower. The ids just
	 * created go straight in, through the same executor: rollback removes notification and delivery
	 * together, commit keeps both. No outbound request enters here; `enqueuePushDeliveries` is one
	 * INSERT.
	 */
	await enqueuePushDeliveries(
		executor,
		result.rows.map((row) => String(row.id)),
	);
	return result.rowCount ?? 0;
}

/**
 * Removes the social notifications this person made for me; called by the block transaction.
 *
 * Only rows with an `actor` are deleted. Moderation notifications have no actor (operator identity
 * is never carried), so blocking someone must not erase the notice of a sanction on my own account.
 *
 * Unblocking does not restore them: that would mean keeping what the user cleared away (same rule
 * as follow restoration).
 */
export async function deleteSocialNotificationsFromActor(
	executor: NotificationExecutor,
	recipientId: string,
	actorId: string,
): Promise<number> {
	const removed = await executor
		.delete(notification)
		.where(
			and(
				eq(notification.recipient, recipientId),
				eq(notification.actor, actorId),
			),
		)
		.returning({ id: notification.id });
	return removed.length;
}

/**
 * Deletes every notification this member received; called by account-deletion cleanup. The FK
 * cascade would do the same, but deletion must show in code what is erased, and the count goes into
 * the audit record.
 */
export async function deleteNotificationsForRecipient(
	tx: Tx,
	recipientId: string,
): Promise<number> {
	const removed = await tx
		.delete(notification)
		.where(eq(notification.recipient, recipientId))
		.returning({ id: notification.id });
	return removed.length;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Reads
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * List projection: names, titles and reasons are joined in one pass.
 *
 * Rows hold no snapshot, so the joins are needed, and they must finish in one query; per-row
 * lookups would make one 20-row page twenty round trips that grow with the inbox, with "slow
 * notifications" as the only symptom.
 *
 * All four are `leftJoin` so a notification whose target vanished goes out with that part blank; an
 * `innerJoin` would drop the row from the page, and the cursor's count would diverge from what the
 * client receives, misaligning page boundaries.
 *
 * Comments use an `exists` subquery rather than a join: the only need is whether it is still there
 * (no body or timestamp is carried).
 */
const NOTIFICATION_COLUMNS = {
	id: notification.id,
	kind: notification.kind,
	createdAt: notification.created_at,
	readAt: notification.read_at,
	actorId: member.id,
	actorDisplayName: member.nickname,
	/**
	 * Avatar comes from two axes: the media pointer first, the legacy column as fallback
	 * (`avatarUrlOf` in `services/media.ts`). Same constant as profiles and comments.
	 */
	actorAvatarMediaId: memberAvatarMediaId,
	actorAvatarUrl: member.avatar_url,
	storyId: story.id,
	storyTitle: story.title,
	commentId: notification.comment_id,
	/**
	 * A tombstone is not alive: even when kept for surviving replies, its utterance is gone, and an
	 * anchor to it would lead to a "deleted comment" line. Without `deleted_at is null` here the
	 * defect shows only as a destination that means nothing, with no error.
	 */
	commentAlive: sql<boolean>`exists (
		select 1 from ${story_comment}
		where ${story_comment.id} = ${notification.comment_id}
		  and ${story_comment.deleted_at} is null
	)`.mapWith(Boolean),
	actionId: moderation_action.id,
	actionKind: moderation_action.kind,
	actionPublicReason: moderation_action.public_reason,
	appealId: moderation_appeal.id,
	appealActionId: moderation_appeal.action_id,
	appealStatus: moderation_appeal.status,
	/**
	 * App-floor notice values; also columns, not a join. Joining `ops_app_version_floor` would carry
	 * the current floor, which keeps changing, so a row that announced 1.2.0 would look like one that
	 * announced 1.4.0.
	 */
	appPlatform: notification.app_platform,
	appVersion: notification.app_version,
} as const;

type NotificationRow = {
	[K in keyof typeof NOTIFICATION_COLUMNS]: K extends "createdAt"
		? Date
		: K extends "readAt"
			? Date | null
			: K extends "commentAlive"
				? boolean
				: string | null;
} & { id: string; kind: string; createdAt: Date; readAt: Date | null };

/**
 * Stored row to wire DTO.
 *
 * Unknown kinds are dropped (null). The branch is reachable only on a deployment rolled back after
 * the vocabulary grew, and losing that one row is more accurate than a 500 for the whole list.
 */
function toDto(row: NotificationRow): NotificationDto | null {
	const base = {
		id: row.id,
		createdAt: row.createdAt.toISOString(),
		readAt: row.readAt?.toISOString() ?? null,
	};
	/**
	 * The actor is built only when the member row exists. Folding `avatarUrl`'s `""` to null is the
	 * public profile's rule: "unspecified" in the product model is not an empty string.
	 */
	const actor = row.actorId
		? {
				id: row.actorId,
				displayName: row.actorDisplayName ?? "",
				avatarUrl: avatarUrlOf(
					row.actorAvatarMediaId,
					row.actorAvatarUrl ?? "",
				),
			}
		: null;
	const action =
		row.actionId && row.actionKind
			? {
					id: row.actionId,
					kind: row.actionKind as ModerationActionKind,
					publicReason: row.actionPublicReason ?? "",
				}
			: null;

	switch (row.kind as NotificationKind) {
		case "follow":
			return { ...base, kind: "follow", actor };
		/**
		 * Same join and columns for both; recipient and wording differ, and those are decided by the
		 * service and the screen, not here.
		 */
		case "comment_reply":
			return {
				...base,
				kind: "comment_reply",
				actor,
				story: row.storyId
					? { id: row.storyId, title: row.storyTitle ?? "" }
					: null,
				/** A deleted reply is not pointed at: no reason to build an address with no anchor. */
				commentId: row.commentAlive ? row.commentId : null,
			};
		case "story_comment":
			return {
				...base,
				kind: "story_comment",
				actor,
				story: row.storyId
					? { id: row.storyId, title: row.storyTitle ?? "" }
					: null,
				/** A deleted comment is not pointed at: no reason to build an address with no anchor. */
				commentId: row.commentAlive ? row.commentId : null,
			};
		/**
		 * New public story: uses two joins (actor and story), the same shape as comments minus
		 * `commentId`.
		 *
		 * A row whose story vanished is not dropped; `story` goes out null. What that person received
		 * really happened, and the screen draws it as a row with no destination (the nullable contract
		 * expresses that). Filtering here would desync the cursor's count from what the client receives
		 * and misalign page boundaries.
		 */
		case "creator_story_published":
			return {
				...base,
				kind: "creator_story_published",
				actor,
				story: row.storyId
					? { id: row.storyId, title: row.storyTitle ?? "" }
					: null,
			};
		case "moderation_action":
			return { ...base, kind: "moderation_action", action };
		case "moderation_reversed":
			return { ...base, kind: "moderation_reversed", action };
		/**
		 * The only kind that needs no joins. It uses no reference columns (no report id, case id or
		 * target), so none of the four `leftJoin`s above runs for it. That is this kind's exposure
		 * boundary: with no slot to carry anything, nothing can be carried by mistake.
		 */
		case "report_reviewed":
			return { ...base, kind: "report_reviewed" };
		/**
		 * A row without a version or platform is dropped, like an unknown kind. The contract requires
		 * both, so sending an empty value would make client validation reject the whole list; losing one
		 * row beats making the inbox unopenable. The platform is re-checked against the vocabulary
		 * because the column is `text`, for the same reason.
		 */
		case "app_update":
			return row.appVersion &&
				(row.appPlatform === "ios" || row.appPlatform === "android")
				? {
						...base,
						kind: "app_update",
						appPlatform: row.appPlatform,
						appVersion: row.appVersion,
					}
				: null;
		case "appeal_resolved":
			return {
				...base,
				kind: "appeal_resolved",
				appeal:
					row.appealId &&
					row.appealActionId &&
					(row.appealStatus === "accepted" || row.appealStatus === "rejected")
						? {
								id: row.appealId,
								actionId: row.appealActionId,
								status: row.appealStatus,
							}
						: null,
			};
		default:
			return null;
	}
}

export interface ListNotificationsOptions {
	/** Member id resolved from the session; no request field can supply it. */
	recipientId: string;
	cursor: string;
	limit: number;
}

/**
 * One page of the inbox, newest first.
 *
 * Reads `limit + 1` rows to learn whether a next page exists, rather than running a second count;
 * the extra row is discarded. This is the cursor-list convention (comments and the moderation queue
 * share it).
 */
export async function listNotifications({
	recipientId,
	cursor,
	limit,
}: ListNotificationsOptions): Promise<NotificationsPage> {
	const size = Math.min(Math.max(limit, 1), NOTIFICATION_MAX_PAGE_SIZE);
	const after = cursor ? decodeTimelineCursor(cursor) : null;

	const rows = await db
		.select(NOTIFICATION_COLUMNS)
		.from(notification)
		.leftJoin(member, eq(member.id, notification.actor))
		.leftJoin(story, eq(story.id, notification.story_id))
		.leftJoin(
			moderation_action,
			eq(moderation_action.id, notification.moderation_action_id),
		)
		.leftJoin(
			moderation_appeal,
			eq(moderation_appeal.id, notification.moderation_appeal_id),
		)
		.where(
			and(
				eq(notification.recipient, recipientId),
				/**
				 * Rows after the cursor (older). Newest-first makes the comparison `<`, with id breaking ties
				 * only at equal timestamps; comparing both at once avoids duplicates and gaps at
				 * same-millisecond boundaries.
				 */
				after
					? or(
							lt(notification.created_at, after.createdAt),
							and(
								eq(notification.created_at, after.createdAt),
								lt(notification.id, after.id),
							),
						)
					: undefined,
			),
		)
		.orderBy(desc(notification.created_at), desc(notification.id))
		.limit(size + 1);

	const page = rows.slice(0, size);
	const last = page.at(-1);
	return {
		items: page
			.map((row) => toDto(row as NotificationRow))
			.filter((dto): dto is NotificationDto => dto !== null),
		nextCursor:
			rows.length > size && last
				? encodeTimelineCursor({ createdAt: last.createdAt, id: last.id })
				: null,
	};
}

/**
 * Unread count; the server is the final authority. The screen must not count from accumulated
 * pages, since a client may hold only the first 20 rows and its count would always fall short.
 */
export async function countUnreadNotifications(
	recipientId: string,
): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(notification)
		.where(
			and(
				eq(notification.recipient, recipientId),
				isNull(notification.read_at),
			),
		);
	return row?.n ?? 0;
}

/**
 * Marks one notification read; ownership is in the predicate. There is no read-then-update: with
 * the recipient in `where`, a request pointing at someone else's notification updates 0 rows and
 * the route maps that to the same 404 as a missing one.
 *
 * Idempotent: an already-read row keeps its timestamp and succeeds (`coalesce`). Making the second
 * call a conflict would turn retries into errors and let re-pressing an already-read notification
 * move its timestamp forward.
 */
export async function markNotificationRead(
	recipientId: string,
	notificationId: string,
): Promise<Date | null> {
	const [updated] = await db
		.update(notification)
		.set({ read_at: sql`coalesce(${notification.read_at}, now())` })
		.where(
			and(
				eq(notification.id, notificationId),
				eq(notification.recipient, recipientId),
			),
		)
		.returning({ readAt: notification.read_at });
	return updated?.readAt ?? null;
}

/**
 * Marks everything read; one statement is the boundary. Only rows unread at that moment change. A
 * client-supplied cutoff (`readBefore`) would let a clock-skewed device mark just-arrived
 * notifications read, or pre-read ones not yet arrived. This UPDATE changes only what it sees, so a
 * notification committed at the same moment stays unread.
 *
 * Idempotent: the second call changes 0 rows, and that 0 is in the response.
 */
export async function markAllNotificationsRead(
	recipientId: string,
): Promise<number> {
	const updated = await db
		.update(notification)
		.set({ read_at: new Date() })
		.where(
			and(
				eq(notification.recipient, recipientId),
				isNull(notification.read_at),
			),
		)
		.returning({ id: notification.id });
	return updated.length;
}
