import type { CreatorCommentInboxItem } from "@rowcat/domain";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import { safeMobileReturnPath } from "../../lib/return-path.ts";
import {
	CREATOR_COMMENTS_RETURN_PATH,
	type CreatorCommentsQueryView,
	creatorCommentRowView,
	creatorCommentsView,
} from "./creator-comments-state.ts";

/** Mobile adapter for the comments tab. Ordering is locked by @rowcat/domain's tests; this checks the app folds failures correctly. Folding a 401 into a generic failure would offer a `Try again` that keeps returning the same 401. */

const query = (
	patch: Partial<CreatorCommentsQueryView> = {},
): CreatorCommentsQueryView => ({
	isPaused: false,
	isError: false,
	isPending: false,
	hasData: false,
	itemCount: 0,
	error: null,
	...patch,
});

const apiError = (status: number) =>
	new RowCatApiError({ status, code: "x", message: "x" });

describe("creatorCommentsView", () => {
	it("401 means sign in again", () => {
		expect(
			creatorCommentsView(query({ isError: true, error: apiError(401) })),
		).toEqual({ state: "reauth", retryable: false });
	});

	it.each([403, 500])("%i is a generic failure", (status) => {
		expect(
			creatorCommentsView(query({ isError: true, error: apiError(status) })),
		).toEqual({ state: "error", retryable: true });
	});

	it("a connection failure (network error) isn't read as 401", () => {
		expect(
			creatorCommentsView(query({ isError: true, error: new TypeError("x") })),
		).toEqual({ state: "error", retryable: true });
	});

	it("paused is offline, not loading", () => {
		expect(
			creatorCommentsView(query({ isPaused: true, isPending: true })),
		).toEqual({ state: "offline", retryable: true });
	});

	/** Drawing a failure as an empty list would assert "no comments received", which we do not know. */
	it("the empty state only when there are truly no rows received", () => {
		expect(creatorCommentsView(query({ hasData: true }))).toEqual({
			state: "empty",
			retryable: false,
		});
		expect(creatorCommentsView(query({ isError: true })).state).toBe("error");
	});

	it("held rows aren't erased even on 401", () => {
		expect(
			creatorCommentsView(
				query({
					hasData: true,
					itemCount: 2,
					isError: true,
					error: apiError(401),
				}),
			),
		).toEqual({ state: "ready", retryable: true });
	});
});

const item = (
	story: Partial<CreatorCommentInboxItem["story"]> = {},
	parentId: string | null = null,
): CreatorCommentInboxItem => ({
	comment: {
		id: "c-1",
		storyId: "s-1",
		parentId,
		createdAt: "2026-09-01T03:04:00.000Z",
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

describe("creatorCommentRowView", () => {
	it("the key and destination come from the id — not the list position", () => {
		const view = creatorCommentRowView(item());
		expect(view.key).toBe("c-1");
		expect(view.storyId).toBe("s-1");
		expect(view.unreachableReason).toBeNull();
		expect(view.at).not.toBeNull();
	});

	it("unlisted stories open too", () => {
		expect(
			creatorCommentRowView(item({ visibility: "unlisted" })).storyId,
		).toBe("s-1");
	});

	it("a reply says it's a reply", () => {
		expect(creatorCommentRowView(item({}, "c-0")).kindLabel).toBe("Reply");
	});

	/** Archived, hidden and private works have no destination, and the row says why. */
	it.each([
		[{ hidden: true }, "Hidden under the operating policy"],
		[{ visibility: "archived" as const }, "Archived story"],
		[{ visibility: "private" as const }, "Private story"],
	])("%o → nowhere to go", (story, reason) => {
		const view = creatorCommentRowView(item(story));
		expect(view.storyId).toBeNull();
		expect(view.unreachableReason).toBe(reason);
	});

	it("an unreadable time makes no slot", () => {
		const broken = item();
		broken.comment = { ...broken.comment, createdAt: "not-a-date" };
		expect(creatorCommentRowView(broken).at).toBeNull();
	});
});

describe("where to return after signing in again", () => {
	/** If the return-path check folded this value to its default, the person would land on the discover screen. */
	it("goes through the return-path check as is", () => {
		expect(safeMobileReturnPath(CREATOR_COMMENTS_RETURN_PATH)).toBe(
			CREATOR_COMMENTS_RETURN_PATH,
		);
	});
});
