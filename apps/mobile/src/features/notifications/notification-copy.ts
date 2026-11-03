import {
	type AppUpdatePlatform,
	isUnread,
	type Notification,
	type NotificationActor,
	type NotificationAttention,
} from "@rowcat/domain";
import { deferredGroup, translator } from "../../lib/i18n/instance.ts";

/**
 * The copy for one notification row, built here rather than on the server.
 *
 * The notification table stores no finished sentence, and this app is the direct beneficiary: if
 * the server sent Korean text, this file could not exist and every web copy change would also be an
 * app change. So this file does not import the web's `notification-copy.ts`; it keeps the same
 * sentences under its own name. Sameness is intended (one event reads the same in both apps). If
 * they must diverge, each file diverges separately.
 *
 * The sentences live in the dictionaries (`notifications`, English and Korean); this module names
 * them. Pure functions, so they can be checked without rendering. Copy scattered through components would
 * make questions like "what does the notice for a comment by a departed member say?" require a
 * simulator.
 *
 * ## What does not come here
 *
 * **Comment bodies.** A row shows only who commented on which work; the text lives on the work.
 * This keeps a moderated comment's text from surviving only in notifications.
 *
 * **Operator internal reasons and enforcement dispositions.** The contract has no such fields, so
 * this file cannot draw them by mistake. The absence is recorded as intentional.
 */

/**
 * The screen's fixed copy: title, empty state, offline · failure · stale bands, retry, `Show more`,
 * `Mark all read` and its failure, the guest invitation and the session-check failure.
 *
 * `Mark all read` is not optimistic (`@rowcat/query`): on failure the badge and list are unchanged, so
 * the failure gets its own sentence, kept inline next to the button (this app has no toast system).
 * Marking one row read is different — there navigation is the action and a silent rollback is enough.
 * A guest gets the reason before the login offer (the same judgment as `/chats`), and the session
 * failure is **not a sign-out**: the stored session is intact; we simply could not ask the server.
 */
export const NOTIFICATIONS_COPY = deferredGroup("notifications", "screen");

/**
 * The two tabs on this screen. The first is not named `Notifications`: the bar already says that, and
 * repeating the word would stack the same text twice and blur the relationship between the tabs
 * (`Notifications › Notifications` distinguishes nothing).
 *
 * The `Record` is intentional: adding a tab breaks compilation, as it does for the other shared
 * vocabulary tables. Before adding a third tab, first decide whether it is a different domain. The
 * container accepting a tab is no reason to add an axis to the inbox.
 */
export type NotificationsTab = "general" | "updates";

export const NOTIFICATIONS_TAB_LABEL: Record<NotificationsTab, string> =
	deferredGroup("notifications", "tab");

const t = () => translator("notifications");

/**
 * The fact that a new update exists, as part of the tab's and the bell's name. The web adds an
 * invisible text node; native has no such mechanism, and a dot alone conveys the state only through
 * color and shape. The English is the domain's `UPDATE_UNSEEN_LABEL_SUFFIX`, held equal by a test.
 */
export const unseenUpdateSuffix = (): string => t()("unseenUpdate");

/**
 * The bell's accessible name in the drawn language. `notificationAttention` still decides everything
 * (the badge, its `99+` cap, the dot, that an update hidden behind a count still appears in the name);
 * only the words around its badge are assembled here — the web bell's `bellLabel` does the same. The
 * English equals the domain's `notificationBellLabel`, held equal by a test.
 */
export function notificationBellName(
	attention: Pick<NotificationAttention, "badge">,
	unseenUpdate: boolean,
): string {
	const base =
		attention.badge === null
			? t()("bell.label")
			: t()("bell.unread", { badge: attention.badge });
	return unseenUpdate ? `${base}${unseenUpdateSuffix()}` : base;
}

/**
 * Store platform labels, as a single table. Product names, so not dictionary entries.
 *
 * `Record<AppUpdatePlatform, string>`, so adding a platform to the shared vocabulary breaks
 * compilation here. A ternary would silently fold a third platform into one of the two.
 */
const APP_PLATFORM_LABEL: Record<AppUpdatePlatform, string> = {
	ios: "iOS",
	android: "Android",
};

/**
 * Display name for the actor.
 *
 * An empty nickname and a departed account are **not folded into one phrase**. Someone with a blank
 * name still exists (`No name`); a departed person does not. One phrase for both would make the
 * screen unable to express the difference. The web's same function has the same rule.
 */
export function notificationActorName(actor: NotificationActor | null): string {
	/** A departed actor's name is not kept as a snapshot, so it is filled in here. */
	if (!actor) return t()("deletedActor");
	return actor.displayName || t()("unnamed");
}

/**
 * One sentence of the row's body, identical to the web's.
 *
 * Titles are wrapped in quotes deliberately. A notification whose work is gone does not invent a
 * title; it changes the sentence instead. An empty pair of quotes (`commented on ""`) would look like
 * broken data.
 */
export function notificationMessage(notification: Notification): string {
	switch (notification.kind) {
		case "follow":
			return t()("message.follow", {
				who: notificationActorName(notification.actor),
			});
		/**
		 * **The subject differs from `story_comment`**: "on your comment", not "on your work". The
		 * recipient is the author of that comment, not the work owner. Someone replying to your comment
		 * on another person's work is exactly this case (same sentence as the web).
		 */
		case "comment_reply": {
			const who = notificationActorName(notification.actor);
			return notification.story
				? t()("message.commentReply", { who, title: notification.story.title })
				: t()("message.commentReplyUntitled", { who });
		}
		case "story_comment": {
			const who = notificationActorName(notification.actor);
			return notification.story
				? t()("message.storyComment", { who, title: notification.story.title })
				: t()("message.storyCommentUntitled", { who });
		}
		/**
		 * **The title does not enter this sentence** — the second line draws it (`notificationDetail`).
		 *
		 * The reason is length and shape. Splicing the title into this sentence (`published "The Night Library"`)
		 * makes the row's first line as long as whatever title a person chose, and choosing how to fold it in code
		 * is wrong again for titles in other scripts. The comment sentence uses `on "Title"`, which reads the same
		 * depend on the final consonant; this sentence has no particle at all. The web's same function
		 * reached the same judgment, and the two apps' sentences must match.
		 */
		case "creator_story_published":
			return t()("message.published", {
				who: notificationActorName(notification.actor),
			});
		/**
		 * **Does not state an outcome.** `Approve`, `dismissed` and `Action taken` are all unusable here: the internal
		 * disposition is not carried in the contract, and not sending it is intentional. One fact
		 * remains: the review is complete.
		 */
		case "report_reviewed":
			return t()("message.reportReviewed");
		case "moderation_action":
			return t()("message.moderationAction");
		case "moderation_reversed":
			return t()("message.moderationReversed");
		/**
		 * **States end of support, not a release.** It does not say "a new version is out": the event
		 * that creates this row is a raised floor, and a floor means *versions below it are no longer
		 * accepted*.
		 */
		case "app_update":
			return t()("message.appUpdate");
		case "appeal_resolved":
			/**
			 * The outcome goes in the sentence, but **the reviewer's note does not**. A row whose reference
			 * is gone does not invent an outcome; it folds to a neutral sentence.
			 */
			switch (notification.appeal?.status) {
				case "accepted":
					return t()("message.appealAccepted");
				case "rejected":
					return t()("message.appealRejected");
				default:
					return t()("message.appealResolved");
			}
	}
}

/**
 * The quiet line below the sentence: only the **stored value** and the **public reason**.
 *
 * For app floors the second line comes from values fixed on the notification row. Drawing it from
 * the current floor would make every old notification point at the newest announcement, and that
 * lie raises no error.
 */
export function notificationDetail(notification: Notification): string | null {
	/**
	 * Only new-publication notices use the **work title** as the second line. The title that dropped
	 * out of the first line for particle reasons appears here. A vanished work shows no empty quotes.
	 */
	if (notification.kind === "creator_story_published")
		return notification.story ? `"${notification.story.title}"` : null;
	if (notification.kind === "app_update")
		return t()("appUpdateDetail", {
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
 * One initial character, drawn by the social-event badge.
 *
 * Cut with `Array.from`. String indexing (`name[0]`, `slice(0, 1)`) splits surrogate pairs, so a
 * nickname starting with an emoji would draw a broken half-character inside the circle. The inbox
 * receives names other people chose, so this input really occurs (the web's same function exists
 * for the same reason).
 *
 * With nothing to take, returns the empty string. Do not invent a placeholder symbol; the caller
 * draws an icon that fits the kind.
 */
export function notificationActorInitial(
	actor: NotificationActor | null,
): string {
	const name = notificationActorName(actor).trim();
	return Array.from(name)[0]?.toUpperCase() ?? "";
}

/**
 * The quiet line beside the title: `4 unread`.
 *
 * **Unknown is distinct from zero.** While the count is still unanswered it is `null`, and this
 * line is absent; drawing `0 unread` first would reverse what the screen already said when the
 * value arrived. Zero is not drawn either.
 *
 * **Does not use the badge vocabulary (`99+`).** The badge gives up precision for a few pixels
 * beside an icon. This location has no such constraint, and the app's rule of not abbreviating
 * numbers applies.
 */
export function notificationUnreadSummary(count: number | null): string | null {
	if (count === null || count <= 0) return null;
	return t()("unreadSummary", { total: count.toLocaleString("en-US") });
}

/**
 * Whether `Mark all read` is drawn. **An unknown count is not zero.**
 *
 * Drawing the button on `null` (not yet known, or the lookup failed) would stand on a fact nobody
 * confirmed ("there is something unread"). Drawing it on zero would produce a disabled button that
 * does not say why it cannot be pressed.
 */
export const canMarkAllRead = (unread: number | null): boolean =>
	unread !== null && unread > 0;

/**
 * The row's accessible name: **the sentence plus the state.**
 *
 * The sentence is already visible text in the row, so this duplicates it. But the unread fact lives
 * only in visual signals (a dot, a background), and without including it here it is not conveyed.
 */
export function notificationRowLabel(notification: Notification): string {
	const message = notificationMessage(notification);
	/** The predicate is one domain function (`isUnread`); do not write `readAt === null` here again. */
	return isUnread(notification) ? t()("unreadRow", { message }) : message;
}
