import type { StoryComment, StoryCommentPage } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	createCommentMutationOptions,
	createCommentReplyMutationOptions,
	deleteCommentMutationOptions,
	reactToCommentMutationOptions,
	type StoryCommentsInfiniteData,
	storyCommentRepliesQueryKey,
	storyComments,
	storyCommentsQueryKey,
} from "./comments.ts";
import { storyDetailQueryKey } from "./story.ts";
import { resetViewerState, VIEWER_QUERY_KEY } from "./viewer.ts";

/**
 * Cache policy for comment writes. The test checks which cells change and how once a write settles,
 * not whether the request went out (that is the SDK's job). One failure mode is invisible to manual
 * testing and must be caught here: a comment written while the end of the list is not loaded must
 * not be appended. It would show immediately, but when the user loads that span with `Show more`, the
 * same row would appear twice. No React: the policy is rules on QueryClient, not a hook.
 */

const STORY = "story-1";
const OTHER_STORY = "story-2";

const commentOf = (
	id: string,
	overrides: Partial<Extract<StoryComment, { state: "visible" }>> = {},
): StoryComment => ({
	id,
	storyId: STORY,
	parentId: null,
	state: "visible",
	author: { id: "member-1", nickname: "Cat", avatarUrl: null },
	body: `${id} body`,
	createdAt: "2026-08-19T00:00:00.000Z",
	replyCount: 0,
	likeCount: 0,
	viewerLiked: false,
	...overrides,
});

/** A tombstone: a deleted row kept as a slot because replies still hang under it. */
const tombstoneOf = (id: string, replyCount = 1): StoryComment => ({
	id,
	storyId: STORY,
	parentId: null,
	state: "deleted",
	createdAt: "2026-08-19T00:00:00.000Z",
	replyCount,
});

const page = (ids: string[], nextCursor: string | null): StoryCommentPage => ({
	items: ids.map((id) => commentOf(id)),
	nextCursor,
});

/**
 * Seeds the cache with already-loaded pages. No fetch function is registered, so no refetch can
 * run.
 */
function seed(
	queryClient: QueryClient,
	storyId: string,
	pages: StoryCommentPage[],
): void {
	queryClient.setQueryData<StoryCommentsInfiniteData>(
		storyCommentsQueryKey(storyId),
		{ pages, pageParams: pages.map((_, index) => (index ? `c${index}` : "")) },
	);
}

const cached = (queryClient: QueryClient, storyId: string) =>
	queryClient.getQueryData<StoryCommentsInfiniteData>(
		storyCommentsQueryKey(storyId),
	);

/**
 * Seeds a thread's reply cell. It has the same shape as the top level, so the same type is used.
 */
function seedReplies(
	queryClient: QueryClient,
	storyId: string,
	commentId: string,
	pages: StoryCommentPage[],
): void {
	queryClient.setQueryData<StoryCommentsInfiniteData>(
		storyCommentRepliesQueryKey(storyId, commentId),
		{ pages, pageParams: pages.map((_, index) => (index ? `c${index}` : "")) },
	);
}

const cachedReplies = (
	queryClient: QueryClient,
	storyId: string,
	commentId: string,
) =>
	queryClient.getQueryData<StoryCommentsInfiniteData>(
		storyCommentRepliesQueryKey(storyId, commentId),
	);

const replyIdsIn = (
	queryClient: QueryClient,
	storyId: string,
	commentId: string,
): string[] => {
	const data = cachedReplies(queryClient, storyId, commentId);
	return data ? storyComments(data).map((comment) => comment.id) : [];
};

/** Picks one row out of the top-level cell. Used to check threading and counts. */
const rowIn = (
	queryClient: QueryClient,
	id: string,
): StoryComment | undefined => {
	const data = cached(queryClient, STORY);
	return data ? storyComments(data).find((c) => c.id === id) : undefined;
};

const idsIn = (queryClient: QueryClient, storyId: string): string[] => {
	const data = cached(queryClient, storyId);
	return data ? storyComments(data).map((comment) => comment.id) : [];
};

/** Fake client with only the one function needed; calling any other member fails on the spot. */
const clientOf = (comments: Partial<RowCatClient["comments"]>): RowCatClient =>
	({ comments }) as RowCatClient;

/**
 * Runs the mutation for real rather than calling callbacks by hand. If the test invented the order
 * and arguments, it could pass while the library calls them differently.
 */
async function run<TVariables>(
	queryClient: QueryClient,
	options: object,
	variables: TVariables,
): Promise<"success" | "error"> {
	const observer = new MutationObserver(
		queryClient,
		options as ConstructorParameters<typeof MutationObserver>[1],
	);
	try {
		await observer.mutate(variables);
		return "success";
	} catch {
		return "error";
	}
}

const newClient = () =>
	new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

describe("createCommentMutationOptions", () => {
	it("with the last page loaded, a new comment is appended to the list", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a", "b"], null)]);
		const created = commentOf("c");

		const result = await run(
			queryClient,
			createCommentMutationOptions(
				clientOf({ create: async () => created }),
				queryClient,
				STORY,
			),
			"New comment",
		);

		expect(result).toBe("success");
		// The list is oldest-first, so a new row always goes at the end.
		expect(idsIn(queryClient, STORY)).toEqual(["a", "b", "c"]);
	});

	it("without the last page seen it is not appended, so it never shows twice", async () => {
		const queryClient = newClient();
		// The last page still has a cursor, which means an unloaded span follows it.
		seed(queryClient, STORY, [page(["a", "b"], "cursor-2")]);

		await run(
			queryClient,
			createCommentMutationOptions(
				clientOf({ create: async () => commentOf("z") }),
				queryClient,
				STORY,
			),
			"New comment",
		);

		/**
		 * Not appending is the exact correct behavior. The row really exists in the unloaded span, and
		 * the boundary the cursor points to is unchanged: no omission and no duplicate.
		 */
		expect(idsIn(queryClient, STORY)).toEqual(["a", "b"]);
	});

	it("the same response twice does not make two rows", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a"], null)]);
		const created = commentOf("b");
		const options = createCommentMutationOptions(
			clientOf({ create: async () => created }),
			queryClient,
			STORY,
		);

		await run(queryClient, options, "New comment");
		await run(queryClient, options, "New comment");

		expect(idsIn(queryClient, STORY)).toEqual(["a", "b"]);
	});

	it("does not invent a missing cache", async () => {
		const queryClient = newClient();

		await run(
			queryClient,
			createCommentMutationOptions(
				clientOf({ create: async () => commentOf("a") }),
				queryClient,
				STORY,
			),
			"New comment",
		);

		/**
		 * If a write created a cache entry that no one observes, opening the list later would draw this
		 * one-row list without asking the server, because the entry is still fresh.
		 */
		expect(cached(queryClient, STORY)).toBeUndefined();
	});

	it("other stories' cells are untouched", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a"], null)]);
		seed(queryClient, OTHER_STORY, [page(["x"], null)]);
		const before = cached(queryClient, OTHER_STORY);

		await run(
			queryClient,
			createCommentMutationOptions(
				clientOf({ create: async () => commentOf("b") }),
				queryClient,
				STORY,
			),
			"New comment",
		);

		expect(idsIn(queryClient, OTHER_STORY)).toEqual(["x"]);
		// Reference identity must hold, or that other story's screen re-renders for nothing.
		expect(cached(queryClient, OTHER_STORY)).toBe(before);
	});

	it("on failure the cache stays", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a"], null)]);
		const before = cached(queryClient, STORY);

		const result = await run(
			queryClient,
			createCommentMutationOptions(
				clientOf({
					create: async () => {
						throw new Error("server refusal");
					},
				}),
				queryClient,
				STORY,
			),
			"New comment",
		);

		expect(result).toBe("error");
		// No optimistic insert, so nothing to roll back: the rows on screen are only saved rows.
		expect(cached(queryClient, STORY)).toBe(before);
	});
});

describe("deleteCommentMutationOptions", () => {
	it("removes only that id after confirmation", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a", "b"], "c1"), page(["c", "d"], null)]);

		const result = await run(
			queryClient,
			deleteCommentMutationOptions(
				clientOf({ remove: async () => null }),
				queryClient,
				STORY,
			),
			{ id: "c", parentId: null },
		);

		expect(result).toBe("success");
		expect(idsIn(queryClient, STORY)).toEqual(["a", "b", "d"]);
	});

	it("pages without that row keep the same reference", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a", "b"], "c1"), page(["c"], null)]);
		const firstPageBefore = cached(queryClient, STORY)?.pages[0];

		await run(
			queryClient,
			deleteCommentMutationOptions(
				clientOf({ remove: async () => null }),
				queryClient,
				STORY,
			),
			{ id: "c", parentId: null },
		);

		expect(cached(queryClient, STORY)?.pages[0]).toBe(firstPageBefore);
	});

	it("on failure the row does not disappear", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a", "b"], null)]);

		const result = await run(
			queryClient,
			deleteCommentMutationOptions(
				clientOf({
					remove: async () => {
						throw new Error("Someone else's comment");
					},
				}),
				queryClient,
				STORY,
			),
			{ id: "b", parentId: null },
		);

		expect(result).toBe("error");
		/**
		 * No optimistic removal, so nothing to restore. Restoring would briefly show a deleted post
		 * coming back, and it would no longer be clear what is true.
		 */
		expect(idsIn(queryClient, STORY)).toEqual(["a", "b"]);
	});

	it("the same id in another story leaves that cell untouched", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a"], null)]);
		seed(queryClient, OTHER_STORY, [page(["a"], null)]);

		await run(
			queryClient,
			deleteCommentMutationOptions(
				clientOf({ remove: async () => null }),
				queryClient,
				STORY,
			),
			{ id: "a", parentId: null },
		);

		expect(idsIn(queryClient, STORY)).toEqual([]);
		// Caches are split per story, so a prefix sweep would also empty this one; this assertion guards
		// against that.
		expect(idsIn(queryClient, OTHER_STORY)).toEqual(["a"]);
	});
});

describe("createCommentReplyMutationOptions", () => {
	it("a reply is appended to the thread cell and the parent is replaced with the server's value", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a", "b"], null)]);
		seedReplies(queryClient, STORY, "a", [
			{ items: [commentOf("r1", { parentId: "a" })], nextCursor: null },
		]);

		const result = await run(
			queryClient,
			createCommentReplyMutationOptions(
				clientOf({
					reply: async () => ({
						reply: commentOf("r2", { parentId: "a" }),
						/**
						 * The server counts replies. If the screen did +1, a reply posted by someone else at the same
						 * moment would make the guess wrong, and that would only show after the thread is expanded.
						 */
						parent: commentOf("a", { replyCount: 7 }),
					}),
				}),
				queryClient,
				STORY,
				"a",
			),
			"Reply",
		);

		expect(result).toBe("success");
		expect(replyIdsIn(queryClient, STORY, "a")).toEqual(["r1", "r2"]);
		const parent = rowIn(queryClient, "a");
		expect(parent?.replyCount).toBe(7);
	});

	it("without the thread's last page seen it is not appended", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a"], null)]);
		seedReplies(queryClient, STORY, "a", [
			{ items: [commentOf("r1", { parentId: "a" })], nextCursor: "c1" },
		]);

		await run(
			queryClient,
			createCommentReplyMutationOptions(
				clientOf({
					reply: async () => ({
						reply: commentOf("r9", { parentId: "a" }),
						parent: commentOf("a", { replyCount: 2 }),
					}),
				}),
				queryClient,
				STORY,
				"a",
			),
			"Reply",
		);

		// That row really sits in a span not yet visible. Appending it would show it twice, after `Show more`.
		expect(replyIdsIn(queryClient, STORY, "a")).toEqual(["r1"]);
		// The parent's count is still updated to the confirmed value; the two cells are independent.
		expect(rowIn(queryClient, "a")?.replyCount).toBe(2);
	});

	it("does not fail when the parent is not in the top-level cell", async () => {
		const queryClient = newClient();
		seedReplies(queryClient, STORY, "a", [{ items: [], nextCursor: null }]);

		const result = await run(
			queryClient,
			createCommentReplyMutationOptions(
				clientOf({
					reply: async () => ({
						reply: commentOf("r1", { parentId: "a" }),
						parent: commentOf("a", { replyCount: 1 }),
					}),
				}),
				queryClient,
				STORY,
				"a",
			),
			"Reply",
		);

		expect(result).toBe("success");
		// Does not invent a missing row to insert: that would shift page boundaries.
		expect(cached(queryClient, STORY)).toBeUndefined();
		expect(replyIdsIn(queryClient, STORY, "a")).toEqual(["r1"]);
	});
});

describe("reactToCommentMutationOptions", () => {
	it("replaces with the server's row; the screen does not ±1", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a"], null)]);

		await run(
			queryClient,
			reactToCommentMutationOptions(
				clientOf({
					react: async () =>
						commentOf("a", { likeCount: 12, viewerLiked: true }),
				}),
				queryClient,
				STORY,
				{ id: "a", parentId: null },
			),
			true,
		);

		const row = rowIn(queryClient, "a");
		expect(row?.state).toBe("visible");
		expect(row).toMatchObject({ likeCount: 12, viewerLiked: true });
	});

	it("rapid presses do not skew the count; the last response is always right", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a"], null)]);
		const options = reactToCommentMutationOptions(
			clientOf({
				react: async () => commentOf("a", { likeCount: 1, viewerLiked: true }),
			}),
			queryClient,
			STORY,
			{ id: "a", parentId: null },
		);

		await run(queryClient, options, true);
		await run(queryClient, options, true);
		await run(queryClient, options, true);

		/**
		 * Had this been an optimistic +1, it would read 3 here. The server's truth is always 0 or 1 (the
		 * unique constraint is the final authority), so writing the confirmed value means repeated taps
		 * cannot drift.
		 */
		expect(rowIn(queryClient, "a")).toMatchObject({ likeCount: 1 });
	});

	it("a reply's reaction updates in its thread cell", async () => {
		const queryClient = newClient();
		seedReplies(queryClient, STORY, "a", [
			{ items: [commentOf("r1", { parentId: "a" })], nextCursor: null },
		]);

		await run(
			queryClient,
			reactToCommentMutationOptions(
				clientOf({
					unreact: async () =>
						commentOf("r1", {
							parentId: "a",
							likeCount: 0,
							viewerLiked: false,
						}),
				}),
				queryClient,
				STORY,
				{ id: "r1", parentId: "a" },
			),
			false,
		);

		const data = cachedReplies(queryClient, STORY, "a");
		const row = data ? storyComments(data)[0] : undefined;
		expect(row).toMatchObject({ id: "r1", likeCount: 0, viewerLiked: false });
	});
});

describe("deleting a row that still has replies", () => {
	it("replaces it with a tombstone instead of removing it", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a", "b"], null)]);
		seedReplies(queryClient, STORY, "a", [
			{ items: [commentOf("r1", { parentId: "a" })], nextCursor: null },
		]);

		await run(
			queryClient,
			deleteCommentMutationOptions(
				/** The server returns the tombstone; the screen does not guess from replyCount. */
				clientOf({ remove: async () => tombstoneOf("a") }),
				queryClient,
				STORY,
			),
			{ id: "a", parentId: null },
		);

		// Once the row disappears, replies below it would float without a parent, so the slot must stay.
		expect(idsIn(queryClient, STORY)).toEqual(["a", "b"]);
		expect(rowIn(queryClient, "a")?.state).toBe("deleted");
		// Replies stay alive: anyone who expanded the thread must keep seeing them.
		expect(replyIdsIn(queryClient, STORY, "a")).toEqual(["r1"]);
	});

	it("deleting a reply removes it from its thread cell", async () => {
		const queryClient = newClient();
		seedReplies(queryClient, STORY, "a", [
			{
				items: [
					commentOf("r1", { parentId: "a" }),
					commentOf("r2", { parentId: "a" }),
				],
				nextCursor: null,
			},
		]);

		await run(
			queryClient,
			deleteCommentMutationOptions(
				clientOf({ remove: async () => null }),
				queryClient,
				STORY,
			),
			{ id: "r1", parentId: "a" },
		);

		expect(replyIdsIn(queryClient, STORY, "a")).toEqual(["r2"]);
	});
});

describe("when the account changes", () => {
	it("signing out drops held comments", async () => {
		const queryClient = newClient();
		seed(queryClient, STORY, [page(["a", "b"], null)]);
		queryClient.setQueryData(storyDetailQueryKey(STORY), { id: STORY });
		queryClient.setQueryData(VIEWER_QUERY_KEY, { id: "member-1" });

		await resetViewerState(queryClient);

		/**
		 * Marking stale is not enough. The screen draws delete controls by comparing the viewer id with
		 * the author id, so if values are kept while identity changes, the previous identity's
		 * permissions show until refetch (Alice's `My comment` rights would briefly appear on Bob's screen).
		 */
		expect(cached(queryClient, STORY)).toBeUndefined();
	});
});
