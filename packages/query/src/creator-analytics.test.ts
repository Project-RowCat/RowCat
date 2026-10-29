import { CreatorAnalyticsWindow as CreatorAnalyticsWindowContract } from "@rowcat/contracts";
import {
	CREATOR_ANALYTICS_WINDOWS,
	type CreatorAnalyticsPage,
	type Story,
} from "@rowcat/domain";
import type { RowCatClient, StoryPublishResult } from "@rowcat/sdk";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	CREATOR_ANALYTICS_QUERY_KEY_PREFIX,
	type CreatorAnalyticsInfiniteData,
	creatorAnalyticsQueryKey,
	creatorAnalyticsSummary,
	creatorAnalyticsTotal,
	creatorAnalyticsWorks,
} from "./creator-analytics.ts";
import { publishStoryMutationOptions } from "./publication.ts";
import { resetViewerState, VIEWER_QUERY_KEY } from "./viewer.ts";

/**
 * File header: covers only the cache policy of creator analytics. It guards three things:
 * - The total is the server-counted value, not a sum of the loaded rows. Summing would make each
 *   `Show more` press grow the total, which users read as views rising.
 * - After publishing, the analytics cell is actually refetched, and that invalidation is scoped
 *   to this prefix alone.
 * - Logout discards the cached value rather than marking it stale. A stale-only cell would show
 *   the next user the previous user's unpublished titles and performance on
 *   `/create?view=analytics` until the refetch completes (P0).
 */

const work = (
	id: string,
	patch: Partial<CreatorAnalyticsPage["items"][number]> = {},
) => ({
	id,
	title: `Story ${id}`,
	visibility: "private" as const,
	hidden: false,
	views: 10,
	favorites: 2,
	comments: 1,
	playStarts: 0,
	windowViews: 10,
	windowPlayStarts: 0,
	updatedAt: "2026-01-02T00:00:00.000Z",
	...patch,
});

const page = (
	items: CreatorAnalyticsPage["items"],
	patch: Partial<CreatorAnalyticsPage> = {},
): CreatorAnalyticsPage => ({
	window: "all",
	since: null,
	summary: {
		views: 999,
		favorites: 88,
		comments: 7,
		playStarts: 0,
		windowViews: 999,
		windowPlayStarts: 0,
	},
	items,
	total: items.length,
	page: 1,
	pageSize: 24,
	pageCount: 1,
	...patch,
});

const seeded = (data: CreatorAnalyticsInfiniteData): QueryClient => {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(CREATOR_ANALYTICS_QUERY_KEY_PREFIX, data);
	return queryClient;
};

const publishedStory = (id: string): Story =>
	({ id, title: "Published", creator: { id: "me", nickname: "Me" } }) as Story;

const clientPublishing = (story: Story): RowCatClient =>
	({
		stories: {
			publish: async (): Promise<StoryPublishResult> => ({
				created: true,
				story,
			}),
		},
	}) as unknown as RowCatClient;

const publishRequest = {
	originDraftId: "draft-1",
	metadata: {
		title: "Title",
		description: "",
		tags: [],
		orientation: null,
		adult: false,
		visibility: "private" as const,
		promptProtected: false,
	},
	play: {
		tagline: "",
		scenario: "",
		firstScene: "",
		playGuide: "",
		persona: null,
		characters: [],
		lore: [],
		startScenes: [],
		sceneImages: [],
	},
};

describe("query identity", () => {
	/**
	 * Account isolation rests entirely on this key sitting under the ["viewer"] prefix. Login and
	 * logout cleanup already owns that prefix, so no separate cleanup is added.
	 */
	it("the cache key is under the viewer prefix", () => {
		expect(CREATOR_ANALYTICS_QUERY_KEY_PREFIX[0]).toBe("viewer");
		expect([...CREATOR_ANALYTICS_QUERY_KEY_PREFIX]).toEqual([
			"viewer",
			"creator-analytics",
		]);
	});

	/**
	 * Putting a member id in the key would leave the previous user's cell alive under a different key.
	 * Viewer cleanup works by prefix. Per-user cells under that prefix would make the set of cells it
	 * clears depend on who is logged in.
	 */
	it("the cache key has no member id", () => {
		expect(CREATOR_ANALYTICS_QUERY_KEY_PREFIX).toHaveLength(2);
	});

	/**
	 * Must not share a cell with the sibling column. Re-querying the metrics must not turn into
	 * re-querying the works list.
	 */
	it("a different key from the published works cell", () => {
		expect(CREATOR_ANALYTICS_QUERY_KEY_PREFIX[1]).not.toBe("creator-works");
	});
});

describe("reading accumulated pages", () => {
	it("joins several pages in order", () => {
		const data: CreatorAnalyticsInfiniteData = {
			pages: [
				page([work("s1"), work("s2")], { total: 3, pageCount: 2 }),
				page([work("s3")], { page: 2, total: 3, pageCount: 2 }),
			],
			pageParams: [1, 2],
		};
		expect(creatorAnalyticsWorks(data).map((w) => w.id)).toEqual([
			"s1",
			"s2",
			"s3",
		]);
	});

	/**
	 * The most important assertion in this file. The total is the value the server counts across the
	 * owner's whole set, not the sum of the rows on screen. Summing the accumulated rows would grow
	 * the number on every `Show more` press.
	 */
	it("the sum is the server's count, not the sum of held rows", () => {
		const data: CreatorAnalyticsInfiniteData = {
			pages: [
				page([work("s1", { views: 1, favorites: 1, comments: 1 })], {
					summary: {
						views: 30,
						favorites: 7,
						comments: 7,
						playStarts: 4,
						windowViews: 30,
						windowPlayStarts: 4,
					},
					total: 2,
					pageCount: 2,
				}),
			],
			pageParams: [1],
		};
		expect(creatorAnalyticsSummary(data)).toEqual({
			views: 30,
			favorites: 7,
			comments: 7,
			playStarts: 4,
			windowViews: 30,
			windowPlayStarts: 4,
		});
		expect(creatorAnalyticsTotal(data)).toBe(2);
	});

	/**
	 * The total stays the same as more pages load. The server attaches the same summary value to every
	 * page.
	 */
	it("more pages do not grow the sum", () => {
		const summary = {
			views: 30,
			favorites: 7,
			comments: 7,
			playStarts: 0,
			windowViews: 30,
			windowPlayStarts: 0,
		};
		const one: CreatorAnalyticsInfiniteData = {
			pages: [page([work("s1")], { summary, total: 2, pageCount: 2 })],
			pageParams: [1],
		};
		const two: CreatorAnalyticsInfiniteData = {
			pages: [
				...one.pages,
				page([work("s2")], { summary, page: 2, total: 2, pageCount: 2 }),
			],
			pageParams: [1, 2],
		};
		expect(creatorAnalyticsSummary(two)).toEqual(creatorAnalyticsSummary(one));
	});

	/**
	 * With no pages loaded the total is null, not 0. A 0 would claim the works have no performance,
	 * which cannot be known before anything has loaded.
	 */
	it("no pages means null sum and total", () => {
		const empty: CreatorAnalyticsInfiniteData = { pages: [], pageParams: [] };
		expect(creatorAnalyticsSummary(empty)).toBeNull();
		expect(creatorAnalyticsTotal(empty)).toBeNull();
	});
});

describe("after publishing", () => {
	/**
	 * On first publish the work is not yet in the analytics list. The row is not inserted by hand:
	 * inventing zeroed metrics would overwrite the view counts a republished work already has, and
	 * skew the total with it.
	 */
	it("a successful publish marks the analytics cell stale", async () => {
		const queryClient = seeded({ pages: [page([])], pageParams: [1] });
		expect(
			queryClient.getQueryState(CREATOR_ANALYTICS_QUERY_KEY_PREFIX)
				?.isInvalidated,
		).toBe(false);

		await new MutationObserver(
			queryClient,
			publishStoryMutationOptions(
				clientPublishing(publishedStory("s1")),
				queryClient,
			),
		).mutate(publishRequest);

		expect(
			queryClient.getQueryState(CREATOR_ANALYTICS_QUERY_KEY_PREFIX)
				?.isInvalidated,
		).toBe(true);
	});

	/**
	 * Metrics are never edited by hand. Held values are only marked stale and must stay in place. If
	 * the publish response wrote zeros there, the creator would see their performance disappear.
	 */
	it("publishing does not overwrite held metrics with 0", async () => {
		const queryClient = seeded({
			pages: [page([work("s1", { views: 8240 })])],
			pageParams: [1],
		});

		await new MutationObserver(
			queryClient,
			publishStoryMutationOptions(
				clientPublishing(publishedStory("s1")),
				queryClient,
			),
		).mutate(publishRequest);

		const data = queryClient.getQueryData<CreatorAnalyticsInfiniteData>(
			CREATOR_ANALYTICS_QUERY_KEY_PREFIX,
		);
		expect(data?.pages[0]?.items[0]?.views).toBe(8240);
		expect(data?.pages[0]?.summary).toEqual({
			views: 999,
			favorites: 88,
			comments: 7,
			playStarts: 0,
			windowViews: 999,
			windowPlayStarts: 0,
		});
	});

	/**
	 * Publishing must not invalidate the whole viewer prefix. Doing so would refetch /me,
	 * personalization, notifications, account and billing on every publish.
	 */
	it("publishing does not invalidate the viewer query", async () => {
		const queryClient = seeded({ pages: [page([])], pageParams: [1] });
		queryClient.setQueryData(VIEWER_QUERY_KEY, { id: "me" });

		await new MutationObserver(
			queryClient,
			publishStoryMutationOptions(
				clientPublishing(publishedStory("s1")),
				queryClient,
			),
		).mutate(publishRequest);

		expect(queryClient.getQueryState(VIEWER_QUERY_KEY)?.isInvalidated).toBe(
			false,
		);
	});
});

describe("account switch", () => {
	/**
	 * P0. Invalidation alone leaves the cached values in place. This cell holds titles of unpublished
	 * works and how often they were read, so the next user opening `/create?view=analytics` would see
	 * them until the refetch finishes. Logout must discard the data.
	 */
	it("signing out **drops** analytics rather than marking it stale", async () => {
		const queryClient = seeded({
			pages: [
				page([
					work("s1", { title: "A manuscript shown to no one", views: 8240 }),
				]),
			],
			pageParams: [1],
		});

		await resetViewerState(queryClient);

		expect(
			queryClient.getQueryData(CREATOR_ANALYTICS_QUERY_KEY_PREFIX),
		).toBeUndefined();
	});
});

/**
 * Checks that the window vocabularies match. The domain does not import the contract, so this
 * assembly point compares the two. If only one side gains a value, the screen would draw a window
 * the server rejects with 400.
 */
describe("window vocabulary", () => {
	it("domain and contract hold the same values", () => {
		expect([...CREATOR_ANALYTICS_WINDOWS]).toEqual(
			CreatorAnalyticsWindowContract.options,
		);
	});

	it("each window is a different cell, all under the prefix", () => {
		const keys = CREATOR_ANALYTICS_WINDOWS.map((window) =>
			JSON.stringify(creatorAnalyticsQueryKey(window)),
		);
		expect(new Set(keys).size).toBe(CREATOR_ANALYTICS_WINDOWS.length);
		for (const window of CREATOR_ANALYTICS_WINDOWS)
			expect(creatorAnalyticsQueryKey(window).slice(0, 2)).toEqual([
				...CREATOR_ANALYTICS_QUERY_KEY_PREFIX,
			]);
	});
});
