import type { CreatorCommentInboxPage } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	CREATOR_COMMENTS_QUERY_KEY_PREFIX,
	type CreatorCommentsInfiniteData,
	creatorCommentInboxItems,
	creatorCommentsInfiniteQueryOptions,
} from "./creator-comments.ts";
import {
	refreshViewerState,
	resetViewerState,
	VIEWER_QUERY_KEY,
} from "./viewer.ts";

/**
 * Cache policy only for the creator's comment inbox. It checks:
 * - The next page passes the server's cursor through unchanged. The client never builds cursors.
 * - Overlapping pages do not list the same comment twice; the screen uses the comment id as a
 *   key.
 * - Logout and login discard cached values rather than keep them. Otherwise the next user would
 *   see the previous user's work titles and the comments left on them.
 */

const item = (id: string, storyId = "s1") => ({
	comment: {
		id,
		storyId,
		parentId: null,
		createdAt: "2026-09-01T00:00:00.000Z",
		replyCount: 0,
		state: "visible" as const,
		author: { id: "m2", nickname: "Carol", avatarUrl: null },
		body: `Body ${id}`,
		likeCount: 0,
		viewerLiked: false,
	},
	story: {
		id: storyId,
		title: "My story",
		visibility: "public" as const,
		hidden: false,
	},
});

const page = (
	ids: string[],
	nextCursor: string | null,
): CreatorCommentInboxPage => ({
	items: ids.map((id) => item(id)),
	nextCursor,
});

function clientOf(pages: Record<string, CreatorCommentInboxPage>) {
	const cursors: string[] = [];
	const client = {
		me: {
			creatorComments: async (input: { cursor?: string }) => {
				const cursor = input.cursor ?? "";
				cursors.push(cursor);
				const found = pages[cursor];
				if (!found) throw new Error(`unknown cursor: ${cursor}`);
				return found;
			},
		},
	} as unknown as RowCatClient;
	return { client, cursors };
}

describe("creatorCommentsInfiniteQueryOptions", () => {
	it("the next page passes the server's cursor as is, and no cursor is the end", async () => {
		const { client, cursors } = clientOf({
			"": page(["c3", "c2"], "opaque-1"),
			"opaque-1": page(["c1"], null),
		});
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const observer = new InfiniteQueryObserver(
			queryClient,
			creatorCommentsInfiniteQueryOptions(client),
		);
		const unsubscribe = observer.subscribe(() => {});
		await observer.refetch();
		expect(observer.getCurrentResult().hasNextPage).toBe(true);

		await observer.fetchNextPage();
		const result = observer.getCurrentResult();
		expect(cursors).toEqual(["", "opaque-1"]);
		expect(result.hasNextPage).toBe(false);
		expect(
			creatorCommentInboxItems(result.data as CreatorCommentsInfiniteData).map(
				(row) => row.comment.id,
			),
		).toEqual(["c3", "c2", "c1"]);
		unsubscribe();
	});

	it('the cell is under `["viewer"]`, which the sign-out prefix covers', () => {
		const { client } = clientOf({});
		const key = creatorCommentsInfiniteQueryOptions(client).queryKey;
		expect(key.slice(0, VIEWER_QUERY_KEY.length)).toEqual([
			...VIEWER_QUERY_KEY,
		]);
	});
});

describe("creatorCommentInboxItems", () => {
	/**
	 * In a newest-first list, new rows are inserted at the top. Refetching the first page can overlap
	 * with a row already on a later page, and that row must appear only once (to avoid a React key
	 * collision).
	 */
	it("the same row on overlapping pages appears once, in the order first received", () => {
		const data: CreatorCommentsInfiniteData = {
			pages: [page(["c4", "c3"], "a"), page(["c3", "c2"], null)],
			pageParams: ["", "a"],
		};
		expect(creatorCommentInboxItems(data).map((row) => row.comment.id)).toEqual(
			["c4", "c3", "c2"],
		);
	});
});

describe("account switch", () => {
	const seeded = () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		queryClient.setQueryData<CreatorCommentsInfiniteData>(
			CREATOR_COMMENTS_QUERY_KEY_PREFIX,
			{ pages: [page(["alice-c1"], null)], pageParams: [""] },
		);
		return queryClient;
	};

	/**
	 * A reset, not an invalidation. If the cached values remained, the next user's screen would render
	 * them.
	 */
	it("signing out drops held values", async () => {
		const queryClient = seeded();
		await resetViewerState(queryClient);
		expect(
			queryClient.getQueryData(CREATOR_COMMENTS_QUERY_KEY_PREFIX),
		).toBeUndefined();
	});

	it("signing in drops held values too", async () => {
		const queryClient = seeded();
		await refreshViewerState(queryClient);
		expect(
			queryClient.getQueryData(CREATOR_COMMENTS_QUERY_KEY_PREFIX),
		).toBeUndefined();
	});
});
