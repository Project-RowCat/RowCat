import { z } from "zod";
import { ModerationActionKind } from "./moderation.ts";
import { AppPlatform } from "./ops.ts";
import { PublicProfileSummaryDto } from "./profile.ts";

/**
 * Protocol for /v2/me/notifications/*.
 *
 * Notifications are server-owned private state. Postgres is the source of truth, and only the
 * recipient can read them. That is why this contract exists and IndexedDB or the sync codec
 * registry has no place for them.
 *
 * - Not sent: recipient, memberId, viewerId. Ownership comes from the session; the /me path
 *   enforces it.
 * - Not sent: moderator id, nickname or role, or the internal reason. Only the public reason is
 *   sent.
 * - Not sent: comment body. Bodies would outlive deleted or moderated comments and add a cleanup
 *   target on account withdrawal.
 * - Not sent: finished copy such as `OO followed you`. The server sends the meaning of the
 *   event; the client owns the wording.
 * - Not sent: web URLs or route names. The destination is derived from identifiers.
 * - Not sent: sourceKey. It is the server's idempotency key, and clients branching on it would
 *   tie them to its format.
 *
 * The kinds form a discriminated union because their attached data differs. One object with
 * all-nullable fields would make states such as a follow notification with no actor and no story
 * expressible.
 */

/**
 * Notification kinds. The enum is open and holds no placeholder values.
 *
 * A placeholder would freeze the vocabulary before any code creates that kind. This is the same
 * rule as the moderation capability vocabulary. Adding a kind does not break compatibility: old
 * clients skip unknown kinds, and the discriminated union enforces that branch in the types.
 *
 * The kinds fall into six groups:
 * - follow, story_comment: another member acted on me (has an actor).
 * - comment_reply: a reply to my comment. Same column, different recipient.
 * - creator_story_published: someone I follow acted (has an actor).
 * - moderation_*, appeal_resolved: an operator acted on this account (actor hidden).
 * - report_reviewed: my requested review finished (no target, no outcome).
 * - app_update: the company announces a fact to everyone (no actor).
 *
 * The third group differs from the first two. Follow and comment events go to one recipient. A new
 * story goes to every follower of the creator, written as one set INSERT
 * (notifyFollowersOfSocialEvent). The contract does not change: each recipient still sees one row.
 *
 * The last two groups share the inbox with the rest on purpose (§25). Unread counts, read marks and
 * cleanup must stay a single set.
 */
export const NotificationKind = z.enum([
	"follow",
	"story_comment",
	"comment_reply",
	"creator_story_published",
	"moderation_action",
	"moderation_reversed",
	"appeal_resolved",
	"report_reviewed",
	"app_update",
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

/**
 * Page size for notification lists. Client and server must use the same value so that prefetch and
 * queries line up.
 */
export const NOTIFICATION_PAGE_SIZE = 20;

/**
 * Upper bound for one request. As with the comment and moderation queues, without a cap a request
 * such as limit=100000 would dump the whole inbox and defeat pagination.
 */
export const NOTIFICATION_MAX_PAGE_SIZE = 50;

/**
 * Four axes shared by every kind.
 *
 * readAt must live on the server. If read state were kept on the device, a notification read on the
 * Mac would look new again on the phone, and that state never heals on its own.
 */
const base = {
	id: z.string(),
	createdAt: z.iso.datetime(),
	/** null means unread. V1 has no way to mark a notification unread again. */
	readAt: z.iso.datetime().nullable(),
};

/**
 * Actor: the current public profile summary, not a snapshot.
 *
 * Names are not copied into notification rows, so a renamed member's old notifications show the new
 * name. This is a V1 choice. The cost is that the name at the time cannot be reproduced. The gain
 * is one fewer personal identifier to erase on withdrawal.
 *
 * null means a withdrawn member. Notifications record past events, so they remain after the actor
 * is gone, and the screen draws a neutral placeholder. Storing a snapshot to keep the name would
 * break the promise above.
 */
const actor = PublicProfileSummaryDto.nullable();

export const FollowNotificationDto = z.object({
	...base,
	kind: z.literal("follow"),
	actor,
});
export type FollowNotificationDto = z.infer<typeof FollowNotificationDto>;

/**
 * No body. The row shows who commented on which story. The text is on the story page, if the
 * comment still exists.
 *
 * Not storing the body keeps deleted comment text from surviving in notifications.
 *
 * story is null after the story is removed. The notification is not deleted, because the event
 * really happened. The screen draws a row with no destination.
 */
export const StoryCommentNotificationDto = z.object({
	...base,
	kind: z.literal("story_comment"),
	actor,
	/** The title is read from the current story row, not snapshotted. Same rule as the actor name. */
	story: z.object({ id: z.string(), title: z.string() }).nullable(),
	/**
	 * Reserved for a future comment anchor jump. In V1 the jump only goes to the story detail page.
	 */
	commentId: z.string().nullable(),
});
export type StoryCommentNotificationDto = z.infer<
	typeof StoryCommentNotificationDto
>;

/**
 * A reply to MY comment. Split from story_comment because the recipient and the wording both
 * differ.
 *
 * - story_comment: recipient is the story owner; reads `someone commented on my story`.
 * - comment_reply: recipient is the comment author; reads `someone replied to my comment`.
 *
 * Folding them into one kind would make one sentence wrong. A reply to my comment on someone else's
 * story would show `commented on "…"`, which reads as a comment on the reader's own story. The
 * destinations differ too (the story versus the thread).
 *
 * One reply does not create two rows. The server does not create a story_comment for the story
 * owner when a reply is posted (services/comments.ts). If the owner started the thread, they get
 * this notification anyway.
 *
 * commentId points at the reply. If that row is gone, the destination falls back to the story.
 */
export const CommentReplyNotificationDto = z.object({
	...base,
	kind: z.literal("comment_reply"),
	actor,
	story: z.object({ id: z.string(), title: z.string() }).nullable(),
	/** Id of the reply. Filled only while that reply still exists. */
	commentId: z.string().nullable(),
});
export type CommentReplyNotificationDto = z.infer<
	typeof CommentReplyNotificationDto
>;

/**
 * A new work published by a creator I follow.
 *
 * The same social kind as the ones above, but the direction is reversed. Follow and comment events
 * happen to me, so they have one recipient. This event is caused by a creator I chose, so it
 * reaches all of that creator's followers at once. The contract is not split, because from the
 * recipient's side the shape is the same: who did what.
 *
 * Not sent:
 * - Work content: description, tags, cover, rating. The line only says a new work exists; the
 *   detail page answers the rest. A rating would force this line to know the adult-display setting,
 *   which the server's view gate already decides.
 * - Current follow state. Notifications record what happened, so unfollowing later does not
 *   remove the row. Blocking is different: it is an action that clears the inbox.
 * - Recipient count. Send scale is an operations value, not something recipients see.
 *
 * story is null after the work is removed, the same rule as the comment notification. The row stays
 * and the screen draws it with no destination.
 */
export const CreatorStoryPublishedNotificationDto = z.object({
	...base,
	kind: z.literal("creator_story_published"),
	/**
	 * The creator who published the story. null means the creator has withdrawn. No snapshot is kept.
	 */
	actor,
	/** The title is read from the current story row, not snapshotted. Same rule as the actor name. */
	story: z.object({ id: z.string(), title: z.string() }).nullable(),
});
export type CreatorStoryPublishedNotificationDto = z.infer<
	typeof CreatorStoryPublishedNotificationDto
>;

/**
 * Moderation action attached to a notification. Only what the enforcement target can already see.
 *
 * This is the same exposure boundary as the items in MyModerationStatusDto. The operator DTO
 * (ModerationActionDto) is not reused, because it carries the internal reason and the operator id.
 * Reusing it would send those on every such response. The point is that this is a different type.
 * Omitting fields by hand is easy to forget, and the leak would only show after the fact.
 */
export const NotificationActionDto = z.object({
	id: z.string(),
	kind: ModerationActionKind,
	/** Empty means the screen shows only the action kind. */
	publicReason: z.string(),
});
export type NotificationActionDto = z.infer<typeof NotificationActionDto>;

/** Sent when an operation was applied to my account, a story or a comment. */
export const ModerationActionNotificationDto = z.object({
	...base,
	kind: z.literal("moderation_action"),
	action: NotificationActionDto.nullable(),
});
export type ModerationActionNotificationDto = z.infer<
	typeof ModerationActionNotificationDto
>;

/**
 * The operator reversed the action directly.
 *
 * Appeal acceptance does not come here. It ends with appeal_resolved. Sending both would turn one
 * event into two rows, which users read as two events.
 *
 * The attached action is the reversal, not the original. It is the record just created, and its
 * public reason explains why the action was lifted.
 */
export const ModerationReversedNotificationDto = z.object({
	...base,
	kind: z.literal("moderation_reversed"),
	action: NotificationActionDto.nullable(),
});
export type ModerationReversedNotificationDto = z.infer<
	typeof ModerationReversedNotificationDto
>;

/**
 * Only the public outcome is attached. The operator's resolutionNote is omitted, for the same
 * reason it is absent from MyAppealDto.
 */
export const AppealResolvedNotificationDto = z.object({
	...base,
	kind: z.literal("appeal_resolved"),
	appeal: z
		.object({
			id: z.string(),
			actionId: z.string(),
			status: z.enum(["accepted", "rejected"]),
		})
		.nullable(),
});
export type AppealResolvedNotificationDto = z.infer<
	typeof AppealResolvedNotificationDto
>;

/**
 * The review of a report I filed has finished.
 *
 * The point of this kind is that it carries only the four common axes. It has no reference, target,
 * reason or outcome. There are four reasons:
 * - No outcome. resolved and dismissed fold into one fact (review finished). Naming which one
 *   would make this row an outcome notice.
 * - No target. Which work was reported is a clue to that work's current state, and the reporter
 *   already knows what they reported.
 * - No pointer to the report. The destination is the `My reports` list, where status is visible. That
 *   list already has its own resource.
 * - No actor. The reviewer is an operator, but that identity is withheld for the same reason as
 *   enforcement notices (§9). actor is always NULL.
 *
 * Adding reportId would need a reference column on the notification row (a migration). More
 * importantly, the notification would start to be a summary of the report list.
 */
export const ReportReviewedNotificationDto = z.object({
	...base,
	kind: z.literal("report_reviewed"),
});
export type ReportReviewedNotificationDto = z.infer<
	typeof ReportReviewedNotificationDto
>;

/**
 * The minimum supported app version went up. This is a fact the company announces.
 *
 * It has no actor, is not stopped by self or block checks, and effectively every member is a
 * recipient. The value comes from an operator-managed row (ops_app_version_floor), never from the
 * request.
 *
 * It announces support ending, not a release. A floor means versions below it are no longer
 * accepted. A new release alone does not create this notification. The only operation that creates
 * it is raising the floor. If the kind were used to promote releases, it would become a general
 * broadcast tool.
 *
 * Both values are as of send time. Otherwise the notice for
 * 1.2.0 would display the current floor, such as 1.4.0. The floor row keeps changing after the
 * send.
 *
 * Not sent:
 * - A store URL. market:// and itms-apps:// are dead links in the web inbox. The client derives
 *   the destination from the kind (see §Destinations), and this row does not navigate.
 * - Operator-written copy. The floor row's message is the text the app shows on its blocking
 *   screen, not an inbox body. Sending it would make this kind an arbitrary-string channel to all
 *   members. Copy is never stored in rows.
 * - Whether this device is below the floor. The server does not know which member uses the app.
 *   Even if it did, the check happens at app boot via GET /v2/runtime-config. A boolean here would
 *   freeze at receipt and go stale.
 */
export const AppUpdateNotificationDto = z.object({
	...base,
	kind: z.literal("app_update"),
	/** Platform this floor applies to. The value at send time. */
	appPlatform: AppPlatform,
	/** Minimum supported version for that platform (MAJOR.MINOR.PATCH). The value at send time. */
	appVersion: z.string().min(1),
});
export type AppUpdateNotificationDto = z.infer<typeof AppUpdateNotificationDto>;

export const NotificationDto = z.discriminatedUnion("kind", [
	FollowNotificationDto,
	StoryCommentNotificationDto,
	CommentReplyNotificationDto,
	CreatorStoryPublishedNotificationDto,
	ModerationActionNotificationDto,
	ModerationReversedNotificationDto,
	AppealResolvedNotificationDto,
	ReportReviewedNotificationDto,
	AppUpdateNotificationDto,
]);
export type NotificationDto = z.infer<typeof NotificationDto>;

/**
 * Query parameters for listing notifications.
 *
 * There is no page number. The inbox grows upward while it is being read, so an offset does not
 * fit. If one notification arrives while the reader is on page 2, the boundary row appears twice or
 * is skipped. A cursor points at the last row seen, so it is unaffected by the change.
 *
 * No filters (read state or kind) in V1 is also deliberate. Each axis adds a tab to the screen, and
 * each tab gets its own cache slot and its own empty state.
 */
export const NotificationsQuery = z.object({
	/**
	 * Empty string means the first page. This follows the repo convention that an unspecified query
	 * value is an empty string.
	 */
	cursor: z.string().default(""),
	limit: z
		.number()
		.int()
		.min(1)
		.max(NOTIFICATION_MAX_PAGE_SIZE)
		.default(NOTIFICATION_PAGE_SIZE),
});
export type NotificationsQuery = z.infer<typeof NotificationsQuery>;

/**
 * A page of notifications, newest first.
 *
 * This is deliberately the reverse of comments (oldest first). Discussion is read top to bottom.
 * The inbox is a list of what just arrived.
 *
 * There is no total. The unread count is asked for separately (below). It is an independent
 * question the server must answer. It cannot be derived from the list, because a client that loaded
 * one page cannot count everything.
 */
export const NotificationsPage = z.object({
	items: z.array(NotificationDto),
	nextCursor: z.string().nullable(),
});
export type NotificationsPage = z.infer<typeof NotificationsPage>;

/**
 * Unread count, from GET /v2/me/notifications/unread-count.
 *
 * Not folded into /me. That endpoint is the hottest read: root SSR, the header and the auth guards
 * hit it on every request. This value changes on a different cadence and is polled every 60
 * seconds. Merging would re-query every viewer for one notification, and each change would
 * re-render the whole app.
 */
export const NotificationUnreadCountDto = z.object({
	unread: z.number().int().nonnegative(),
});
export type NotificationUnreadCountDto = z.infer<
	typeof NotificationUnreadCountDto
>;

/**
 * Query serialization. Default values are omitted, because the server reads an omitted value as the
 * default.
 *
 * Like comments and the gallery, the contract owns this. If each client wrote its own, the same
 * query would go out with different URLs.
 */
export function toNotificationsSearchParams(
	q: NotificationsQuery,
): URLSearchParams {
	const sp = new URLSearchParams();
	if (q.cursor) sp.set("cursor", q.cursor);
	if (q.limit !== NOTIFICATION_PAGE_SIZE) sp.set("limit", String(q.limit));
	return sp;
}

/**
 * The read-mark response returns the confirmed timestamp.
 *
 * This stops the client from inventing readAt on its own clock. An optimistic update has to invent
 * a value, but confirmation overwrites it with the server's.
 *
 * The unread count is not included. This write does lower the count by one, but the absolute value
 * would need an extra count on the server for every write. The follower count differs, because that
 * transaction already counts. The client decrements its own cache entry, and the next poll corrects
 * it.
 */
export const NotificationReadResponse = z.object({
	readAt: z.iso.datetime(),
});
export type NotificationReadResponse = z.infer<typeof NotificationReadResponse>;

/**
 * Rows actually changed by mark-all-read. Returned because the operation is idempotent. A second
 * call returns 0, and the response shape records that this is not an error.
 */
export const NotificationReadAllResponse = z.object({
	updated: z.number().int().nonnegative(),
});
export type NotificationReadAllResponse = z.infer<
	typeof NotificationReadAllResponse
>;
