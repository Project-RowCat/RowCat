import type { PublicProfile } from "./profile.ts";

/**
 * The notification product model: what has happened to my account.
 *
 * Data in this repo has three owners, and notifications are the third:
 * - Drafts and conversations: on the device. IndexedDB is the source of truth. The server holds
 *   ciphertext only (@rowcat/sync).
 * - Works and comments: shared. Postgres is the source of truth, and anyone can read.
 * - Notifications: the recipient only. Postgres is the source of truth, and only the recipient
 *   reads.
 *
 * This model is therefore server state, cached by TanStack Query. It never goes into IndexedDB, the
 * sync codec registry or localStorage. If read state differed per device, a notification read on
 * the Mac would turn new again on the phone, and that state never heals on its own.
 *
 * This is not an audit log. The audit record is the `moderation_action` row, and notifications are
 * copies made to tell people about it. Do not reconstruct enforcement from notification history.
 * Social notifications from a blocked actor are removed, and that is the correct behavior.
 *
 * The union is discriminated because each kind carries genuinely different fields. One object with
 * every field nullable could express 'a follow notification with no actor and no work', and every
 * screen would have to check for that before drawing.
 */

/**
 * The person who triggered a notification. A subset of the public profile.
 *
 * Defined with `Pick` on purpose. Repeating the same three fields would create a second place to
 * update when the profile's visibility rules change.
 *
 * null means a withdrawn member. The nickname is not copied into notifications (see the contract
 * comment), so when the person leaves, their name leaves with them. The notification itself stays,
 * since the event did happen. The screen draws a neutral placeholder.
 */
export type NotificationActor = Pick<
	PublicProfile,
	"id" | "displayName" | "avatarUrl"
>;

interface NotificationBase {
	id: string;
	/** ISO 8601. */
	createdAt: string;
	/** `null` means unread. V1 has no mark-as-unread action. */
	readAt: string | null;
}

export interface FollowNotification extends NotificationBase {
	kind: "follow";
	actor: NotificationActor | null;
}

/**
 * A comment left on one of my works. It has no body: a notification records an event, not a copy of
 * its content (the contract comment explains why). If `story` is null, the work is gone and the row
 * has no destination.
 */
export interface StoryCommentNotification extends NotificationBase {
	kind: "story_comment";
	actor: NotificationActor | null;
	story: { id: string; title: string } | null;
	commentId: string | null;
}

/**
 * A reply to **my comment**. Same shape as the `story_comment` kind, but the recipient and meaning
 * differ. This one goes to the commenter; the story-comment kind goes to the work's owner. Folding
 * them into one kind would make the wording wrong on one side (the contract comment has the table).
 * `commentId` points to the reply.
 */
export interface CommentReplyNotification extends NotificationBase {
	kind: "comment_reply";
	actor: NotificationActor | null;
	story: { id: string; title: string } | null;
	commentId: string | null;
}

/**
 * A creator I follow published a new work. Same social category as follow and comment
 * notifications, but the direction is reversed. Those happen to me. This one is something the
 * person I chose did, fanned out to all of their followers. It shares a model because the recipient
 * sees the same shape: who, and what.
 *
 * It carries no work content: no synopsis, tags, cover or rating. The line says only that a new
 * work exists. The detail screen answers what it is. If `story` is null, the work is gone and the
 * row has no destination (same rule as comment notifications).
 */
export interface CreatorStoryPublishedNotification extends NotificationBase {
	kind: "creator_story_published";
	actor: NotificationActor | null;
	story: { id: string; title: string } | null;
}

/** An action attached to a notification. Only what the enforcement target can already see. */
export interface NotificationAction {
	id: string;
	kind: string;
	/**
	 * Empty means the screen names only the action kind. Operator-internal reasons never arrive here.
	 */
	publicReason: string;
}

export interface ModerationActionNotification extends NotificationBase {
	kind: "moderation_action";
	action: NotificationAction | null;
}

/**
 * An operator reversed a moderation action directly. An accepted appeal is announced only through
 * one of the kinds below.
 */
export interface ModerationReversedNotification extends NotificationBase {
	kind: "moderation_reversed";
	action: NotificationAction | null;
}

export interface AppealResolvedNotification extends NotificationBase {
	kind: "appeal_resolved";
	appeal: {
		id: string;
		actionId: string;
		status: "accepted" | "rejected";
	} | null;
}

/**
 * A review of a report I filed is complete.
 *
 * It carries only the common axes. There is no outcome (resolved or dismissed), no report target,
 * and no reporter identity. The line says one sentence, and the `My reports` list answers the details
 * with its own resource. If a field seems needed, first write down why its value must live in the
 * notification plane (the contract comment has the reasoning).
 */
export interface ReportReviewedNotification extends NotificationBase {
	kind: "report_reviewed";
}

/**
 * The store platform a notification points to. Same vocabulary as `AppPlatform` in the contract,
 * but not imported: this package depends on nothing (layer rule). If the two values diverge, the compile fails first at the SDK's
 * identity cast (packages/sdk/src/notifications.ts).
 */
export type AppUpdatePlatform = "ios" | "android";

/**
 * The minimum supported app version was raised. This is a fact the company announces: no actor,
 * and the audience is effectively every member. The version comes from a floor row the operator
 * manages.
 *
 * The announced fact is end of support, not a release. The floor means 'no longer served below this
 * version'. Publishing a new version alone does not create this line. The copy file
 * (notification-copy.ts) keeps that distinction.
 *
 * Both values are as of send time. Reading the current floor would make a notice about 1.2.0 look
 * like one about 1.4.0. That mistake raises no error.
 */
export interface AppUpdateNotification extends NotificationBase {
	kind: "app_update";
	appPlatform: AppUpdatePlatform;
	appVersion: string;
}

export type Notification =
	| FollowNotification
	| StoryCommentNotification
	| CommentReplyNotification
	| CreatorStoryPublishedNotification
	| ModerationActionNotification
	| ModerationReversedNotification
	| AppealResolvedNotification
	| ReportReviewedNotification
	| AppUpdateNotification;

/** One page of an appended list. A null `nextCursor` marks the end. */
export interface NotificationPage {
	items: Notification[];
	nextCursor: string | null;
}

/**
 * Whether the notification is unread. The predicate lives in one place because three surfaces read
 * this value: the header dot, the popover row and the full list row. Writing `readAt === null` in
 * three places risks one of them becoming `!readAt`, and those two differ on an empty string.
 */
export const isUnread = (notification: Notification): boolean =>
	notification.readAt === null;

/**
 * The string to draw on the badge. Zero means none, not the string `0`. The cap is about layout:
 * past three digits the badge starts pushing the title on a 390px screen, where those pixels are
 * needed for which conversation is open. People who need the exact count open the list.
 */
export const NOTIFICATION_BADGE_MAX = 99;
export function notificationBadgeLabel(unread: number): string | null {
	if (unread <= 0) return null;
	return unread > NOTIFICATION_BADGE_MAX
		? `${NOTIFICATION_BADGE_MAX}+`
		: String(unread);
}

/**
 * The bell button's accessible name. The red dot is conveyed only by color and shape, so screen
 * readers get nothing from it. Putting the count in the name is the only way to convey that state.
 *
 * While the count is unknown, the name says nothing about it. Saying `0 unread` first would be
 * wrong by the time the value arrived.
 */
export function notificationBellLabel(unread: number | null): string {
	if (unread === null || unread <= 0) return "Notifications";
	const badge = notificationBadgeLabel(unread);
	return `Notifications, ${badge} unread`;
}
