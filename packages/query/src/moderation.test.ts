import type {
	ModerationAppealsPage,
	ModerationQueuePage,
} from "@rowcat/contracts";
import type { RowCatClient } from "@rowcat/sdk";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	type ModerationQueueInfiniteData,
	moderationAppealsInfiniteQueryOptions,
	moderationPageRows,
	moderationQueueInfiniteQueryOptions,
} from "./moderation.ts";
import { refreshViewerState, resetViewerState } from "./viewer.ts";

/**
 * Covers only the append policy of the operator queue and appeal lists:
 * - The next page passes the server's cursor through unchanged.
 * - A cursor never leaves the filter that produced it. The first request after a filter change
 *   has no cursor.
 * - A failed next-page request keeps the rows already received.
 * - The same report appearing on two pages renders as one row.
 * - An identity change clears operator data.
 */

const report = (id: string) => ({
	id,
	caseId: `case-${id}`,
	targetType: "story" as const,
	targetId: `story-${id}`,
	reason: "spam" as const,
	status: "open" as const,
	createdAt: "2026-09-01T00:00:00.000Z",
	caseReportCount: 1,
});

const queuePage = (
	ids: string[],
	nextCursor: string | null,
): ModerationQueuePage => ({ items: ids.map(report), nextCursor });

type QueueCall = { status?: string; targetType?: string; cursor?: string };

function queueClient(reply: (call: QueueCall) => Promise<ModerationQueuePage>) {
	const calls: QueueCall[] = [];
	const client = {
		moderation: {
			queue: (input: QueueCall) => {
				calls.push(input);
				return reply(input);
			},
			appeals: (input: { status?: string; cursor?: string }) => {
				calls.push(input);
				return Promise.resolve<ModerationAppealsPage>({
					items: [],
					nextCursor: input.cursor ? null : "appeal-cursor",
				});
			},
		},
	} as unknown as RowCatClient;
	return { client, calls };
}

const freshClient = () =>
	new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("moderationQueueInfiniteQueryOptions", () => {
	it("the next page uses the received cursor as is, and no cursor is the end", async () => {
		const { client, calls } = queueClient(async (call) =>
			call.cursor === "c-1"
				? queuePage(["r3"], null)
				: queuePage(["r1", "r2"], "c-1"),
		);
		const queryClient = freshClient();
		const observer = new InfiniteQueryObserver(
			queryClient,
			moderationQueueInfiniteQueryOptions(client, "open", ""),
		);
		const stop = observer.subscribe(() => {});
		await observer.refetch();
		await observer.fetchNextPage();
		const result = observer.getCurrentResult();

		expect(calls.map((call) => call.cursor)).toEqual(["", "c-1"]);
		expect(result.hasNextPage).toBe(false);
		expect(
			moderationPageRows(result.data as ModerationQueueInfiniteData).map(
				(row) => row.id,
			),
		).toEqual(["r1", "r2", "r3"]);
		stop();
	});

	/**
	 * Different filters use different cells, so no path carries one filter's cursor into the first
	 * request of another. This assertion is why the screen does not hold a cursor itself.
	 */
	it("a query with changed filters asks from the first page without a cursor", async () => {
		const { client, calls } = queueClient(async (call) =>
			call.cursor ? queuePage(["r9"], null) : queuePage(["r1"], "c-open"),
		);
		const queryClient = freshClient();
		const open = new InfiniteQueryObserver(
			queryClient,
			moderationQueueInfiniteQueryOptions(client, "open", ""),
		);
		const stopOpen = open.subscribe(() => {});
		await open.refetch();
		await open.fetchNextPage();
		stopOpen();

		const resolved = new InfiniteQueryObserver(
			queryClient,
			moderationQueueInfiniteQueryOptions(client, "resolved", "comment"),
		);
		const stopResolved = resolved.subscribe(() => {});
		await resolved.refetch();
		stopResolved();

		expect(calls.at(-1)).toEqual({
			status: "resolved",
			targetType: "comment",
			cursor: "",
		});
		/**
		 * A previous filter's cell keeps its own pages. Returning to it resumes where the appending left
		 * off.
		 */
		expect(
			moderationPageRows(
				queryClient.getQueryData<ModerationQueueInfiniteData>(
					moderationQueueInfiniteQueryOptions(client, "open", "").queryKey,
				) as ModerationQueueInfiniteData,
			).map((row) => row.id),
		).toEqual(["r1", "r9"]);
	});

	/**
	 * If a next-page failure cleared the rows already received, the failure would read as `the queue is empty`
	 * (the queue is empty).
	 */
	it("a failed next page keeps the pages already received", async () => {
		const { client } = queueClient(async (call) => {
			if (call.cursor) throw new Error("next page failed");
			return queuePage(["r1", "r2"], "c-1");
		});
		const queryClient = freshClient();
		const observer = new InfiniteQueryObserver(
			queryClient,
			moderationQueueInfiniteQueryOptions(client, "open", ""),
		);
		const stop = observer.subscribe(() => {});
		await observer.refetch();
		await observer.fetchNextPage();
		const result = observer.getCurrentResult();

		expect(result.isFetchNextPageError).toBe(true);
		expect(result.hasNextPage).toBe(true);
		expect(
			moderationPageRows(result.data as ModerationQueueInfiniteData).map(
				(row) => row.id,
			),
		).toEqual(["r1", "r2"]);
		stop();
	});
});

describe("moderationAppealsInfiniteQueryOptions", () => {
	it("status is the key, and the next page uses the received cursor", async () => {
		const { client, calls } = queueClient(async () => queuePage([], null));
		const queryClient = freshClient();
		const observer = new InfiniteQueryObserver(
			queryClient,
			moderationAppealsInfiniteQueryOptions(client, "open"),
		);
		const stop = observer.subscribe(() => {});
		await observer.refetch();
		await observer.fetchNextPage();
		expect(calls).toEqual([
			{ status: "open", cursor: "" },
			{ status: "open", cursor: "appeal-cursor" },
		]);
		expect(
			moderationAppealsInfiniteQueryOptions(client, "accepted").queryKey,
		).not.toEqual(
			moderationAppealsInfiniteQueryOptions(client, "open").queryKey,
		);
		stop();
	});
});

describe("moderationPageRows", () => {
	it("the same report across two pages appears once where it came first", () => {
		expect(
			moderationPageRows({
				pages: [queuePage(["r1", "r2"], "c"), queuePage(["r2", "r3"], null)],
			}).map((row) => row.id),
		).toEqual(["r1", "r2", "r3"]);
	});
});

/**
 * Operator data is removed along with the identity, so other people's report evidence and sanction
 * reasons do not stay in the next person's browser memory. The ops console also calls clear() on
 * logout, but this test does not rely on that one line alone.
 */
describe("identity switch", () => {
	const seeded = () => {
		const queryClient = freshClient();
		const { client } = queueClient(async () => queuePage([], null));
		const key = moderationQueueInfiniteQueryOptions(
			client,
			"open",
			"",
		).queryKey;
		queryClient.setQueryData<ModerationQueueInfiniteData>(key, {
			pages: [queuePage(["r1"], "c-1")],
			pageParams: [""],
		});
		return { queryClient, key };
	};

	it("signing out drops the queue's pages and cursors", async () => {
		const { queryClient, key } = seeded();
		await resetViewerState(queryClient);
		expect(queryClient.getQueryData(key)).toBeUndefined();
	});

	it("signing in drops the queue's pages and cursors too", async () => {
		const { queryClient, key } = seeded();
		await refreshViewerState(queryClient);
		expect(queryClient.getQueryData(key)).toBeUndefined();
	});
});
