import type { CreatorCommentInboxItem } from "@rowcat/domain";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import {
	type CreatorCommentsQueryView,
	creatorCommentRowView,
	creatorCommentsPanelView,
} from "./state.ts";

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

const unauthorized = () =>
	new RowCatApiError({
		status: 401,
		code: "unauthorized",
		message: "You need to sign in.",
	});

describe("creatorCommentsPanelView: panel state", () => {
	/** Drawing a failure as an empty list would claim 'no comments received', which we cannot know. */
	it("a failure is not the empty state", () => {
		expect(
			creatorCommentsPanelView(query({ isError: true, error: new Error("x") })),
		).toEqual({ state: "error", retryable: true });
	});

	/** A retry button on a 401 would always receive the same 401. */
	it("a lost session means sign in, not retry", () => {
		expect(
			creatorCommentsPanelView(query({ isError: true, error: unauthorized() })),
		).toEqual({ state: "reauth", retryable: false });
	});

	/** A stopped query still reports `isPending`, so stopped must be checked before loading. */
	it("paused comes before loading", () => {
		expect(
			creatorCommentsPanelView(query({ isPaused: true, isPending: true })),
		).toEqual({ state: "offline", retryable: true });
	});

	it("the first fetch shows the placeholder", () => {
		expect(creatorCommentsPanelView(query({ isPending: true }))).toEqual({
			state: "loading",
			retryable: false,
		});
	});

	it("empty only when there really are no rows", () => {
		expect(creatorCommentsPanelView(query({ hasData: true }))).toEqual({
			state: "empty",
			retryable: false,
		});
	});

	/**
	 * Held rows are never cleared, whether the query failed, stopped, or returned a 401. Only a way
	 * forward is added.
	 */
	it.each([
		["failed", { isError: true, error: new Error("x") }],
		["paused", { isPaused: true }],
		["401", { isError: true, error: unauthorized() }],
	] as const)("held rows are drawn even when %s", (_, patch) => {
		expect(
			creatorCommentsPanelView(
				query({ hasData: true, itemCount: 3, ...patch }),
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

describe("creatorCommentRowView: one row", () => {
	it("the key and destination come from ids", () => {
		const view = creatorCommentRowView(item());
		expect(view.key).toBe("c-1");
		expect(view.destination).toEqual({
			storyId: "s-1",
			commentId: "c-1",
			hash: "comments",
		});
		expect(view.unreachableReason).toBeNull();
	});

	it("a reply says it is a reply", () => {
		expect(creatorCommentRowView(item({}, "c-0")).kindLabel).toBe("Reply");
		expect(creatorCommentRowView(item()).kindLabel).toBe("Comment");
	});

	/**
	 * A row with no destination drops the link and says why. Hiding takes precedence as the reason.
	 */
	it.each([
		[{ hidden: true }, "Hidden under the operating policy"],
		[
			{ visibility: "archived" as const, hidden: true },
			"Hidden under the operating policy",
		],
		[{ visibility: "archived" as const }, "Archived story"],
		[{ visibility: "private" as const }, "Private story"],
	])("%o → %s", (story, reason) => {
		const view = creatorCommentRowView(item(story));
		expect(view.destination).toBeNull();
		expect(view.unreachableReason).toBe(reason);
	});
});
