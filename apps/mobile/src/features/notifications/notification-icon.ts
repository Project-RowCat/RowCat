import type { Notification } from "@rowcat/domain";
import type { IconName } from "@rowcat/ui-native";

/**
 * Notification kind → the semantic name of the leading row icon. Same table as the web
 * `NotificationIcon`.
 *
 * It is a pure module because this app's tests never render. Inside the row component, the only way
 * to check that enforcement and report review do not fold into one glyph would be the simulator.
 *
 * Social events (follow, comment) can show the actor's initial instead. That decision belongs to
 * the row: when `notificationActorInitial` returns an empty string, the row falls through to this
 * table.
 *
 * Enforcement (`moderation`) and report review (`report`) must keep different glyphs. With one
 * shared icon, "my report was closed" and "my account was sanctioned" look identical in a list, yet
 * the user must act in opposite ways (the web uses `Flag` and `Gavel` for this).
 */
export function notificationIconName(notification: Notification): IconName {
	switch (notification.kind) {
		case "follow":
			return "follow-add";
		/**
		 * Replies use the comment icon. They share a destination (the work) and a user action. A separate
		 * glyph would suggest a difference in meaning when only the sentence's subject differs.
		 */
		case "story_comment":
		case "comment_reply":
			return "comment";
		/**
		 * A single-work event uses the work icon (`story-detail` = `BookOpen`), the same glyph the web
		 * uses in this slot. Reusing the follow icon would make the two look alike, though tapping them
		 * leads to different places.
		 */
		case "creator_story_published":
			return "story-detail";
		case "moderation_action":
			return "moderation";
		case "moderation_reversed":
			return "moderation-reversed";
		case "report_reviewed":
			return "report";
		/** Same slot as the web's default icon (`Bell`). Kinds without a dedicated glyph land here. */
		case "appeal_resolved":
		case "app_update":
			return "notifications";
	}
}
