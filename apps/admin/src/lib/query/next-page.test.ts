import type { ModerationQueuePage } from "@rowcat/contracts";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import { type NextPageAxes, nextPageState, pageAxes } from "./next-page.ts";

const axes = (patch: Partial<NextPageAxes> = {}): NextPageAxes => ({
	hasNextPage: false,
	isFetchingNextPage: false,
	isFetchNextPageError: false,
	...patch,
});

describe("nextPageState: the list tail", () => {
	test("`Show more` when there is a next page", () => {
		expect(nextPageState(axes({ hasNextPage: true }))).toBe("more");
	});

	test("the end when everything is loaded", () => {
		expect(nextPageState(axes())).toBe("end");
	});

	test("locked while loading", () => {
		expect(
			nextPageState(axes({ hasNextPage: true, isFetchingNextPage: true })),
		).toBe("loading");
	});

	/**
	 * The cursor remains after a failure, so `hasNextPage` stays true; unless failure comes first it
	 * folds into a plain `Show more` and the press seems to do nothing.
	 */
	test("failure stands before `Show more`", () => {
		expect(
			nextPageState(axes({ hasNextPage: true, isFetchNextPageError: true })),
		).toBe("failed");
	});

	/** Folded into the end, the button vanishes and the operator reads the queue as finished. */
	test("failure is not the end", () => {
		expect(nextPageState(axes({ isFetchNextPageError: true }))).not.toBe("end");
	});
});

describe("pageAxes: upper freshness does not know about the next page's failure", () => {
	test("a next-page failure is not the whole screen's failure", () => {
		expect(
			pageAxes({
				isError: true,
				isFetchNextPageError: true,
				error: new Error("x"),
			}),
		).toEqual({ isError: false, error: null });
	});

	test("failure of the first pages is still failure", () => {
		const error = new Error("x");
		expect(
			pageAxes({ isError: true, isFetchNextPageError: false, error }),
		).toEqual({ isError: true, error });
	});
});

/**
 * On a real `QueryClient`: a failed next page keeps the loaded rows, reads only as the tail's
 * `failed`, and can be requested again with the same cursor.
 */
describe("on a real infinite query", () => {
	const page = (ids: string[], nextCursor: string | null) =>
		({
			items: ids.map((id) => ({ id })),
			nextCursor,
		}) as unknown as ModerationQueuePage;

	test("next page failure → rows stay, only the tail fails, and retrying uses the same cursor", async () => {
		const cursors: string[] = [];
		let failNext = true;
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const observer = new InfiniteQueryObserver(queryClient, {
			queryKey: ["moderation", "queue", "open", ""],
			queryFn: async ({ pageParam }: { pageParam: string }) => {
				cursors.push(pageParam);
				if (pageParam === "") return page(["r1", "r2"], "c-1");
				if (failNext) {
					failNext = false;
					throw new Error("next page failed");
				}
				return page(["r3"], null);
			},
			initialPageParam: "",
			getNextPageParam: (last: ModerationQueuePage) =>
				last.nextCursor ?? undefined,
		});
		const stop = observer.subscribe(() => {});
		await observer.refetch();
		await observer.fetchNextPage();

		let result = observer.getCurrentResult();
		expect(result.data?.pages.flatMap((p) => p.items).length).toBe(2);
		expect(nextPageState(result)).toBe("failed");
		expect(pageAxes(result).isError).toBe(false);

		await observer.fetchNextPage();
		result = observer.getCurrentResult();
		expect(cursors).toEqual(["", "c-1", "c-1"]);
		expect(result.data?.pages.flatMap((p) => p.items).map((r) => r.id)).toEqual(
			["r1", "r2", "r3"],
		);
		expect(nextPageState(result)).toBe("end");
		stop();
	});
});
