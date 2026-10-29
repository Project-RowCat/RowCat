import type { Notification } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import {
	notificationActivationPlan,
	notificationDestination,
} from "./notification-destination.ts";

/**
 * Destination rules, valid only against this app's route list.
 *
 * The most important things locked here are that the four moderation-family kinds go to the account
 * screen, and that the destination carries no reference or disposition. A change that makes up a
 * target id (sending to discovery or profile) or puts a disposition into the destination should
 * fail first in this test. Such a wrong answer compiles, and only someone who presses it notices.
 */

const base = { id: "n1", createdAt: "2026-08-27T00:00:00.000Z", readAt: null };
const actor = { id: "m1", displayName: "Cat", avatarUrl: null };

describe("social notifications", () => {
	it("a follow goes to the actor's profile", () => {
		expect(notificationDestination({ ...base, kind: "follow", actor })).toEqual(
			{ kind: "creator", creatorId: "m1" },
		);
	});

	/** A departed actor's profile is a 404; do not send people to a dead address. */
	it("a deleted actor's follow has no destination", () => {
		expect(
			notificationDestination({ ...base, kind: "follow", actor: null }),
		).toBeNull();
	});

	it("a comment goes to the story details — not a comment anchor", () => {
		const destination = notificationDestination({
			...base,
			kind: "story_comment",
			actor,
			story: { id: "s1", title: "The Night Library" },
			commentId: "c1",
		});
		expect(destination).toEqual({ kind: "story", storyId: "s1" });
		/** `commentId` is in the contract, but it is not carried into the V1 destination. */
		expect(JSON.stringify(destination)).not.toContain("c1");
	});

	it("a comment on a vanished story has no destination", () => {
		expect(
			notificationDestination({
				...base,
				kind: "story_comment",
				actor,
				story: null,
				commentId: "c1",
			}),
		).toBeNull();
	});

	/**
	 * **Replies also go to the work** — not to the thread (same judgment as the web). Anchoring would
	 * require knowing both which page the parent is on and where the reply sits in that thread, which
	 * entangles two cursor paginations.
	 */
	it("a reply goes to the story details too — not a thread anchor", () => {
		const destination = notificationDestination({
			...base,
			kind: "comment_reply",
			actor,
			story: { id: "s1", title: "The Night Library" },
			commentId: "r1",
		});
		expect(destination).toEqual({ kind: "story", storyId: "s1" });
		expect(JSON.stringify(destination)).not.toContain("r1");
	});

	it("a reply on a vanished story has no destination", () => {
		expect(
			notificationDestination({
				...base,
				kind: "comment_reply",
				actor,
				story: null,
				commentId: "r1",
			}),
		).toBeNull();
	});

	/**
	 * **This is where it differs from follow.** A follow concerns *that person*, so the profile is the
	 * canonical destination. What this row announces is *one work*, so it must be the same destination
	 * as the web.
	 */
	it("a new story publication goes to that story", () => {
		expect(
			notificationDestination({
				...base,
				kind: "creator_story_published",
				actor,
				story: {
					id: "s-new",
					title: "The Convenience Store That Rewinds the Night",
				},
			}),
		).toEqual({ kind: "story", storyId: "s-new" });
	});

	/** Do not send to the author's profile instead, even though the author may still exist. */
	it("a publication notification for a vanished story has no destination", () => {
		expect(
			notificationDestination({
				...base,
				kind: "creator_story_published",
				actor,
				story: null,
			}),
		).toBeNull();
	});

	/**
	 * Reading and navigation are **independent**: a row with no destination is still marked read (it
	 * must not look broken).
	 */
	it("it marks as read even without a destination", () => {
		expect(
			notificationActivationPlan({
				...base,
				kind: "creator_story_published",
				actor,
				story: null,
			}),
		).toEqual({ markReadId: "n1", destination: null });
	});
});

describe("account notifications — go to the account screen", () => {
	/**
	 * For a while these four had no destination (an intended, temporary gap while the account screen
	 * did not exist). With the account screen and its `Restrictions` and `My reports` sections, they got the same
	 * destination as the web: the sections answer the details, and the notification is a pointer.
	 */
	const accountKinds: Notification[] = [
		{
			...base,
			kind: "moderation_action",
			action: { id: "a1", kind: "suspend", publicReason: "" },
		},
		{ ...base, kind: "moderation_reversed", action: null },
		{
			...base,
			kind: "appeal_resolved",
			appeal: { id: "p1", actionId: "a1", status: "accepted" },
		},
		{ ...base, kind: "report_reviewed" },
	];

	it.each(
		accountKinds.map((n) => [n.kind, n] as const),
	)("%s goes to the account screen", (_kind, notification) => {
		expect(notificationDestination(notification)).toEqual({ kind: "account" });
	});

	/**
	 * The destination carries **no target and no disposition.** Once an action id or appeal status is
	 * carried in the destination, the navigation table starts wanting to turn it into an address, and
	 * that address vocabulary does not exist in this product. Above all, the disposition is not what
	 * the notification is for.
	 */
	it("the destination carries neither reference nor disposition", () => {
		for (const notification of accountKinds) {
			const destination = notificationDestination(notification);
			expect(JSON.stringify(destination)).not.toMatch(
				/a1|p1|accepted|suspend|section|reason/,
			);
		}
	});
});

describe("company notifications", () => {
	/** Sending people to the store belongs to the app-update gate slice, not here. */
	it("an app update notice has no destination", () => {
		expect(
			notificationDestination({
				...base,
				kind: "app_update",
				appPlatform: "ios",
				appVersion: "1.4.0",
			}),
		).toBeNull();
	});
});

describe("activation plan — read and navigation are independent", () => {
	it("an unread row creates a read request", () => {
		expect(
			notificationActivationPlan({ ...base, kind: "follow", actor }),
		).toEqual({
			markReadId: "n1",
			destination: { kind: "creator", creatorId: "m1" },
		});
	});

	/** A row already read carries no request — do not send a request per click, even to an idempotent server. */
	it("a read row has no read request", () => {
		expect(
			notificationActivationPlan({
				...base,
				readAt: "2026-08-27T01:00:00.000Z",
				kind: "follow",
				actor,
			}).markReadId,
		).toBeNull();
	});

	/** Marking read works even with no destination — a row must not look broken. */
	it("a row without a destination still creates a read request", () => {
		expect(
			notificationActivationPlan({
				...base,
				kind: "app_update",
				appPlatform: "ios",
				appVersion: "1.4.0",
			}),
		).toEqual({ markReadId: "n1", destination: null });
	});

	/** Reading and navigating are independent: account notifications also plan a read request and an account destination **together**. */
	it("activating an account notification plans read and navigation together", () => {
		expect(
			notificationActivationPlan({ ...base, kind: "report_reviewed" }),
		).toEqual({ markReadId: "n1", destination: { kind: "account" } });
	});
});
