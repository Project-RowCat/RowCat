import { isUnread, type Notification } from "@rowcat/domain";

/**
 * Where a notification leads. This app decides, not the server: the server sends neither an `href`
 * nor a route name, only the event meaning and identifiers, and the one rule that turns them into a
 * move in this app lives here. The web's `notification-destination.ts` is deliberately not
 * imported, since the two apps' route lists differ.
 *
 * Moderation notifications (`moderation_action`, `moderation_reversed`, `appeal_resolved`,
 * `report_reviewed`) go to `/account`, as they do on the web. That screen's restriction and
 * own-report sections are the canonical surface; the notification only points there, so its copy
 * never adds the action or the internal reason. There is no section anchor (`/account?section=…`):
 * this app has no such address vocabulary, and both sections sit just below the profile. No target
 * id is invented either, because these events concern the account's state, not a specific work or
 * comment.
 *
 * `app_update` has no destination. Its action is to update the app in the store, which belongs to
 * the slice that reads the floor and draws the blocking screen: that screen knows the platform and
 * the link actually opens. The notification renderer does not hard-code `itms-apps://`.
 *
 * Keeping this a pure function matters because this app's tests never render a screen. If the rules
 * sat in component `if`s, checking where a follow from a departed actor leads would require a
 * simulator.
 */
export type NotificationDestination =
	| { kind: "creator"; creatorId: string }
	| { kind: "story"; storyId: string }
	/**
	 * Account screen, the canonical surface for restrictions, appeals and own reports. The value
	 * carries meaning, not an address: `navigateTo` in `general-notifications.tsx` maps it to
	 * `/account`.
	 */
	| { kind: "account" };

/**
 * Destination, or `null` when the row has nowhere to go and pressing it does not navigate. A
 * departed actor or a vanished work has no target. Sending it to a missing address to show "work
 * not found" would read as a broken notification, when all that happened is that the target
 * disappeared. The row stays and is still marked read.
 */
export function notificationDestination(
	notification: Notification,
): NotificationDestination | null {
	switch (notification.kind) {
		case "follow":
			return notification.actor
				? { kind: "creator", creatorId: notification.actor.id }
				: null;
		/**
		 * Replies go to the work, not the thread, and the comment anchor is not used (V1, matching the
		 * web). An anchor needs the parent's page position and the reply's position in the thread, which
		 * couples with two cursor paginations. When that feature exists, only this return changes.
		 */
		case "comment_reply":
		case "story_comment":
			return notification.story
				? { kind: "story", storyId: notification.story.id }
				: null;
		/**
		 * A new work goes to the work, not the creator profile (matches the web). Follows differ: a
		 * follow is about the person, so their profile is canonical, while this event is about one work.
		 * A vanished work has no target and does not fall back to the profile, since the actor still
		 * existing is no reason to send someone elsewhere.
		 */
		case "creator_story_published":
			return notification.story
				? { kind: "story", storyId: notification.story.id }
				: null;
		/** Account screen. Its sections answer the details, so neither the action nor a target id is passed. */
		case "moderation_action":
		case "moderation_reversed":
		case "appeal_resolved":
		case "report_reviewed":
			return { kind: "account" };
		case "app_update":
			return null;
	}
}

/**
 * What happens when a row is pressed. Read marking and navigation are two independent facts, so
 * they are decided together here. A row without a destination is still marked read, so it does not
 * look broken. Re-pressing an already read row sends no request: the server is idempotent, but the
 * request would change nothing and would fire on every tap.
 *
 * Navigation does not wait for the read request. That ordering belongs to the hook and screen
 * wiring, which fire the read with `mutate` and navigate immediately. This decides what happens,
 * not when.
 */
export interface NotificationActivationPlan {
	/** Notification id to mark read. `null` when it is already read, so no request is made. */
	markReadId: string | null;
	destination: NotificationDestination | null;
}

export function notificationActivationPlan(
	notification: Notification,
): NotificationActivationPlan {
	return {
		markReadId: isUnread(notification) ? notification.id : null,
		destination: notificationDestination(notification),
	};
}
