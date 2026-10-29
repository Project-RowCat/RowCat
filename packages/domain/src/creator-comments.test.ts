import { describe, expect, it } from "vitest";
import {
	type CreatorCommentInboxItem,
	type CreatorCommentsPanelInput,
	creatorCommentDestination,
	creatorCommentKindLabel,
	creatorCommentsPanelView,
	creatorCommentUnreachableReason,
	STORY_COMMENTS_ANCHOR,
} from "./creator-comments.ts";
import { STORY_VISIBILITIES, type StoryVisibility } from "./story.ts";

const item = (
	story: Partial<CreatorCommentInboxItem["story"]> = {},
	commentId = "c-7",
): CreatorCommentInboxItem => ({
	comment: {
		id: commentId,
		storyId: story.id ?? "s-1",
		parentId: null,
		createdAt: "2026-09-01T00:00:00.000Z",
		replyCount: 0,
		state: "visible",
		author: { id: "m-2", nickname: "Carol", avatarUrl: null },
		body: "Loved it",
		likeCount: 0,
		viewerLiked: false,
	},
	story: {
		id: "s-1",
		title: "Story",
		visibility: "public",
		hidden: false,
		...story,
	},
});

describe("creatorCommentDestination", () => {
	it("points at the story's comments section by the row's id, not its list position", () => {
		expect(creatorCommentDestination(item({ id: "s-9" }, "c-42"))).toEqual({
			storyId: "s-9",
			commentId: "c-42",
			hash: STORY_COMMENTS_ANCHOR,
		});
	});

	/**
	 * Do not draw links that lead to a 404 or to a `a story without comments` page. The table covers all four
	 * visibility states, so adding a value to the vocabulary forces this table to state its answer.
	 */
	const expected: Record<StoryVisibility, boolean> = {
		public: true,
		unlisted: true,
		private: false,
		archived: false,
	};
	it.each(STORY_VISIBILITIES)("exposure `%s`", (visibility) => {
		expect(creatorCommentDestination(item({ visibility })) !== null).toBe(
			expected[visibility],
		);
	});

	it("an operator-hidden work has no destination even if public (404 for the owner too)", () => {
		expect(
			creatorCommentDestination(item({ visibility: "public", hidden: true })),
		).toBeNull();
	});
});

const panel = (
	patch: Partial<CreatorCommentsPanelInput> = {},
): CreatorCommentsPanelInput => ({
	isPaused: false,
	isError: false,
	isPending: false,
	hasData: false,
	itemCount: 0,
	sessionLost: false,
	...patch,
});

/**
 * Web and mobile call the same function, so a mistake here breaks both apps. Each app keeps only an
 * adapter that folds failures into the single `sessionLost` flag.
 */
describe("creatorCommentsPanelView: panel states", () => {
	/**
	 * Drawing a failure as an empty list would claim 'no comments received', a fact we do not know.
	 */
	it("failure is not the empty state", () => {
		expect(creatorCommentsPanelView(panel({ isError: true }))).toEqual({
			state: "error",
			retryable: true,
		});
	});

	it("a lost session is sign-in, not retry", () => {
		expect(
			creatorCommentsPanelView(panel({ isError: true, sessionLost: true })),
		).toEqual({ state: "reauth", retryable: false });
	});

	it("paused comes before loading", () => {
		expect(
			creatorCommentsPanelView(panel({ isPaused: true, isPending: true })),
		).toEqual({ state: "offline", retryable: true });
	});

	it("the first fetch is a placeholder", () => {
		expect(creatorCommentsPanelView(panel({ isPending: true }))).toEqual({
			state: "loading",
			retryable: false,
		});
	});

	it("empty only when no rows really arrived", () => {
		expect(creatorCommentsPanelView(panel({ hasData: true }))).toEqual({
			state: "empty",
			retryable: false,
		});
	});

	it.each([
		["failed", { isError: true }],
		["paused", { isPaused: true }],
		["401", { isError: true, sessionLost: true }],
	] as const)("with held rows it draws rows even when %s", (_, patch) => {
		expect(
			creatorCommentsPanelView(
				panel({ hasData: true, itemCount: 3, ...patch }),
			),
		).toEqual({ state: "ready", retryable: true });
	});
});

describe("row display rules", () => {
	it("a reply says it is a reply", () => {
		expect(creatorCommentKindLabel({ parentId: null })).toBe("Comment");
		expect(creatorCommentKindLabel({ parentId: "c-0" })).toBe("Reply");
	});

	it("a row with a destination has no reason", () => {
		expect(creatorCommentUnreachableReason(item())).toBeNull();
		expect(
			creatorCommentUnreachableReason(item({ visibility: "unlisted" })),
		).toBeNull();
	});

	/** A row with no destination says why. The hidden reason is checked first. */
	it.each([
		[{ hidden: true }, "Hidden under the operating policy"],
		[
			{ visibility: "archived" as const, hidden: true },
			"Hidden under the operating policy",
		],
		[{ visibility: "archived" as const }, "Archived story"],
		[{ visibility: "private" as const }, "Private story"],
	])("%o → %s", (story, reason) => {
		expect(creatorCommentDestination(item(story))).toBeNull();
		expect(creatorCommentUnreachableReason(item(story))).toBe(reason);
	});

	/** A reason and a destination are mutually exclusive: a row never has both, or neither. */
	it.each([
		...STORY_VISIBILITIES,
	])("%s: exactly one of destination and reason", (v) => {
		for (const hidden of [false, true]) {
			const row = item({ visibility: v as StoryVisibility, hidden });
			expect(
				(creatorCommentDestination(row) === null) !==
					(creatorCommentUnreachableReason(row) === null),
			).toBe(true);
		}
	});
});
