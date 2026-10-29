import {
	type AppUpdatePlatform,
	isUnread,
	type Notification,
	type NotificationActor,
} from "@rowcat/domain";

/**
 * The copy for one notification row, built here rather than on the server.
 *
 * The notification table stores no finished sentence, and this app is the direct beneficiary: if
 * the server sent Korean text, this file could not exist and every web copy change would also be an
 * app change. So this file does not import the web's `notification-copy.ts`; it keeps the same
 * sentences under its own name. Sameness is intended (one event reads the same in both apps). If
 * they must diverge, each file diverges separately.
 *
 * Pure functions, so they can be checked without rendering. Copy scattered through components would
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

export const NOTIFICATIONS_TITLE = "Notifications";

export const NOTIFICATIONS_EMPTY = "No notifications yet.";

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

export const NOTIFICATIONS_TABS_LABEL = "Notification types";

export const NOTIFICATIONS_TAB_LABEL: Record<NotificationsTab, string> = {
	general: "General",
	updates: "Updates",
};

/**
 * The fact that a new update exists, as part of the tab name.
 *
 * The web adds an invisible text node to the tab; native has no such mechanism. A dot alone would
 * convey the state only through color and shape, and assistive tech would receive nothing.
 */
export const NOTIFICATIONS_TAB_UNSEEN_SUFFIX = ", new update available";

/** The two states that draw no list. Pause and failure are different facts. */
export const NOTIFICATIONS_OFFLINE =
	"Not connected right now. Notifications load again once connected.";
export const NOTIFICATIONS_ERROR = "Couldn't load notifications.";

/**
 * Values are on screen but the last refresh failed, whether or not rows exist.
 *
 * Same band and sentence as the web. It says "state", not "notifications": an inbox the server
 * reported as empty can also show this band, and "showing previously received notifications" would
 * not make sense on a screen with none to show.
 */
export const NOTIFICATIONS_STALE =
	"The last refresh failed, so the previous state is shown.";

export const NOTIFICATIONS_RETRY_LABEL = "Try again";
export const NOTIFICATIONS_MORE_LABEL = "Show more";
export const NOTIFICATIONS_MORE_BUSY_LABEL = "Loading…";
export const NOTIFICATIONS_MARK_ALL_LABEL = "Mark all read";

/**
 * `Mark all read` failed.
 *
 * This operation is not optimistic (`@rowcat/query`): on failure the badge and list are unchanged,
 * so the screen cannot distinguish "the button did nothing" from "the button failed". The failure
 * therefore gets its own sentence. This app has no toast system and this one notice does not
 * justify building one: the failure stays as inline guidance next to the button, and retry is the
 * button that is still there.
 *
 * **This differs from the failure of marking one row read.** There, the user's requested action is
 * navigation and marking read is a side effect, so a silent rollback is enough. Speaking about the
 * notification after the screen has already moved would attach a sentence unrelated to what they
 * just did.
 */
export const NOTIFICATIONS_MARK_ALL_READ_FAILED =
	"Couldn't mark all notifications as read. Please try again in a moment.";

/**
 * Guest: explain why the inbox cannot be viewed before offering login, rather than bouncing to
 * login (the same judgment as `/chats`).
 */
export const NOTIFICATIONS_GUEST = {
	title: "Sign in to see notifications",
	description: "Follows, comments and account notices arrive in this inbox.",
	action: "Sign in",
} as const;

/** **Not a sign-out.** The stored session is intact; we simply could not ask the server. */
export const NOTIFICATIONS_UNAVAILABLE =
	"Couldn't check your session. Please try again in a moment.";

/**
 * Store platform labels, as a single table.
 *
 * `Record<AppUpdatePlatform, string>`, so adding a platform to the shared vocabulary breaks
 * compilation here. A ternary would silently fold a third platform into one of the two.
 */
const APP_PLATFORM_LABEL: Record<AppUpdatePlatform, string> = {
	ios: "iOS",
	android: "Android",
};

/** Placeholder for a departed actor. The name is not kept as a snapshot, so it is filled in here. */
const DELETED_ACTOR = "Deleted user";

/**
 * Display name for the actor.
 *
 * An empty nickname and a departed account are **not folded into one phrase**. Someone with a blank
 * name still exists (`No name`); a departed person does not. One phrase for both would make the
 * screen unable to express the difference. The web's same function has the same rule.
 */
export function notificationActorName(actor: NotificationActor | null): string {
	if (!actor) return DELETED_ACTOR;
	return actor.displayName || "No name";
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
			return `${notificationActorName(notification.actor)} followed you.`;
		/**
		 * **The subject differs from `story_comment`**: "on your comment", not "on your work". The
		 * recipient is the author of that comment, not the work owner. Someone replying to your comment
		 * on another person's work is exactly this case (same sentence as the web).
		 */
		case "comment_reply": {
			const who = notificationActorName(notification.actor);
			return notification.story
				? `${who} replied to your comment on "${notification.story.title}".`
				: `${who} replied to your comment.`;
		}
		case "story_comment": {
			const who = notificationActorName(notification.actor);
			return notification.story
				? `${who} commented on "${notification.story.title}".`
				: `${who} commented on your story.`;
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
			return `${notificationActorName(notification.actor)} published a new story.`;
		/**
		 * **Does not state an outcome.** `Approve`, `dismissed` and `Action taken` are all unusable here: the internal
		 * disposition is not carried in the contract, and not sending it is intentional. One fact
		 * remains: the review is complete.
		 */
		case "report_reviewed":
			return "We reviewed your report.";
		case "moderation_action":
			return "A moderation action was applied to your account.";
		case "moderation_reversed":
			return "A moderation action on your account was lifted.";
		/**
		 * **States end of support, not a release.** It does not say "a new version is out": the event
		 * that creates this row is a raised floor, and a floor means *versions below it are no longer
		 * accepted*.
		 */
		case "app_update":
			return "An app update is required.";
		case "appeal_resolved":
			/**
			 * The outcome goes in the sentence, but **the reviewer's note does not**. A row whose reference
			 * is gone does not invent an outcome; it folds to a neutral sentence.
			 */
			switch (notification.appeal?.status) {
				case "accepted":
					return "Your appeal was accepted.";
				case "rejected":
					return "Your appeal was not accepted.";
				default:
					return "Your appeal has a result.";
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
		return `${APP_PLATFORM_LABEL[notification.appPlatform]} app versions below ${notification.appVersion} are no longer supported.`;
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
	return `${count.toLocaleString("en-US")} unread`;
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
	return isUnread(notification) ? `Unread, ${message}` : message;
}
