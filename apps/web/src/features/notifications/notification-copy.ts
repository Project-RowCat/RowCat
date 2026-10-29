import type {
	AppUpdatePlatform,
	Notification,
	NotificationActor,
} from "@rowcat/domain";
import { translator } from "#/lib/i18n/current.ts";
import { formatNumber } from "#/lib/i18n/format.ts";

/**
 * Builds the text of a notification row here, not on the server. The database stores no finished
 * sentence (see the table comment), so Korean copy is not frozen server-side and a later Expo
 * client can use its own copy. Being pure, the copy can be checked without rendering.
 *
 * Comment bodies are not included (§102). The row says who did what to which work; the full text is
 * one click away. Moderator internal reasons (§103) are absent from the contract, so they cannot be
 * rendered by accident. The absence is intentional.
 */

/**
 * `Mark all read` failed. This mutation is not optimistic (`@rowcat/query`): on failure neither the badge
 * nor the list changes, so the user cannot tell it from the button doing nothing. The button also
 * lives in the bell popover, which closes, so the message would have nowhere to appear.
 *
 * This is distinct from the failure to mark a single row read. There, the requested action is
 * navigation and the read mark is a side effect (`use-notifications.ts`), so failure is quietly
 * reverted. Talking about notifications over a page just navigated to would attach an unrelated
 * sentence.
 */
export const notificationsMarkAllReadFailed = (): string =>
	translator("notifications")("markAllReadFailed");

/**
 * Store platform labels, as one table. Typed as `Record<AppUpdatePlatform, string>`, so adding a
 * platform to the shared vocabulary breaks compilation here. A ternary would silently fold a third
 * platform into one of the two.
 */
const APP_PLATFORM_LABEL: Record<AppUpdatePlatform, string> = {
	ios: "iOS",
	android: "Android",
};

/**
 * Placeholder for a departed actor. Names are not stored as snapshots, so the placeholder is filled
 * in here.
 */

/**
 * Display name of the actor. An empty nickname and a departed account are not collapsed into one
 * string. A user who left the name blank still exists (`No name`), while a departed user
 * does not. One string for both would make the screen unable to tell them apart. The public
 * profile's `profileDisplayName` follows the same rule.
 */
export function notificationActorName(actor: NotificationActor | null): string {
	const t = translator("notifications");
	if (!actor) return t("deletedActor");
	return actor.displayName || t("unnamed");
}

/**
 * One sentence of the row body. Titles are wrapped in quotes to mark their boundary. Without
 * quotes, `commented on Night Library` gives no way to tell where the title ends, especially for titles that
 * read like sentences. When the work is gone, the sentence changes rather than inventing a title.
 * An empty pair of quotes (`commented on ""`) would look like broken data.
 */
export function notificationMessage(notification: Notification): string {
	const t = translator("notifications");
	switch (notification.kind) {
		case "follow":
			return t("message.follow", {
				who: notificationActorName(notification.actor),
			});
		case "story_comment": {
			const who = notificationActorName(notification.actor);
			return notification.story
				? t("message.storyComment", { who, title: notification.story.title })
				: t("message.storyCommentUntitled", { who });
		}
		/**
		 * Its subject differs from `story_comment`. It says `your comment`, not `your story`
		 * (your work). The recipient is the author of the comment, not the owner of the work. That is
		 * exactly the case of a reply to your comment on someone else's work. Merging the two kinds would
		 * make that person read a notification about another's work as if it were theirs.
		 *
		 * The work title is included because it is the only context for which thread this is. Reply
		 * bodies are not in the payload; the contract says so.
		 */
		case "comment_reply": {
			const who = notificationActorName(notification.actor);
			return notification.story
				? t("message.commentReply", { who, title: notification.story.title })
				: t("message.commentReplyUntitled", { who });
		}
		/**
		 * The title is not in this sentence; the second line draws it (`notificationDetail`). This is the
		 * only point where it differs from the comment row, and the reason is the Korean object particle.
		 * In the Korean copy the object particle depends on whether the title ends in a consonant, so attaching it is wrong for
		 * some titles. Titles are user-chosen strings and do arrive this way. Picking the
		 * particle in code would again fail for non-Korean titles (English, digits, symbols). The comment
		 * Korean sentence uses the locative particle, which fits either ending. No such particle appears here.
		 *
		 * The parenthesized dual-particle notation is not used: this is a notification people read, not a form.
		 *
		 * The sentence stays the same when the work is deleted. 'Published a new work' is still true
		 * without the title, so there is no reason to split the sentence as comments do. Only the second
		 * line and the link disappear.
		 */
		case "creator_story_published":
			return t("message.published", {
				who: notificationActorName(notification.actor),
			});
		/**
		 * States no outcome. This is the easiest sentence in the slice to get wrong. None of these can be
		 * used: `report received` (already in the past), `report approved` or `report dismissed` (internal decisions, and
		 * the contract does not carry those values), or `we sanctioned them` (claims an action this row cannot
		 * verify). The only fact left is that review finished. Status is drawn by the `My reports` list, which
		 * knows only two values: `Under review` and `Reviewed`.
		 */
		case "report_reviewed":
			return t("message.reportReviewed");
		case "moderation_action":
			return t("message.moderationAction");
		case "moderation_reversed":
			return t("message.moderationReversed");
		/**
		 * States end of support, not a release. The point is not to write `a new version is out` (a new version is
		 * out). The event creating this row is a raised minimum version, and the minimum means versions
		 * below it are no longer accepted. Written as release promotion, this kind would become a general
		 * broadcast tool.
		 *
		 * The platform is named on the second line. Put first, it would hit web-only users with a
		 * sentence starting with 'iOS' that does not concern them. They only need to know it is
		 * irrelevant, which the detail line provides.
		 */
		case "app_update":
			return t("message.appUpdate");
		case "appeal_resolved":
			/**
			 * The outcome goes in the sentence, but processing notes do not. The member-facing appeal type
			 * has no such field (`MyAppealDto`), and details are drawn by the account screen.
			 */
			switch (notification.appeal?.status) {
				case "accepted":
					return t("message.appealAccepted");
				case "rejected":
					return t("message.appealRejected");
				default:
					return t("message.appealResolved");
			}
	}
}

/**
 * The one line under the sentence carries only the public reason. If it is empty, nothing is drawn
 * (the contract allows an empty string). The row then names only the action type, and details are
 * on the account screen.
 */
export function notificationDetail(notification: Notification): string | null {
	/**
	 * Only the new-work notice uses the work title as its second line. It takes the value that dropped
	 * out of the first line because of the particle (see the copy comment above). Quotes follow the
	 * same rule as in comment sentences: without them, a title that reads like a sentence has no clear
	 * end.
	 *
	 * For a deleted work, no empty quotes are kept, since that would look like broken data. What
	 * happened is only that the destination disappeared. The row stands on its first sentence alone.
	 */
	if (notification.kind === "creator_story_published")
		return notification.story ? `"${notification.story.title}"` : null;
	/**
	 * App-minimum notices take their second line from stored values: both platform and version. Looking up
	 * the current minimum and drawing that would make a row announcing 1.2.0 appear to announce 1.4.0.
	 * That lie raises no error, and users would read it as a notice saying something they were never
	 * told.
	 */
	if (notification.kind === "app_update")
		return translator("notifications")("message.appUpdateDetail", {
			platform: APP_PLATFORM_LABEL[notification.appPlatform],
			version: notification.appVersion,
		});
	if (
		notification.kind !== "moderation_action" &&
		notification.kind !== "moderation_reversed"
	)
		return null;
	return notification.action?.publicReason || null;
}

/**
 * The one-character initial shown in social-notification markers. It is cut with `Array.from`.
 * String indexing (`name[0]`, `slice(0, 1)`) splits surrogate pairs, so a nickname starting with an
 * emoji would draw a broken half-character inside the circle (a literal ZWJ emoji string indexed
 * with [0] does exactly this). The inbox receives user-chosen names as-is, so this input really
 * occurs.
 *
 * Same rule as `profileInitial` in `@rowcat/domain`, but not called, because of types. That
 * function takes a full `PublicProfile`, while a notification actor is a subset of three fields and
 * cannot be passed. Widening that function's parameters would change a domain contract for this one
 * screen, so the same rule lives here under the copy layer's name.
 *
 * If there is no character to take, the result is an empty string. No symbol such as a question
 * mark is invented; the caller draws an icon suited to the kind.
 */
export function notificationActorInitial(
	actor: NotificationActor | null,
): string {
	const name = notificationActorName(actor).trim();
	return Array.from(name)[0]?.toUpperCase() ?? "";
}

/**
 * A quiet line next to the title, e.g. `4 unread`. Unknown and zero are kept apart
 * (§119). A count not yet returned is `null`, and then the line is absent entirely: drawing `0 unread`
 * first would reverse what the screen had already said once the value arrived.
 *
 * Zero is not drawn either. That nothing is unread is already shown by the list and by the
 * disappearance of `Mark all read`. Putting a 0 here would give an empty inbox one more state.
 *
 * It does not use the badge vocabulary (`notificationBadgeLabel`). The badge's `99+` gives up
 * precision to fit beside an icon; this spot has no such constraint. It follows the rule against
 * abbreviating metrics and prints the exact number with thousands separators.
 */
export function notificationUnreadSummary(count: number | null): string | null {
	if (count === null || count <= 0) return null;
	return translator("notifications")("unreadSummary", {
		count: formatNumber(count),
	});
}
