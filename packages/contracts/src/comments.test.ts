import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	DeletedStoryCommentDto,
	STORY_COMMENT_LIMITS,
	STORY_COMMENT_PAGE_SIZE,
	STORY_COMMENT_REACTION_KINDS,
	STORY_COMMENT_REPLY_PAGE_SIZE,
	StoryCommentAuthorDto,
	StoryCommentCreateRequest,
	StoryCommentDeleteResponse,
	StoryCommentDto,
	StoryCommentReactionKind,
	StoryCommentRepliesQuery,
	StoryCommentReplyCreateRequest,
	StoryCommentsQuery,
	toStoryCommentRepliesSearchParams,
	toStoryCommentsSearchParams,
	VisibleStoryCommentDto,
} from "./comments.ts";

/**
 * Checks by value what the comment contract cannot express. Three guarantees:
 * - A tombstone cannot carry a body or an author; the union has no room for them.
 * - A request cannot carry identity, parent, or story; there is no slot for them.
 * - An old client that is still alive keeps reading; the live branch is a superset.
 */

const author = { id: "member-1", nickname: "Cat", avatarUrl: null };
const visible = {
	id: "c1",
	storyId: "s1",
	parentId: null,
	state: "visible" as const,
	author,
	body: "Thoughts",
	createdAt: "2026-03-01T00:00:00.000Z",
	replyCount: 2,
	likeCount: 3,
	viewerLiked: true,
};
const tombstone = {
	id: "c1",
	storyId: "s1",
	parentId: null,
	state: "deleted" as const,
	createdAt: "2026-03-01T00:00:00.000Z",
	replyCount: 2,
};

describe("StoryCommentDto variants", () => {
	it("reads both live rows and tombstones", () => {
		expect(StoryCommentDto.parse(visible).state).toBe("visible");
		expect(StoryCommentDto.parse(tombstone).state).toBe("deleted");
	});

	/**
	 * A tombstone must not hold both body and author in one object. A single shape with body and a
	 * deleted flag would make the deleted-with-body state representable. Every renderer would then
	 * have to check the flag, and one missed check would draw a deleted author's text.
	 */
	it("the tombstone variant carries no body or author; sending them drops them", () => {
		const parsed = DeletedStoryCommentDto.parse({
			...tombstone,
			body: "Deleted original",
			author,
			likeCount: 9,
			viewerLiked: true,
		});
		expect(parsed).not.toHaveProperty("body");
		expect(parsed).not.toHaveProperty("author");
		expect(parsed).not.toHaveProperty("likeCount");
		expect(JSON.stringify(parsed)).not.toContain("Deleted original");
	});

	it("the live variant **requires** author and body", () => {
		const { author: _a, ...withoutAuthor } = visible;
		expect(VisibleStoryCommentDto.safeParse(withoutAuthor).success).toBe(false);
		const { body: _b, ...withoutBody } = visible;
		expect(VisibleStoryCommentDto.safeParse(withoutBody).success).toBe(false);
	});

	it("without a discriminant it is neither variant", () => {
		const { state: _s, ...noState } = visible;
		expect(StoryCommentDto.safeParse(noState).success).toBe(false);
	});

	/**
	 * Reads the response with the pre-slice StoryCommentDto schema copied here, to confirm new
	 * responses still parse. Zod objects drop unknown keys, so adding fields does not break old
	 * clients. This contract relies on that, so the live branch must stay a superset of the old shape.
	 *
	 * A tombstone is a new state old clients cannot represent. It must not be disguised with a fake
	 * author and empty body, which would show a nameless member writing an empty comment.
	 */
	it("the previous schema still reads live rows", () => {
		const legacy = z.object({
			id: z.string(),
			storyId: z.string(),
			author: StoryCommentAuthorDto,
			body: z.string(),
			createdAt: z.iso.datetime(),
		});
		const parsed = legacy.safeParse(visible);
		expect(parsed.success).toBe(true);
		expect(parsed.data?.body).toBe("Thoughts");
		expect(parsed.data?.author.id).toBe("member-1");
	});
});

describe("write requests: what cannot ride", () => {
	it("only a body; no slot for identity, parent, story or time", () => {
		const parsed = StoryCommentCreateRequest.parse({
			body: "  Thoughts  ",
			authorId: "member-9",
			author: "member-9",
			nickname: "Impersonation",
			avatarUrl: "https://example.test/a.png",
			storyId: "other-story",
			parentId: "other-parent",
			createdAt: "2000-01-01T00:00:00.000Z",
			likeCount: 99,
		});
		expect(parsed).toEqual({ body: "Thoughts" });
	});

	/**
	 * A reply request uses the same schema as the top-level request. A reply is a comment, with the
	 * same limits and rules.
	 */
	it("a reply request has no `parentId` slot either", () => {
		expect(
			StoryCommentReplyCreateRequest.parse({
				body: "Reply",
				parentId: "c1",
			}),
		).toEqual({ body: "Reply" });
		expect(StoryCommentReplyCreateRequest).toBe(StoryCommentCreateRequest);
	});

	it("refuses empty bodies and over-cap ones; the boundary passes", () => {
		expect(StoryCommentCreateRequest.safeParse({ body: "   " }).success).toBe(
			false,
		);
		const edge = "a".repeat(STORY_COMMENT_LIMITS.body);
		expect(StoryCommentCreateRequest.safeParse({ body: edge }).success).toBe(
			true,
		);
		expect(
			StoryCommentCreateRequest.safeParse({ body: `${edge}a` }).success,
		).toBe(false);
	});
});

describe("responses: deletion and reactions", () => {
	/**
	 * null means the row is gone; a value means a tombstone. The server answers this so the client
	 * does not guess from replyCount, which goes stale as soon as someone else replies.
	 */
	it("a delete response is a tombstone or null", () => {
		expect(
			StoryCommentDeleteResponse.parse({ comment: null }).comment,
		).toBeNull();
		expect(
			StoryCommentDeleteResponse.parse({ comment: tombstone }).comment?.state,
		).toBe("deleted");
	});
});

describe("reaction vocabulary", () => {
	/**
	 * The public vocabulary is one value. Storage has a kind column, but the product sells exactly one
	 * reaction, so this array is the vocabulary. It enforces the decision not to build an emoji
	 * picker.
	 */
	it("only `like`", () => {
		expect([...STORY_COMMENT_REACTION_KINDS]).toEqual(["like"]);
		expect(StoryCommentReactionKind.safeParse("like").success).toBe(true);
		for (const other of ["wow", "heart", "👍", "LIKE", ""])
			expect(StoryCommentReactionKind.safeParse(other).success).toBe(false);
	});
});

describe("query parameters", () => {
	it("the two lists have different default page sizes", () => {
		expect(StoryCommentsQuery.parse({}).limit).toBe(STORY_COMMENT_PAGE_SIZE);
		expect(StoryCommentRepliesQuery.parse({}).limit).toBe(
			STORY_COMMENT_REPLY_PAGE_SIZE,
		);
		expect(STORY_COMMENT_REPLY_PAGE_SIZE).toBeLessThan(STORY_COMMENT_PAGE_SIZE);
	});

	/**
	 * Defaults are omitted from the serialized query. If each client wrote its own, the same query
	 * would produce different URLs.
	 */
	it("serialization omits defaults and knows each default", () => {
		expect(
			toStoryCommentsSearchParams(StoryCommentsQuery.parse({})).toString(),
		).toBe("");
		expect(
			toStoryCommentRepliesSearchParams(
				StoryCommentRepliesQuery.parse({}),
			).toString(),
		).toBe("");
		/**
		 * The top-level default is not omitted when passed to the replies query, because the replies
		 * default is different.
		 */
		expect(
			toStoryCommentRepliesSearchParams(
				StoryCommentRepliesQuery.parse({ limit: STORY_COMMENT_PAGE_SIZE }),
			).toString(),
		).toBe(`limit=${STORY_COMMENT_PAGE_SIZE}`);
	});

	it("the cursor rides as an opaque string", () => {
		expect(
			toStoryCommentsSearchParams(
				StoryCommentsQuery.parse({ cursor: "a b/c" }),
			).get("cursor"),
		).toBe("a b/c");
	});
});
