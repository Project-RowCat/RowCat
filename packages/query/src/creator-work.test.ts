import type { CreatorWorkPage, Story } from "@rowcat/domain";
import type { RowCatClient, StoryPublishResult } from "@rowcat/sdk";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	CREATOR_WORKS_QUERY_KEY_PREFIX,
	type CreatorWorksInfiniteData,
	creatorWorks,
	creatorWorksTotal,
} from "./creator-work.ts";
import { publishStoryMutationOptions } from "./publication.ts";
import { resetViewerState, VIEWER_QUERY_KEY } from "./viewer.ts";

/**
 * Server-state cache policy for the creator workspace. It checks:
 * - After a publish, the `Published works` column is actually refetched. Otherwise the user must reload to
 *   see their own work.
 * - The invalidation is scoped to this prefix only. Invalidating ["viewer"] as a whole would
 *   refetch viewer, personalization, notifications and account on every publish.
 * - Logout discards cached values rather than marking them stale. If they were only stale, the
 *   next user opening `/create` would see the previous user's unpublished draft titles (P0).
 */

const work = (
	id: string,
	patch: Partial<CreatorWorkPage["items"][number]> = {},
) => ({
	id,
	originDraftId: `draft-${id}`,
	title: `Story ${id}`,
	visibility: "private" as const,
	adult: false,
	promptProtected: false,
	hidden: false,
	coverUrl: null,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-02T00:00:00.000Z",
	...patch,
});

const page = (
	items: CreatorWorkPage["items"],
	patch: Partial<CreatorWorkPage> = {},
): CreatorWorkPage => ({
	items,
	total: items.length,
	page: 1,
	pageSize: 20,
	pageCount: 1,
	...patch,
});

const seeded = (data: CreatorWorksInfiniteData): QueryClient => {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(CREATOR_WORKS_QUERY_KEY_PREFIX, data);
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

describe("query identity", () => {
	/**
	 * Account isolation rests entirely on the key sitting under the ["viewer"] prefix. Login and
	 * logout cleanup already own that prefix, so no separate cleanup is added.
	 */
	it("the cache key is under the viewer prefix", () => {
		expect(CREATOR_WORKS_QUERY_KEY_PREFIX[0]).toBe(VIEWER_QUERY_KEY[0]);
	});

	/**
	 * The member id is not in the key. If it were, the previous user's cell would survive under a
	 * different key, and logout cleanup could not remove it.
	 */
	it("the cache key has no member id", () => {
		expect(CREATOR_WORKS_QUERY_KEY_PREFIX).toEqual(["viewer", "creator-works"]);
	});
});

describe("reading accumulated pages", () => {
	it("joins several pages in order", () => {
		const data: CreatorWorksInfiniteData = {
			pages: [
				page([work("a"), work("b")], { total: 3, page: 1, pageCount: 2 }),
				page([work("c")], { total: 3, page: 2, pageCount: 2 }),
			],
			pageParams: [1, 2],
		};
		expect(creatorWorks(data).map((w) => w.id)).toEqual(["a", "b", "c"]);
	});

	/**
	 * The total is the value the first page reports. Counting accumulated items would make the label
	 * grow with each `Show more` press, and users would read it as works being added.
	 */
	it("the total is the server's count, not the accumulated number", () => {
		const data: CreatorWorksInfiniteData = {
			pages: [page([work("a")], { total: 42, page: 1, pageCount: 42 })],
			pageParams: [1],
		};
		expect(creatorWorks(data)).toHaveLength(1);
		expect(creatorWorksTotal(data)).toBe(42);
	});

	it("no pages means a null total (not 0)", () => {
		expect(creatorWorksTotal({ pages: [], pageParams: [] })).toBeNull();
	});
});

describe("after publishing", () => {
	/**
	 * First publish should add a row. The row is not inserted by hand; only invalidation is used,
	 * because the publish response (a public projection) lacks `originDraftId` and `hidden`. So this
	 * test checks only that the cell was marked stale.
	 */
	it("a successful publish marks the published works cell stale", async () => {
		const queryClient = seeded({ pages: [page([])], pageParams: [1] });
		expect(
			queryClient.getQueryState(CREATOR_WORKS_QUERY_KEY_PREFIX)?.isInvalidated,
		).toBe(false);

		await new MutationObserver(
			queryClient,
			publishStoryMutationOptions(
				clientPublishing(publishedStory("s1")),
				queryClient,
			),
		).mutate({
			originDraftId: "draft-1",
			metadata: {
				title: "Title",
				description: "",
				tags: [],
				orientation: null,
				adult: false,
				visibility: "private",
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
		});

		expect(
			queryClient.getQueryState(CREATOR_WORKS_QUERY_KEY_PREFIX)?.isInvalidated,
		).toBe(true);
	});

	/**
	 * A republish also ends in the same single step. If the screen branched on whether this was the
	 * first publish, that judgment would be wrong on a retry after a lost response.
	 */
	it("an update publish marks the same cell stale", async () => {
		const queryClient = seeded({
			pages: [page([work("s1", { title: "Old title" })])],
			pageParams: [1],
		});

		await new MutationObserver(
			queryClient,
			publishStoryMutationOptions(
				clientPublishing(publishedStory("s1")),
				queryClient,
			),
		).mutate({
			originDraftId: "draft-s1",
			metadata: {
				title: "New title",
				description: "",
				tags: [],
				orientation: null,
				adult: false,
				visibility: "private",
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
		});

		expect(
			queryClient.getQueryState(CREATOR_WORKS_QUERY_KEY_PREFIX)?.isInvalidated,
		).toBe(true);
	});

	/**
	 * Publishing must not invalidate the whole viewer prefix. Doing so would refetch /me,
	 * personalization, notifications and account on every publish, none of which relate to it.
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
		).mutate({
			originDraftId: "draft-1",
			metadata: {
				title: "Title",
				description: "",
				tags: [],
				orientation: null,
				adult: false,
				visibility: "private",
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
		});

		expect(queryClient.getQueryState(VIEWER_QUERY_KEY)?.isInvalidated).toBe(
			false,
		);
	});
});

describe("account switch", () => {
	/**
	 * P0. Invalidation alone leaves the cached values in place. This cell holds the titles of works
	 * not yet shown to anyone. The next user opening `/create` would see them until the refetch
	 * finishes. Logout must discard them.
	 */
	it("signing out **drops** published works rather than marking them stale", async () => {
		const queryClient = seeded({
			pages: [page([work("s1", { title: "A manuscript shown to no one" })])],
			pageParams: [1],
		});

		await resetViewerState(queryClient);

		expect(
			queryClient.getQueryData(CREATOR_WORKS_QUERY_KEY_PREFIX),
		).toBeUndefined();
	});
});
