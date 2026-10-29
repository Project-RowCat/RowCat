import type { Notification } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import {
	notificationActorInitial,
	notificationActorName,
	notificationDetail,
	notificationMessage,
	notificationsMarkAllReadFailed,
	notificationUnreadSummary,
} from "./notification-copy.ts";
import { notificationDestination } from "./notification-destination.ts";

/**
 * The meaning of a notification row: where it goes and what it says, checked without rendering. The
 * file guards rules, not markup. Three are easy to miss even on screen:
 * - A departed actor or removed work has no destination. Sending it to a missing address would
 *   show a 404.
 * - All moderation kinds go to the account screen. No second sanctions screen lives inside
 *   notifications.
 * - Comment bodies and internal reasons never appear in copy. If they did, that would be a leak.
 */

const base = { id: "n1", createdAt: "2026-08-20T00:00:00.000Z", readAt: null };

const actor = { id: "m-bob", displayName: "Cat", avatarUrl: null };

const follow = (withActor = true): Notification => ({
	...base,
	kind: "follow",
	actor: withActor ? actor : null,
});

const appUpdate = (
	appPlatform: "ios" | "android" = "ios",
	appVersion = "1.4.0",
): Notification => ({
	...base,
	kind: "app_update",
	appPlatform,
	appVersion,
});

const reportReviewed = (): Notification => ({
	...base,
	kind: "report_reviewed",
});

const comment = (
	story: { id: string; title: string } | null = {
		id: "s1",
		title: "Night Library",
	},
): Notification => ({
	...base,
	kind: "story_comment",
	actor,
	story,
	commentId: "c1",
});

const storyPublished = (
	story: { id: string; title: string } | null = {
		id: "s-new",
		title: "The Store That Rewinds Night",
	},
	withActor = true,
): Notification => ({
	...base,
	kind: "creator_story_published",
	actor: withActor ? actor : null,
	story,
});

const commentReply = (
	story: { id: string; title: string } | null = {
		id: "s1",
		title: "Night Library",
	},
): Notification => ({
	...base,
	kind: "comment_reply",
	actor,
	story,
	commentId: "r1",
});

describe("notificationDestination", () => {
	it("a follow goes to that person's public profile", () => {
		expect(notificationDestination(follow())).toEqual({
			kind: "creator",
			creatorId: "m-bob",
		});
	});

	/**
	 * A departed user's profile returns 404. Sending the row there would make the notification look
	 * broken.
	 */
	it("a follow by a departed actor has no destination", () => {
		expect(notificationDestination(follow(false))).toBeNull();
	});

	it("a comment goes to the story detail", () => {
		expect(notificationDestination(comment())).toEqual({
			kind: "story",
			storyId: "s1",
		});
	});

	it("a comment on a vanished story has no destination", () => {
		expect(notificationDestination(comment(null))).toBeNull();
	});

	/**
	 * Differs from follow notices. A follow concerns that person, so their profile is the canonical
	 * destination. This row reports one work. Sending it to the profile would force the user to find
	 * that work again in a list.
	 */
	it("a new story goes to that story", () => {
		expect(notificationDestination(storyPublished())).toEqual({
			kind: "story",
			storyId: "s-new",
		});
	});

	/**
	 * When the work is gone, do not send the user to the actor's profile instead, even though the
	 * actor still exists. That is not the screen the user expected, and the substitution reads as 'the
	 * notification went somewhere else'.
	 */
	it("a publish notice for a vanished story has no destination — it does not go to the profile instead", () => {
		expect(notificationDestination(storyPublished(null))).toBeNull();
		expect(notificationDestination(storyPublished(null, true))).toBeNull();
	});

	/**
	 * Sending the three moderation kinds to the same place is this slice's decision (§108). Redrawing
	 * active actions, restrictions and appeals inside the notification would make two places state the
	 * same facts, and those two would inevitably diverge.
	 */
	it("moderation kinds all go to the account screen", () => {
		const kinds = [
			{ ...base, kind: "moderation_action", action: null },
			{ ...base, kind: "moderation_reversed", action: null },
			{ ...base, kind: "appeal_resolved", appeal: null },
		] as Notification[];
		for (const notification of kinds)
			expect(notificationDestination(notification)).toEqual({
				kind: "account",
			});
	});

	/**
	 * Report-review completion also goes to the account screen, which has a `My reports` section. It must
	 * not go to the operator console: the audience is the person who filed the report, and the
	 * operator UI is a separate app (`apps/admin`). No destination is worse than one the person cannot
	 * open.
	 */
	it("report review completion goes to the account screen", () => {
		expect(notificationDestination(reportReviewed())).toEqual({
			kind: "account",
		});
	});

	/**
	 * App-update notices go nowhere. The action this row asks for is updating the app in the store,
	 * and that address is not a web route; on desktop browsers, store schemes are dead links. Sending
	 * it to a missing place would show a 404 and read as a broken notification.
	 *
	 * This assertion protects that absence. A change that opens an external-URL branch in the
	 * discriminated union would fail here first.
	 */
	it("an app update notice has no destination", () => {
		expect(notificationDestination(appUpdate())).toBeNull();
		expect(notificationDestination(appUpdate("android", "2.0.0"))).toBeNull();
	});
});

describe("notificationMessage", () => {
	it("follows and comments use the actor name", () => {
		expect(notificationMessage(follow())).toBe("Cat followed you.");
		expect(notificationMessage(comment())).toBe(
			'Cat commented on "Night Library".',
		);
	});

	it("a vanished story changes the sentence instead of inventing a title", () => {
		expect(notificationMessage(comment(null))).toBe(
			"Cat commented on your story.",
		);
	});

	it("a departed actor gets a neutral placeholder", () => {
		expect(notificationActorName(null)).toBe("Deleted user");
		expect(notificationMessage(follow(false))).toBe(
			"Deleted user followed you.",
		);
	});

	it("an empty nickname and a departure are not folded together", () => {
		expect(
			notificationActorName({ id: "m", displayName: "", avatarUrl: null }),
		).toBe("No name");
	});

	it("an app update notice states end of support, not a release", () => {
		const message = notificationMessage(appUpdate());
		expect(message).toBe("An app update is required.");
		expect(message).not.toMatch(/new version|released|has been updated/i);
		expect(message).not.toMatch(/iOS|Android/);
	});

	it("an appeal result distinguishes accepted from rejected", () => {
		const appeal = (status: "accepted" | "rejected"): Notification => ({
			...base,
			kind: "appeal_resolved",
			appeal: { id: "ap1", actionId: "act1", status },
		});
		expect(notificationMessage(appeal("accepted"))).toContain("was accepted");
		expect(notificationMessage(appeal("rejected"))).toContain(
			"was not accepted",
		);
	});

	/**
	 * A row whose appeal has disappeared still gets a sentence, so the list as a whole does not break.
	 */
	/**
	 * Guards the privacy boundary at the sentence level. Outcome words such as approved, rejected,
	 * sanctioned or deleted must not appear, since they would state what the team did, which this
	 * notification cannot know.
	 */
	it("report review completion states no outcome", () => {
		const message = notificationMessage(reportReviewed());
		expect(message).toBe("We reviewed your report.");
		for (const forbidden of [
			"approved",
			"dismissed",
			"rejected",
			"sanction",
			"deleted",
			"blocked",
			"suspended",
			" action",
		])
			expect(message).not.toContain(forbidden);
	});

	it("there is a sentence even without the appeal reference", () => {
		expect(
			notificationMessage({
				...base,
				kind: "appeal_resolved",
				appeal: null,
			} as Notification),
		).toBe("Your appeal has a result.");
	});
});

describe("notificationDetail", () => {
	it("only a moderation public reason becomes the second line", () => {
		expect(
			notificationDetail({
				...base,
				kind: "moderation_action",
				action: {
					id: "a1",
					kind: "suspend_member",
					publicReason: "Policy violation",
				},
			} as Notification),
		).toBe("Policy violation");
	});

	it("an empty public reason draws no second line", () => {
		expect(
			notificationDetail({
				...base,
				kind: "moderation_action",
				action: { id: "a1", kind: "suspend_member", publicReason: "" },
			} as Notification),
		).toBeNull();
	});

	it("the app update second line is the platform and version the notice carried", () => {
		expect(notificationDetail(appUpdate("ios", "1.4.0"))).toBe(
			"iOS app versions below 1.4.0 are no longer supported.",
		);
		expect(notificationDetail(appUpdate("android", "2.0.0"))).toBe(
			"Android app versions below 2.0.0 are no longer supported.",
		);
	});

	it("follows and comments have no second line", () => {
		expect(notificationDetail(follow())).toBeNull();
		expect(notificationDetail(comment())).toBeNull();
	});

	/**
	 * Report-review completion has no second line either. Anything that could fill it would be a
	 * target or an outcome, and the contract has no slot for either. This asserts that absence. Adding
	 * `Dismissed` to this row would require changing the contract first.
	 */
	it("report review completion has no second line", () => {
		expect(notificationDetail(reportReviewed())).toBeNull();
	});
});

describe("notificationActorInitial", () => {
	it("takes one character", () => {
		expect(notificationActorInitial(actor)).toBe("C");
	});

	it("Latin names are uppercased — the same rule as profile avatars", () => {
		expect(notificationActorInitial({ ...actor, displayName: "rowcat" })).toBe(
			"R",
		);
	});

	/**
	 * Does not split surrogate pairs. The earlier `slice(0, 1)` version drew broken half-characters
	 * and still passed compile and tests, so this test is the only guard.
	 */
	it("does not break a name starting with an emoji", () => {
		const initial = notificationActorInitial({
			...actor,
			displayName: "🐈‍⬛ Black cat",
		});
		expect(initial).not.toBe("");
		expect("🐈‍⬛".startsWith(initial)).toBe(true);
	});

	it("an empty nickname and a departure take from their own placeholders", () => {
		expect(notificationActorInitial({ ...actor, displayName: "" })).toBe("N");
		expect(notificationActorInitial(null)).toBe("D");
	});
});

describe("notificationUnreadSummary", () => {
	it("an unknown count draws nothing", () => {
		expect(notificationUnreadSummary(null)).toBeNull();
	});

	it("nothing unread draws nothing", () => {
		expect(notificationUnreadSummary(0)).toBeNull();
	});

	it("writes the exact count without abbreviation", () => {
		expect(notificationUnreadSummary(4)).toBe("4 unread");
		expect(notificationUnreadSummary(1247)).toBe("1,247 unread");
	});
});

describe("notificationsMarkAllReadFailed", () => {
	/**
	 * The message must tell the user what to do next. A failed `Mark all read` otherwise looks like the button
	 * did nothing.
	 */
	it("says to try again", () => {
		expect(notificationsMarkAllReadFailed()).toMatch(/try again/i);
	});

	/**
	 * The message must not contain wording that implies the mark was applied. Saying `partly processed` would state something never verified. The server's single UPDATE statement is
	 * the boundary, so either all of it went through or none did.
	 */
	it("does not imply partial success", () => {
		expect(notificationsMarkAllReadFailed()).not.toMatch(/partial|some of/i);
	});
});

describe("new story copy", () => {
	it("the first line says only who did what", () => {
		expect(notificationMessage(storyPublished())).toBe(
			"Cat published a new story.",
		);
		expect(notificationMessage(storyPublished())).not.toContain("Rewinds");
	});

	it("the second line is the story title", () => {
		expect(notificationDetail(storyPublished())).toBe(
			'"The Store That Rewinds Night"',
		);
	});

	it("a vanished story keeps the sentence and loses only the second line", () => {
		expect(notificationMessage(storyPublished(null))).toBe(
			"Cat published a new story.",
		);
		expect(notificationDetail(storyPublished(null))).toBeNull();
	});

	it("a departed creator's row still draws safely", () => {
		expect(notificationMessage(storyPublished(undefined, false))).toBe(
			"Deleted user published a new story.",
		);
		expect(notificationActorName(null)).toBe("Deleted user");
	});
});

describe("reply notifications", () => {
	it("the subject is your comment — not your story", () => {
		const message = notificationMessage(commentReply());
		expect(message).toContain("your comment");
		expect(message).toContain("replied");
		expect(message).not.toContain("your story");
	});

	it("a vanished story does not invent a title", () => {
		const message = notificationMessage(commentReply(null));
		expect(message).toBe("Cat replied to your comment.");
		expect(message).not.toContain('""');
	});

	/**
	 * Reply bodies are neither carried nor drawn. A notification records an event, not a copy of the
	 * content.
	 */
	it("does not draw the reply body", () => {
		expect(notificationDetail(commentReply())).toBeNull();
	});

	/**
	 * Goes to the work, not the thread (V1). Anchoring would require knowing the parent's page and the
	 * reply's page in the thread, which couples with two cursor paginations.
	 */
	it("goes to the story, or nowhere without one", () => {
		expect(notificationDestination(commentReply())).toEqual({
			kind: "story",
			storyId: "s1",
		});
		expect(notificationDestination(commentReply(null))).toBeNull();
	});
});
