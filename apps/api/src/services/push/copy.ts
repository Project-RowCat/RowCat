import type { NotificationKind } from "@rowcat/contracts";
import { APP_NAME } from "@rowcat/domain";

/**
 * Push copy: text that stands on the lock screen, not the inbox wording.
 *
 * ## Not pulled from the apps' `notification-copy.ts`
 *
 * Each app owns its own copy. Lifting overlapping strings to the server would make wording the
 * server's and break the notification contract's rule that it sends only the meaning of the event,
 * which is why both apps build their own text and navigation from one response.
 *
 * These sentences belong to a different surface. The inbox row draws names, story titles and
 * reasons (only that person reads it); this text is readable by people who are not the owner, so
 * two copies is a boundary, not duplication.
 *
 * ## What never reaches the lock screen
 *
 * ```text
 * comment body · conversation content · prompt · report target · report reason · internal
 * moderation reason · operator identity · email · member id · database id · source_key · push token
 * actor nickname · story title
 * ```
 *
 * The last two are the easy ones to get wrong. The inbox DTO carries them because it is the
 * signed-in owner's screen. The lock screen is seen by people who have not unlocked the device,
 * flows into screenshots and notification previews, and is stored by the OS; *who* followed would
 * go somewhere we cannot erase.
 *
 * ## All titles are the same
 *
 * A per-kind title is itself classification information (one `Moderation action` banner tells the person next
 * to you the state of that account). The title is the app name; the body line says what happened.
 *
 * ## The table is a `Record` on purpose
 *
 * A new notification kind breaks this file at compile time. A fallback to default copy would send
 * the new kind out as an empty sentence like "a notification arrived", with no symptom.
 */

export interface PushCopy {
	title: string;
	body: string;
}

/** Title of every push; it does not vary by kind, for the reason in the header. */
export const PUSH_TITLE = APP_NAME;

const PUSH_BODY: Record<NotificationKind, string> = {
	follow: "You have a new follower.",
	story_comment: "Your story has a new comment.",
	/**
	 * Neither story title nor reply body appears, per the header. The inbox row shows who replied on
	 * which story (the signed-in owner's screen), but this text is read by people without the device
	 * unlocked and stored by the OS; which discussion I take part in would go somewhere we cannot
	 * erase.
	 */
	comment_reply: "Your comment has a new reply.",
	/**
	 * Neither creator name nor story title appears. The inbox row draws both (the signed-in owner's
	 * screen), but this text is read by people without the device unlocked and stored by the OS;
	 * *whom* I follow would go somewhere we cannot erase.
	 */
	creator_story_published: "A creator you follow published a new story.",
	moderation_action: "A moderation action was applied to your account.",
	moderation_reversed:
		"A moderation action applied to your account was lifted.",
	appeal_resolved: "Your appeal result is in.",
	report_reviewed: "We reviewed your report.",
	app_update: "An app update is required.",
};

/**
 * Lock-screen copy for that kind; `null` outside the vocabulary. The only practical path to `null`
 * is a database row with a `kind` we do not know (old-version or hand-inserted row). Not sending
 * beats sending an invented sentence: the inbox still has the row, and the user sees it on opening
 * the app.
 */
export function pushCopyFor(kind: string): PushCopy | null {
	const body = PUSH_BODY[kind as NotificationKind];
	return body ? { title: PUSH_TITLE, body } : null;
}
