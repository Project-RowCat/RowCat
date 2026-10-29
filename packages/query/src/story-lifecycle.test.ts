import {
	type CreatorWork,
	type CreatorWorkPage,
	DEFAULT_GALLERY_FILTERS,
	type Story,
	type StoryLifecycleAction,
	type StoryPage,
} from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { CREATOR_ANALYTICS_QUERY_KEY_PREFIX } from "./creator-analytics.ts";
import {
	CREATOR_WORKS_QUERY_KEY_PREFIX,
	type CreatorWorksInfiniteData,
} from "./creator-work.ts";
import { type GalleryInfiniteData, galleryQueryKey } from "./gallery.ts";
import {
	type CreatorStoriesInfiniteData,
	creatorStoriesQueryKey,
} from "./profile.ts";
import { storyDetailQueryKey } from "./story.ts";
import { storyLifecycleMutationOptions } from "./story-lifecycle.ts";

/**
 * Cache policy for lifecycle transitions. Five things are checked, all of which look identical by
 * eye:
 * - After a withdrawing transition, the work leaves public lists immediately. A bare invalidation
 *   would keep the card in the gallery until refetch, and the user would read the button as doing
 *   nothing (blocking removes it immediately for the same reason).
 * - The state of the own-works row moves. Its action set is derived from that state, so a stale
 *   row would keep an archive button on a just-archived work.
 * - The row is not replaced by the response, which lacks originDraftId and hidden.
 * - hidden is not touched. Even briefly drawing 'hiding was lifted' would make the creator stop
 *   disputing it.
 * - The detail slot is dropped after archiving, since the server now returns 404 for it.
 */

const STORY_ID = "s1";
const OTHER_ID = "s2";

const story = (id: string): Story =>
	({
		id,
		title: `Story ${id}`,
		coverUrl: null,
		visibility: "public",
		creator: { id: "me", nickname: "Me" },
		favorites: 3,
	}) as Story;

const storyPage = (items: Story[]): StoryPage => ({
	items,
	total: items.length,
	page: 1,
	pageSize: 24,
	pageCount: 1,
});

const storyPages = (items: Story[]) => ({
	pages: [storyPage(items)],
	pageParams: [1],
});

const work = (id: string, patch: Partial<CreatorWork> = {}): CreatorWork => ({
	id,
	originDraftId: `draft-${id}`,
	title: `Story ${id}`,
	visibility: "public",
	adult: false,
	promptProtected: false,
	hidden: true,
	coverUrl: "https://api.test/v2/stories/s1/cover?v=abc",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-02T00:00:00.000Z",
	...patch,
});

const workPage = (items: CreatorWork[]): CreatorWorkPage => ({
	items,
	total: items.length,
	page: 1,
	pageSize: 20,
	pageCount: 1,
});

const GALLERY_WITH_KEY = galleryQueryKey(DEFAULT_GALLERY_FILTERS);
const GALLERY_WITHOUT_KEY = galleryQueryKey({
	...DEFAULT_GALLERY_FILTERS,
	sort: "popular",
});
const PROFILE_KEY = creatorStoriesQueryKey("me");

/**
 * Structural sharing is turned off. When on, a deeply equal new object comes back as the previous
 * reference, so an implementation that needlessly rebuilt a slot would still pass the check.
 */
const newClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: { retry: false, structuralSharing: false },
			mutations: { retry: false },
		},
	});

/** Fake client with only the functions needed. Calling any other method fails at that point. */
const clientOf = (stories: Partial<RowCatClient["stories"]>): RowCatClient =>
	({ stories }) as RowCatClient;

const clientReturning = (result: Story): RowCatClient =>
	clientOf({
		makePublic: async () => result,
		makeUnlisted: async () => result,
		makePrivate: async () => result,
		archive: async () => result,
		restore: async () => result,
	});

const clientFailing = (): RowCatClient =>
	clientOf({
		makePublic: async () => {
			throw new Error("network");
		},
		makeUnlisted: async () => {
			throw new Error("network");
		},
		makePrivate: async () => {
			throw new Error("network");
		},
		archive: async () => {
			throw new Error("network");
		},
		restore: async () => {
			throw new Error("network");
		},
	});

/**
 * Runs the mutation for real. The callbacks in mutationOptions are attached to the options and do
 * not run on their own. Calling them by hand would let the test invent the order and arguments.
 */
async function run(
	queryClient: QueryClient,
	options: object,
	action: StoryLifecycleAction,
): Promise<"success" | "error"> {
	const observer = new MutationObserver(
		queryClient,
		options as ConstructorParameters<typeof MutationObserver>[1],
	);
	try {
		await observer.mutate(action as never);
		return "success";
	} catch {
		return "error";
	}
}

interface Seeded {
	queryClient: QueryClient;
	galleryWith: GalleryInfiniteData;
	galleryWithout: GalleryInfiniteData;
	profileGrid: CreatorStoriesInfiniteData;
	works: CreatorWorksInfiniteData;
}

/**
 * Fills every slot the transition could touch with real values. If left empty, getQueryState(...)
 * returns undefined, and the 'invalidated' and 'left alone' checks pass without verifying anything.
 */
function seed(visibility: CreatorWork["visibility"] = "public"): Seeded {
	const queryClient = newClient();
	const galleryWith = storyPages([story(STORY_ID), story(OTHER_ID)]);
	const galleryWithout = storyPages([story(OTHER_ID)]);
	const profileGrid = storyPages([story(STORY_ID)]);
	const works: CreatorWorksInfiniteData = {
		pages: [workPage([work(STORY_ID, { visibility }), work(OTHER_ID)])],
		pageParams: [1],
	};

	queryClient.setQueryData(GALLERY_WITH_KEY, galleryWith);
	queryClient.setQueryData(GALLERY_WITHOUT_KEY, galleryWithout);
	queryClient.setQueryData(PROFILE_KEY, profileGrid);
	queryClient.setQueryData(storyDetailQueryKey(STORY_ID), story(STORY_ID));
	queryClient.setQueryData(CREATOR_WORKS_QUERY_KEY_PREFIX, works);
	queryClient.setQueryData(CREATOR_ANALYTICS_QUERY_KEY_PREFIX, {
		pages: [],
		pageParams: [],
	});

	return { queryClient, galleryWith, galleryWithout, profileGrid, works };
}

const worksIn = (queryClient: QueryClient): CreatorWork[] =>
	(
		queryClient.getQueryData(
			CREATOR_WORKS_QUERY_KEY_PREFIX,
		) as CreatorWorksInfiniteData
	).pages.flatMap((page) => page.items);

const galleryIds = (queryClient: QueryClient, key: readonly unknown[]) =>
	(queryClient.getQueryData(key) as GalleryInfiniteData).pages.flatMap((page) =>
		page.items.map((item) => item.id),
	);

const options = (queryClient: QueryClient, client: RowCatClient) =>
	storyLifecycleMutationOptions(client, queryClient, STORY_ID);

describe("withdrawing transitions remove it from public lists immediately", () => {
	/**
	 * Includes unlist as well. Link-shared works open in detail but appear in no gallery, search or
	 * public profile. If such a card stayed in a list on screen, the user would read their button as
	 * doing nothing. The check is the domain predicate (isStoryDiscoverable) and not !== 'public', so
	 * the question it answers stays clear when the vocabulary grows.
	 */
	it.each([
		"unlist",
		"unpublish",
		"archive",
	] as const)("after %s it disappears from the gallery and profile grid", async (action) => {
		const { queryClient } = seed();
		expect(
			await run(
				queryClient,
				options(queryClient, clientReturning(story(STORY_ID))),
				action,
			),
		).toBe("success");

		expect(galleryIds(queryClient, GALLERY_WITH_KEY)).toEqual([OTHER_ID]);
		expect(galleryIds(queryClient, PROFILE_KEY)).toEqual([]);
	});

	it("the total drops too, so the toolbar's 'N stories' matches the list", async () => {
		const { queryClient } = seed();
		await run(
			queryClient,
			options(queryClient, clientReturning(story(STORY_ID))),
			"archive",
		);
		const page = (
			queryClient.getQueryData(GALLERY_WITH_KEY) as GalleryInfiniteData
		).pages[0];
		expect(page?.total).toBe(1);
	});

	it("cells without that story keep **the same reference**", async () => {
		/** A new array would needlessly re-render every card in that slot. */
		const { queryClient, galleryWithout } = seed();
		await run(
			queryClient,
			options(queryClient, clientReturning(story(STORY_ID))),
			"archive",
		);
		expect(queryClient.getQueryData(GALLERY_WITHOUT_KEY)).toBe(galleryWithout);
	});
});

describe("public transitions are not spliced into lists", () => {
	it("after publish it is left to a refetch rather than inserted by hand", async () => {
		/**
		 * Where the work lands in each query is decided by the server's exposure boundary and sort order.
		 * Imitating that here would show the same work twice or silently empty the last page.
		 */
		const { queryClient } = seed("private");
		queryClient.setQueryData(
			GALLERY_WITHOUT_KEY,
			storyPages([story(OTHER_ID)]),
		);

		await run(
			queryClient,
			options(queryClient, clientReturning(story(STORY_ID))),
			"publish",
		);

		expect(galleryIds(queryClient, GALLERY_WITHOUT_KEY)).toEqual([OTHER_ID]);
		expect(queryClient.getQueryState(GALLERY_WITHOUT_KEY)?.isInvalidated).toBe(
			true,
		);
	});
});

describe("`Published works` rows", () => {
	it.each([
		["publish", "public"],
		["unlist", "unlisted"],
		["unpublish", "private"],
		["archive", "archived"],
		["restore", "private"],
	] as const)("after %s that row's exposure becomes %s", async (action, expected) => {
		/**
		 * This is not an invented value but the postcondition of the endpoint. All of these actions are
		 * idempotent for that state, so success means the state holds. It cannot be read from the
		 * response (a Story), which cannot yield originDraftId or hidden.
		 */
		const { queryClient } = seed(action === "restore" ? "archived" : "public");
		await run(
			queryClient,
			options(queryClient, clientReturning(story(STORY_ID))),
			action,
		);
		expect(
			worksIn(queryClient).find((w) => w.id === STORY_ID)?.visibility,
		).toBe(expected);
	});

	it("the row is not replaced by the response; other axes stay", async () => {
		const { queryClient } = seed();
		await run(
			queryClient,
			options(queryClient, clientReturning(story(STORY_ID))),
			"archive",
		);
		const row = worksIn(queryClient).find((w) => w.id === STORY_ID);
		expect(row?.originDraftId).toBe(`draft-${STORY_ID}`);
		expect(row?.coverUrl).not.toBeNull();
	});

	it("**operator hiding is untouched**", async () => {
		/**
		 * If a user briefly sees 'hiding was lifted', they will believe it and stop disputing it. The
		 * server does not write that column, so the cache leaves it alone too.
		 */
		const { queryClient } = seed();
		for (const action of ["unpublish", "publish", "archive"] as const)
			await run(
				queryClient,
				options(queryClient, clientReturning(story(STORY_ID))),
				action,
			);
		expect(worksIn(queryClient).find((w) => w.id === STORY_ID)?.hidden).toBe(
			true,
		);
	});

	it("other stories' rows stay", async () => {
		const { queryClient } = seed();
		await run(
			queryClient,
			options(queryClient, clientReturning(story(STORY_ID))),
			"archive",
		);
		expect(
			worksIn(queryClient).find((w) => w.id === OTHER_ID)?.visibility,
		).toBe("public");
	});
});

describe("story detail", () => {
	it("archiving drops the held value; the server now answers 404", async () => {
		const { queryClient } = seed();
		await run(
			queryClient,
			options(queryClient, clientReturning(story(STORY_ID))),
			"archive",
		);
		expect(
			queryClient.getQueryData(storyDetailQueryKey(STORY_ID)),
		).toBeUndefined();
	});

	it("going private does not drop it; the owner still sees it", async () => {
		const { queryClient } = seed();
		await run(
			queryClient,
			options(queryClient, clientReturning(story(STORY_ID))),
			"unpublish",
		);
		expect(
			queryClient.getQueryData(storyDetailQueryKey(STORY_ID)),
		).toBeDefined();
	});

	/**
	 * Not dropped on a link-public transition either: the address is not closed to anyone, so the
	 * detail stays. Removing a work from discovery lists and dropping its detail are different
	 * decisions. Folding them into one condition would send the link-holder's screen back to a
	 * placeholder because of the creator's action.
	 */
	it("going link-only does not drop it; the address still opens", async () => {
		const { queryClient } = seed();
		await run(
			queryClient,
			options(queryClient, clientReturning(story(STORY_ID))),
			"unlist",
		);
		expect(
			queryClient.getQueryData(storyDetailQueryKey(STORY_ID)),
		).toBeDefined();
	});

	it("does not invent a never-held detail cell", async () => {
		const { queryClient } = seed();
		queryClient.removeQueries({ queryKey: storyDetailQueryKey(STORY_ID) });
		await run(
			queryClient,
			options(queryClient, clientReturning(story(STORY_ID))),
			"unpublish",
		);
		expect(
			queryClient.getQueryData(storyDetailQueryKey(STORY_ID)),
		).toBeUndefined();
	});
});

describe("invalidation scope", () => {
	it("refetches the workspace and analytics too", async () => {
		/**
		 * The analytics list also draws the exposure state. The metrics do not change with this action,
		 * so they are not patched by hand: inventing the inputs would write wrong values.
		 */
		const { queryClient } = seed();
		await run(
			queryClient,
			options(queryClient, clientReturning(story(STORY_ID))),
			"archive",
		);
		expect(
			queryClient.getQueryState(CREATOR_WORKS_QUERY_KEY_PREFIX)?.isInvalidated,
		).toBe(true);
		expect(
			queryClient.getQueryState(CREATOR_ANALYTICS_QUERY_KEY_PREFIX)
				?.isInvalidated,
		).toBe(true);
	});

	it("does not invalidate all of `['viewer']`", async () => {
		/**
		 * Otherwise a single transition would refetch the viewer, personalization, notifications and
		 * account.
		 */
		const { queryClient } = seed();
		queryClient.setQueryData(["viewer"], { id: "me" });
		await run(
			queryClient,
			options(queryClient, clientReturning(story(STORY_ID))),
			"archive",
		);
		expect(queryClient.getQueryState(["viewer"])?.isInvalidated).toBe(false);
	});
});

describe("failure", () => {
	it("a refusal moves no cache cell", async () => {
		/**
		 * This is the substance of the no-optimistic-update claim. A falsehood drawn briefly here would
		 * be 'this work is no longer public', and someone might leave trusting it.
		 */
		const { queryClient, galleryWith, works } = seed();
		expect(
			await run(queryClient, options(queryClient, clientFailing()), "archive"),
		).toBe("error");

		expect(queryClient.getQueryData(GALLERY_WITH_KEY)).toBe(galleryWith);
		expect(queryClient.getQueryData(CREATOR_WORKS_QUERY_KEY_PREFIX)).toBe(
			works,
		);
		expect(
			queryClient.getQueryState(CREATOR_WORKS_QUERY_KEY_PREFIX)?.isInvalidated,
		).toBe(false);
		expect(
			queryClient.getQueryData(storyDetailQueryKey(STORY_ID)),
		).toBeDefined();
	});
});
