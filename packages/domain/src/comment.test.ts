import { describe, expect, it } from "vitest";
import {
	canReplyToComment,
	commentLikeLabel,
	commentRepliesLabel,
	DELETED_COMMENT_PLACEHOLDER,
	isOwnComment,
	type StoryComment,
} from "./comment.ts";

/**
 * Product rules for comments, shared by the web and mobile apps. The four judgments here are easy
 * for each screen to rewrite by hand, and a rewrite can drift between web and mobile. Compilers and
 * tests cannot catch that drift, so the expected values are pinned here.
 */

const visible = (
	over: Partial<Extract<StoryComment, { state: "visible" }>> = {},
) =>
	({
		id: "c1",
		storyId: "s1",
		parentId: null,
		state: "visible",
		author: { id: "member-1", nickname: "Cat", avatarUrl: null },
		body: "Review",
		createdAt: "2026-03-01T00:00:00.000Z",
		replyCount: 0,
		likeCount: 0,
		viewerLiked: false,
		...over,
	}) satisfies StoryComment;

const deleted = (replyCount = 1): StoryComment => ({
	id: "c1",
	storyId: "s1",
	parentId: null,
	state: "deleted",
	createdAt: "2026-03-01T00:00:00.000Z",
	replyCount,
});

describe("isOwnComment", () => {
	it("decides by member id only", () => {
		expect(isOwnComment(visible(), "member-1")).toBe(true);
		expect(isOwnComment(visible(), "member-2")).toBe(false);
		expect(isOwnComment(visible(), null)).toBe(false);
	});

	it("a different id with the same nickname is someone else's", () => {
		const impostor = visible({
			author: { id: "member-2", nickname: "Cat", avatarUrl: null },
		});
		expect(isOwnComment(impostor, "member-1")).toBe(false);
	});

	it("a tombstone is not even its former author's", () => {
		expect(isOwnComment(deleted(), "member-1")).toBe(false);
	});
});

describe("canReplyToComment", () => {
	it("true only for a live top-level comment", () => {
		expect(canReplyToComment(visible())).toBe(true);
	});

	it("a reply cannot be replied to", () => {
		expect(canReplyToComment(visible({ parentId: "c0" }))).toBe(false);
	});

	it("a tombstone cannot get new replies", () => {
		expect(canReplyToComment(deleted())).toBe(false);
	});

	it("a live row with many replies can keep getting more", () => {
		expect(canReplyToComment(visible({ replyCount: 40 }))).toBe(true);
	});
});

describe("commentRepliesLabel", () => {
	it("puts the count in the sentence; you should know what opens before pressing", () => {
		expect(commentRepliesLabel(1)).toBe("View 1 reply");
		expect(commentRepliesLabel(12)).toBe("View 12 replies");
	});

	it("no row for 0", () => {
		expect(commentRepliesLabel(0)).toBeNull();
	});
});

describe("commentLikeLabel", () => {
	it("states the state and the count together", () => {
		expect(commentLikeLabel(visible({ likeCount: 3 }))).toBe("Like (3 now)");
		expect(commentLikeLabel(visible({ likeCount: 4, viewerLiked: true }))).toBe(
			"Unlike (4 now)",
		);
	});

	it("a tombstone has no name; no heart stands there", () => {
		expect(commentLikeLabel(deleted())).toBeNull();
	});
});

describe("tombstone copy", () => {
	it("states neither who nor why", () => {
		expect(DELETED_COMMENT_PLACEHOLDER).toBe("This comment was deleted.");
		for (const word of ["moderation", "report", "deletion", "block", "author"])
			expect(DELETED_COMMENT_PLACEHOLDER).not.toContain(word);
	});
});
