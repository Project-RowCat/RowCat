import type { Notification } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import {
	canMarkAllRead,
	notificationActorInitial,
	notificationActorName,
	notificationDetail,
	notificationMessage,
	notificationRowLabel,
	notificationUnreadSummary,
} from "./notification-copy.ts";

/**
 * Checks the copy rules by value, without rendering.
 *
 * Half of what is locked here is **what the sentences do not contain**: comment bodies, report
 * dispositions, operator internal reasons, "Consent required", "A new version is out". Those absences are contract
 * and product decisions, and an ordinary copy edit is the easiest way to undo them.
 */

const base = { id: "n1", createdAt: "2026-08-27T00:00:00.000Z", readAt: null };
const actor = { id: "m1", displayName: "Cat", avatarUrl: null };

describe("actor", () => {
	it("a deleted actor is a neutral placeholder", () => {
		expect(notificationActorName(null)).toBe("Deleted user");
	});

	/** An empty nickname and a departed account are **different states** — not folded into one phrase. */
	it("an empty nickname is different copy from deletion", () => {
		expect(notificationActorName({ ...actor, displayName: "" })).toBe(
			"No name",
		);
		expect(notificationActorName({ ...actor, displayName: "" })).not.toBe(
			notificationActorName(null),
		);
	});

	it("the initial doesn't split surrogate pairs", () => {
		expect(notificationActorInitial({ ...actor, displayName: "🐈‍⬛cat" })).toBe(
			"🐈",
		);
		expect(notificationActorInitial({ ...actor, displayName: "abc" })).toBe(
			"A",
		);
	});
});

describe("Follow", () => {
	it("speaks with the actor's name", () => {
		expect(notificationMessage({ ...base, kind: "follow", actor })).toBe(
			"Cat followed you.",
		);
	});

	it("the sentence works for a deleted actor too", () => {
		expect(notificationMessage({ ...base, kind: "follow", actor: null })).toBe(
			"Deleted user followed you.",
		);
	});
});

/**
 * **Reply notices have a different subject from `story_comment`** — the same sentence and the same
 * reason as the web.
 *
 * Folding the two kinds together would write a reply to my comment on someone else's work as "on
 * your work", and the recipient would read a notice about a work they do not own as one about their
 * own.
 */
describe("Reply", () => {
	const reply: Notification = {
		...base,
		kind: "comment_reply",
		actor,
		story: { id: "s1", title: "The Night Library" },
		commentId: "r1",
	};

	it("the subject is your comment — not the story", () => {
		const message = notificationMessage(reply);
		expect(message).toContain("your comment");
		expect(message).toContain("replied");
		expect(message).not.toContain("your story");
	});

	it("when the story is gone it doesn't invent the title", () => {
		expect(notificationMessage({ ...reply, story: null })).toBe(
			"Cat replied to your comment.",
		);
	});

	/** The body is neither carried nor drawn. */
	it("doesn't draw the reply body", () => {
		expect(notificationDetail(reply)).toBeNull();
	});
});

describe("Comments", () => {
	const comment: Notification = {
		...base,
		kind: "story_comment",
		actor,
		story: { id: "s1", title: "The Night Library" },
		commentId: "c1",
	};

	it("who, on which story — no body", () => {
		expect(notificationMessage(comment)).toBe(
			'Cat commented on "The Night Library".',
		);
	});

	/** Does not invent a title for a vanished work — the sentence changes instead. */
	it("a vanished story is a different sentence, not empty quotes", () => {
		const gone = notificationMessage({ ...comment, story: null });
		expect(gone).toBe("Cat commented on your story.");
		expect(gone).not.toContain('""');
	});
});

describe("moderation", () => {
	const action = {
		id: "a1",
		kind: "suspend",
		publicReason: "Operating policy violation",
	};

	it("enforcement puts only the public reason on the second line", () => {
		const n: Notification = { ...base, kind: "moderation_action", action };
		expect(notificationMessage(n)).toBe(
			"A moderation action was applied to your account.",
		);
		expect(notificationDetail(n)).toBe("Operating policy violation");
	});

	it("an empty public reason has no second line", () => {
		expect(
			notificationDetail({
				...base,
				kind: "moderation_action",
				action: { ...action, publicReason: "" },
			}),
		).toBeNull();
		expect(
			notificationDetail({ ...base, kind: "moderation_action", action: null }),
		).toBeNull();
	});

	it("lifting has its own sentence", () => {
		expect(
			notificationMessage({ ...base, kind: "moderation_reversed", action }),
		).toBe("A moderation action on your account was lifted.");
	});
});

describe("Appeal", () => {
	const appeal = (status: "accepted" | "rejected") =>
		({
			...base,
			kind: "appeal_resolved",
			appeal: { id: "p1", actionId: "a1", status },
		}) satisfies Notification;

	it("acceptance and dismissal split — only when the value came in the contract", () => {
		expect(notificationMessage(appeal("accepted"))).toBe(
			"Your appeal was accepted.",
		);
		expect(notificationMessage(appeal("rejected"))).toBe(
			"Your appeal was not accepted.",
		);
	});

	/** A row whose reference is gone does not invent the outcome. */
	it("with no reference it's a neutral sentence", () => {
		expect(
			notificationMessage({ ...base, kind: "appeal_resolved", appeal: null }),
		).toBe("Your appeal has a result.");
	});
});

describe("report review", () => {
	const reviewed: Notification = { ...base, kind: "report_reviewed" };

	/** **Does not state the disposition** — the value is not even carried in the contract, and its absence is intended. */
	it("states only that the review finished", () => {
		const message = notificationMessage(reviewed);
		expect(message).toBe("We reviewed your report.");
		for (const forbidden of [
			"Approve",
			"dismissed",
			"sanction",
			"Delete",
			"suspend",
		])
			expect(message).not.toContain(forbidden);
		expect(notificationDetail(reviewed)).toBeNull();
	});
});

describe("app update", () => {
	const update: Notification = {
		...base,
		kind: "app_update",
		appPlatform: "ios",
		appVersion: "1.4.0",
	};

	/** States end of support, not a release promotion. */
	it("not a new-version promotion sentence", () => {
		expect(notificationMessage(update)).toBe("An app update is required.");
		expect(notificationMessage(update)).not.toContain("launch");
	});

	it("the stored platform and version become the second line", () => {
		expect(notificationDetail(update)).toBe(
			"iOS app versions below 1.4.0 are no longer supported.",
		);
		expect(notificationDetail({ ...update, appPlatform: "android" })).toContain(
			"Android",
		);
	});
});

describe("unread summary and mark all read", () => {
	/** Unknown is not zero — nothing is drawn. */
	it("null and 0 have no summary", () => {
		expect(notificationUnreadSummary(null)).toBeNull();
		expect(notificationUnreadSummary(0)).toBeNull();
	});

	it("writes the exact count — doesn't fold into the badge's 99+", () => {
		expect(notificationUnreadSummary(1247)).toBe("1,247 unread");
	});

	it("mark all read stands only on a confirmed positive", () => {
		expect(canMarkAllRead(null)).toBe(false);
		expect(canMarkAllRead(0)).toBe(false);
		expect(canMarkAllRead(3)).toBe(true);
	});
});

describe("row accessible names", () => {
	it("unread goes in as text", () => {
		expect(notificationRowLabel({ ...base, kind: "follow", actor })).toBe(
			"Unread, Cat followed you.",
		);
	});

	it("read rows are just the sentence", () => {
		expect(
			notificationRowLabel({
				...base,
				readAt: "2026-08-27T01:00:00.000Z",
				kind: "follow",
				actor,
			}),
		).toBe("Cat followed you.");
	});
});

/** Copy for creator-published notices: these sentences must match the web's. */

describe("new story publication copy", () => {
	const base = {
		id: "n-pub",
		createdAt: "2026-08-27T00:00:00.000Z",
		readAt: null,
	};
	const actor = { id: "m1", displayName: "Cat", avatarUrl: null };
	const published = (
		story: { id: string; title: string } | null = {
			id: "s-new",
			title: "The Convenience Store That Rewinds the Night",
		},
		withActor = true,
	): Notification => ({
		...base,
		kind: "creator_story_published",
		actor: withActor ? actor : null,
		story,
	});

	/**
	 * **The title is not in the first line.** Splicing it in makes that line as long as the title, and a work
	 * title is a string a person chose, in any script and of any length; titles like that really
	 * appears. The web's same function made the same judgment, and the two apps' sentences must not
	 * diverge.
	 */
	it("the first line says only who did what", () => {
		expect(notificationMessage(published())).toBe("Cat published a new story.");
		expect(notificationMessage(published())).not.toContain("Rewinds the Night");
	});

	it("the second line is the story title", () => {
		expect(notificationDetail(published())).toBe(
			'"The Convenience Store That Rewinds the Night"',
		);
	});

	/** Empty quotes are not left for a vanished work — the first line remains true. */
	it("when the story is gone the sentence stays and only the second line is absent", () => {
		expect(notificationMessage(published(null))).toBe(
			"Cat published a new story.",
		);
		expect(notificationDetail(published(null))).toBeNull();
	});

	it("a deleted creator's row draws safely too", () => {
		expect(notificationMessage(published(undefined, false))).toBe(
			"Deleted user published a new story.",
		);
	});

	/** The row's accessible name is sentence + state — unread goes in as text. */
	it("an unread row's name carries the state as text", () => {
		expect(notificationRowLabel(published())).toBe(
			"Unread, Cat published a new story.",
		);
	});
});
