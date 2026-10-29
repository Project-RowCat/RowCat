import type { Notification } from "@rowcat/domain";

/**
 * The web app decides where a notification leads. The server sends neither an href nor a route
 * name, only the event meaning and identifiers. A later Expo client maps the same response to its
 * own navigation, so a web address from the server would be unusable there.
 *
 * Keep this a pure function so destination rules can be checked without rendering a component.
 *
 * Return a discriminated union, not a URL string. The router's Link needs a literal `to`, and a
 * string built here would escape type checking when routes change.
 */
export type NotificationDestination =
	| { kind: "creator"; creatorId: string }
	| { kind: "story"; storyId: string }
	| { kind: "account" };

/**
 * A null destination means the row is not navigable. This happens in two cases:
 * - The actor has left, so there is no profile to open.
 * - The story was removed, so there is no detail page to open.
 *
 * No address is sent in these cases. Navigating to a missing URL shows a 404, which reads as the
 * notification system being broken, while the real cause is only that the target is gone. The row
 * stays and is only marked as read.
 *
 * All three moderation kinds go to `/account`. That screen's sections already render the full state
 * of a sanction (active actions, restrictions, appeals, public reasons). A second copy in the
 * notification would drift from it, and the two would eventually disagree.
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
		 * Replies (`comment_reply`) and story comments (`story_comment`) both link to the story, not to
		 * the comment or its thread (V1).
		 *
		 * `commentId` is in the contract but unused. Anchoring to a reply requires the list to know the
		 * parent's position, whether its thread must be expanded, and the reply's position inside it.
		 * That interacts with both cursor paginations. When that feature exists, this return changes.
		 */
		case "comment_reply":
		case "story_comment":
			return notification.story
				? { kind: "story", storyId: notification.story.id }
				: null;
		/**
		 * A new story publication links to the story itself, not to the creator's profile.
		 *
		 * This differs from follow notifications. A follow is about the person, so their profile is the
		 * canonical destination. A story publication points at one work. Sending the user to the profile
		 * would force them to find that story again in a list.
		 *
		 * If the story is gone, there is no destination, as with comments. Even though the creator still
		 * exists, do not fall back to their profile. The user expects the story, and the substitution
		 * would read as the notification having gone somewhere else.
		 */
		case "creator_story_published":
			return notification.story
				? { kind: "story", storyId: notification.story.id }
				: null;
		case "moderation_action":
		case "moderation_reversed":
		case "appeal_resolved":
			return { kind: "account" };
		/**
		 * A report-review notification also goes to `/account`, which has a `My reports` section.
		 *
		 * It does not point to a specific report. The contract has no `reportId`, and the absence is
		 * intentional. Highlighting one report would require searching the cursor-paginated list, where
		 * it may not be on the first page. More importantly, the reporter's task on that screen is to
		 * scan what is pending and what is finished, not to reread a single case.
		 *
		 * It does not go to the operations console. The notification's audience is the reporter, not an
		 * operator, and the operations UI is now a separate app (`apps/admin`). From this app, the only
		 * route there is a link on the account screen, shown only to `canModerate` accounts. A
		 * destination the user cannot open is worse than no destination at all.
		 */
		case "report_reviewed":
			return { kind: "account" };
		/**
		 * An app update announcement goes nowhere.
		 *
		 * There is no destination. The action it asks for, updating the app in the store, has no web
		 * route. Store links (`market://`, `itms-apps://`) are dead links in a desktop browser. Sending
		 * the user to a nonexistent target shows a 404, which reads as broken, while nothing actually
		 * went wrong. The row stays and is only marked as read, the same as a departed actor or a removed
		 * story.
		 *
		 * For this reason the union has no external-URL variant. Once one exists, a notification could
		 * send people to an arbitrary address, and the origin of that address is ultimately the server
		 * response. Sending the user to the store belongs to the mobile slice, which knows its platform
		 * and can render a link that actually opens.
		 */
		case "app_update":
			return null;
	}
}
