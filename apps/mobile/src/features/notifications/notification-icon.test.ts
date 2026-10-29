import type { Notification } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import { notificationIconName } from "./notification-icon.ts";

/**
 * Kind → icon. The point of this table is that enforcement and report review get different icons.
 * With the same glyph, "my report was closed" and "my account was sanctioned" look like the same
 * row, yet the user must do opposite things. The web splits `Flag` and `Gavel` for the same reason.
 */

const base = { id: "n1", createdAt: "2026-08-27T00:00:00.000Z", readAt: null };
const actor = { id: "m1", displayName: "Cat", avatarUrl: null };

const CASES: readonly (readonly [Notification, string])[] = [
	[{ ...base, kind: "follow", actor }, "follow-add"],
	[
		{ ...base, kind: "story_comment", actor, story: null, commentId: null },
		"comment",
	],
	/**
	 * Replies share the comment icon. They go to the same place (the work) and need the same user
	 * action. Separate icons would make the difference look meaningful, when only the sentence's
	 * subject differs.
	 */
	[
		{ ...base, kind: "comment_reply", actor, story: null, commentId: null },
		"comment",
	],
	/**
	 * A single-work event gets the work icon. Reusing the follow icon would make two events look like
	 * the same row, but they lead to different places.
	 */
	[
		{ ...base, kind: "creator_story_published", actor, story: null },
		"story-detail",
	],
	[{ ...base, kind: "moderation_action", action: null }, "moderation"],
	[
		{ ...base, kind: "moderation_reversed", action: null },
		"moderation-reversed",
	],
	[{ ...base, kind: "report_reviewed" }, "report"],
	[{ ...base, kind: "appeal_resolved", appeal: null }, "notifications"],
	[
		{ ...base, kind: "app_update", appPlatform: "ios", appVersion: "1.4.0" },
		"notifications",
	],
] as const;

describe("markers", () => {
	it.each(
		CASES.map(([n, icon]) => [n.kind, n, icon] as const),
	)("%s → %s", (_kind, notification, icon) => {
		expect(notificationIconName(notification)).toBe(icon);
	});

	it("follow and new story publication have different markers", () => {
		expect(notificationIconName({ ...base, kind: "follow", actor })).not.toBe(
			notificationIconName({
				...base,
				kind: "creator_story_published",
				actor,
				story: null,
			}),
		);
	});

	it("enforcement and report review have different markers", () => {
		expect(
			notificationIconName({
				...base,
				kind: "moderation_action",
				action: null,
			}),
		).not.toBe(notificationIconName({ ...base, kind: "report_reviewed" }));
	});
});
