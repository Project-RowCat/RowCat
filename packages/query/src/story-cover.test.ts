import {
	type CreatorWork,
	type CreatorWorkPage,
	DEFAULT_GALLERY_FILTERS,
	type Story,
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
import {
	GALLERY_QUERY_KEY_PREFIX,
	type GalleryInfiniteData,
	galleryQueryKey,
} from "./gallery.ts";
import {
	type CreatorStoriesInfiniteData,
	creatorStoriesQueryKey,
} from "./profile.ts";
import { storyDetailQueryKey } from "./story.ts";
import {
	removeStoryCoverMutationOptions,
	setStoryCoverMutationOptions,
} from "./story-cover.ts";
import { VIEWER_QUERY_KEY } from "./viewer.ts";

/**
 * Cache policy for cover writes. The SDK request itself is not checked here.
 * - After a cover change, all four slots must hold the new address. The public profile grid is
 *   easy to miss (the favorite patch forgets it), and a user with their profile open would keep the
 *   old image there until reload.
 * - No detail slot may be created for a work that was never cached. The response is the owner
 *   projection, which includes archived and operator-hidden works whose public detail is 404.
 * - The own-works row is patched in place, not replaced: the response is a Story without
 *   originDraftId, hidden or the three-valued visibility.
 * - Nothing is invalidated. A cover change moves no membership, order or metric, so a refetch is
 *   pure waste that no error reveals.
 * - Unrelated gallery slots keep the same reference; a new array would re-render all their cards.
 */

const STORY_ID = "s1";
const OTHER_ID = "s2";
const OLD_COVER = "https://api.test/v2/stories/s1/cover?v=0f0f0f0f";
const NEW_COVER = "https://api.test/v2/stories/s1/cover?v=beefbeef";

const story = (id: string, coverUrl: string | null): Story =>
	({
		id,
		title: `Story ${id}`,
		coverUrl,
		creator: { id: "me", nickname: "Me" },
		favorites: 0,
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
	title: `Title the draft knows ${id}`,
	visibility: "archived",
	adult: false,
	promptProtected: false,
	hidden: true,
	coverUrl: OLD_COVER,
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

/**
 * A gallery slot that contains the work, and one that does not. Different filters mean different
 * slots.
 */
const GALLERY_WITH_KEY = galleryQueryKey(DEFAULT_GALLERY_FILTERS);
const GALLERY_WITHOUT_KEY = galleryQueryKey({
	...DEFAULT_GALLERY_FILTERS,
	sort: "popular",
});

/**
 * Structural sharing is turned off. When on, TanStack Query returns the previous reference for a
 * deeply equal new object, so an implementation that needlessly rebuilt a slot would still pass the
 * same-reference check.
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
		setCover: async () => result,
		removeCover: async () => result,
	});

const clientFailing = (): RowCatClient =>
	clientOf({
		setCover: async () => {
			throw new Error("network");
		},
		removeCover: async () => {
			throw new Error("network");
		},
	});

/**
 * Runs the mutation for real. The callbacks in mutationOptions are attached to the options and do
 * not run on their own. Calling them by hand would let the test invent the order and arguments, so
 * a mismatch with how the library calls them would still pass.
 */
async function run(
	queryClient: QueryClient,
	options: object,
	variables: unknown,
): Promise<"success" | "error"> {
	const observer = new MutationObserver(
		queryClient,
		options as ConstructorParameters<typeof MutationObserver>[1],
	);
	try {
		await observer.mutate(variables as never);
		return "success";
	} catch {
		return "error";
	}
}

interface Seeded {
	queryClient: QueryClient;
	galleryWith: GalleryInfiniteData;
	/** Gallery slot without the work. This write must leave it untouched. */
	galleryWithout: GalleryInfiniteData;
	profileGrid: CreatorStoriesInfiniteData;
	detail: Story;
	works: CreatorWorksInfiniteData;
	analytics: unknown;
}

/**
 * Fills the four slots where the cover is drawn, plus the two slots this write must not touch. The
 * last two (analytics and viewer) are seeded with real values on purpose: if left empty,
 * getQueryState(...) returns undefined and the 'not invalidated' check passes without checking
 * anything.
 */
function seed(coverUrl: string | null = OLD_COVER): Seeded {
	const queryClient = newClient();
	const galleryWith = storyPages([
		story(STORY_ID, coverUrl),
		story(OTHER_ID, null),
	]);
	const galleryWithout = storyPages([story(OTHER_ID, null)]);
	const profileGrid = storyPages([story(STORY_ID, coverUrl)]);
	const detail = story(STORY_ID, coverUrl);
	const works: CreatorWorksInfiniteData = {
		pages: [
			workPage([work(STORY_ID, { coverUrl }), work(OTHER_ID, { coverUrl })]),
		],
		pageParams: [1],
	};
	const analytics = { pages: [], pageParams: [] };

	queryClient.setQueryData(GALLERY_WITH_KEY, galleryWith);
	queryClient.setQueryData(GALLERY_WITHOUT_KEY, galleryWithout);
	queryClient.setQueryData(creatorStoriesQueryKey("me"), profileGrid);
	queryClient.setQueryData(storyDetailQueryKey(STORY_ID), detail);
	queryClient.setQueryData(CREATOR_WORKS_QUERY_KEY_PREFIX, works);
	queryClient.setQueryData(CREATOR_ANALYTICS_QUERY_KEY_PREFIX, analytics);
	queryClient.setQueryData(VIEWER_QUERY_KEY, { id: "me" });

	return {
		queryClient,
		galleryWith,
		galleryWithout,
		profileGrid,
		detail,
		works,
		analytics,
	};
}

const coverIn = (
	queryClient: QueryClient,
	key: readonly unknown[],
	storyId = STORY_ID,
): string | null | undefined =>
	queryClient
		.getQueryData<GalleryInfiniteData>(key)
		?.pages.flatMap((page) => page.items)
		.find((s) => s.id === storyId)?.coverUrl;

const workRow = (
	queryClient: QueryClient,
	storyId: string,
): CreatorWork | undefined =>
	queryClient
		.getQueryData<CreatorWorksInfiniteData>(CREATOR_WORKS_QUERY_KEY_PREFIX)
		?.pages.flatMap((page) => page.items)
		.find((w) => w.id === storyId);

const isInvalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
	queryClient.getQueryState(key)?.isInvalidated;

const image = () => new Blob(["cover bytes"], { type: "image/png" });

describe("setStoryCoverMutationOptions", () => {
	it("gallery pages carrying that story get the new cover address", async () => {
		const { queryClient } = seed();

		await run(
			queryClient,
			setStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, NEW_COVER)),
				queryClient,
				STORY_ID,
			),
			image(),
		);

		expect(coverIn(queryClient, GALLERY_WITH_KEY)).toBe(NEW_COVER);
	});

	/**
	 * A query that does not contain the work keeps the same reference. A new array would needlessly
	 * re-render that slot's cards, and a slot never cached would be born with no observer.
	 */
	it("gallery pages without that story keep the same reference", async () => {
		const { queryClient, galleryWithout } = seed();

		await run(
			queryClient,
			setStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, NEW_COVER)),
				queryClient,
				STORY_ID,
			),
			image(),
		);

		expect(queryClient.getQueryData(GALLERY_WITHOUT_KEY)).toBe(galleryWithout);
	});

	/**
	 * This is the slot the favorite patch actually forgets. The public profile's work grid uses a
	 * different prefix (['creators', 'stories']) from the gallery, so an implementation that only
	 * walks the gallery skips it. A user with their own profile open who changes the cover keeps the
	 * old image in that grid.
	 */
	it("the public profile grid gets the new cover address too", async () => {
		const { queryClient } = seed();

		await run(
			queryClient,
			setStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, NEW_COVER)),
				queryClient,
				STORY_ID,
			),
			image(),
		);

		expect(coverIn(queryClient, creatorStoriesQueryKey("me"))).toBe(NEW_COVER);
	});

	it("a held detail cell is replaced with the server's confirmed story", async () => {
		const { queryClient } = seed();
		const confirmed = story(STORY_ID, NEW_COVER);

		await run(
			queryClient,
			setStoryCoverMutationOptions(
				clientReturning(confirmed),
				queryClient,
				STORY_ID,
			),
			image(),
		);

		expect(queryClient.getQueryData(storyDetailQueryKey(STORY_ID))).toBe(
			confirmed,
		);
	});

	/**
	 * Does not create a detail slot that was never cached. The response is the owner projection, so it
	 * includes archived and operator-hidden works, and the public detail for those returns 404 from
	 * the server. Seeding such a slot would make the detail screen draw a work the server does not
	 * hand out. The value has no observer, so it is never refetched and does not heal.
	 */
	it("a never-held detail cell is not invented", async () => {
		const { queryClient } = seed();
		queryClient.removeQueries({ queryKey: storyDetailQueryKey(STORY_ID) });

		await run(
			queryClient,
			setStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, NEW_COVER)),
				queryClient,
				STORY_ID,
			),
			image(),
		);

		expect(
			queryClient.getQueryData(storyDetailQueryKey(STORY_ID)),
		).toBeUndefined();
	});

	/**
	 * Exactly one axis moves in the own-works row. Replacing the row with the response would drop
	 * originDraftId (the bridge to the draft), hidden (operator hide) and the three-valued visibility,
	 * which the Story response does not carry. The work whose cover just changed would lose `Edit draft`,
	 * or an archived work would show as public.
	 */
	it("a published works row changes only its cover address", async () => {
		const { queryClient } = seed();
		const before = workRow(queryClient, STORY_ID);

		await run(
			queryClient,
			setStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, NEW_COVER)),
				queryClient,
				STORY_ID,
			),
			image(),
		);

		const after = workRow(queryClient, STORY_ID);
		expect(after?.coverUrl).toBe(NEW_COVER);
		expect(after?.originDraftId).toBe(before?.originDraftId);
		expect(after?.hidden).toBe(true);
		expect(after?.visibility).toBe("archived");
		expect(after?.updatedAt).toBe("2026-01-02T00:00:00.000Z");
		// The title also stays as this list knew it, not the response's value.
		expect(after).toEqual({ ...before, coverUrl: NEW_COVER });
	});

	it("rows whose cover did not change are untouched", async () => {
		const { queryClient } = seed();
		const untouched = workRow(queryClient, OTHER_ID);

		await run(
			queryClient,
			setStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, NEW_COVER)),
				queryClient,
				STORY_ID,
			),
			image(),
		);

		expect(workRow(queryClient, OTHER_ID)).toBe(untouched);
	});
});

describe("removeStoryCoverMutationOptions", () => {
	it("the cover address becomes null in all four places", async () => {
		const { queryClient } = seed();

		await run(
			queryClient,
			removeStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, null)),
				queryClient,
				STORY_ID,
			),
			undefined,
		);

		expect(coverIn(queryClient, GALLERY_WITH_KEY)).toBeNull();
		expect(coverIn(queryClient, creatorStoriesQueryKey("me"))).toBeNull();
		expect(
			queryClient.getQueryData<Story>(storyDetailQueryKey(STORY_ID))?.coverUrl,
		).toBeNull();
		expect(workRow(queryClient, STORY_ID)?.coverUrl).toBeNull();
	});

	it("deletion also keeps unrelated pages and rows as the same reference", async () => {
		const { queryClient, galleryWithout } = seed();
		const untouched = workRow(queryClient, OTHER_ID);

		await run(
			queryClient,
			removeStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, null)),
				queryClient,
				STORY_ID,
			),
			undefined,
		);

		expect(queryClient.getQueryData(GALLERY_WITHOUT_KEY)).toBe(galleryWithout);
		expect(workRow(queryClient, OTHER_ID)).toBe(untouched);
	});

	it("deletion does not invent a never-held detail cell either", async () => {
		const { queryClient } = seed();
		queryClient.removeQueries({ queryKey: storyDetailQueryKey(STORY_ID) });

		await run(
			queryClient,
			removeStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, null)),
				queryClient,
				STORY_ID,
			),
			undefined,
		);

		expect(
			queryClient.getQueryData(storyDetailQueryKey(STORY_ID)),
		).toBeUndefined();
	});
});

describe("invalidation", () => {
	/**
	 * Invalidates nothing; that is the nature of this write. Publishing invalidates the gallery, `Published
	 * works` and analytics, because those lists change membership and order (a row is created and
	 * updated_at moves). A cover swap touches none of those axes: the server does not modify the story
	 * row, and views, favorites and comments are unrelated to the cover. A refetch would be pure
	 * waste, and the waste is invisible because it produces no error.
	 */
	it("changing the cover does not mark the published works cell stale", async () => {
		const { queryClient } = seed();
		expect(isInvalidated(queryClient, CREATOR_WORKS_QUERY_KEY_PREFIX)).toBe(
			false,
		);

		await run(
			queryClient,
			setStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, NEW_COVER)),
				queryClient,
				STORY_ID,
			),
			image(),
		);

		expect(isInvalidated(queryClient, CREATOR_WORKS_QUERY_KEY_PREFIX)).toBe(
			false,
		);
	});

	/**
	 * Analytics has nothing to do with the cover. None of the three figures on that screen (views,
	 * favorites, comments) moves with it, yet invalidating would rerun the server's aggregate queries
	 * on every cover change.
	 */
	it("neither analytics nor the viewer goes stale", async () => {
		const { queryClient } = seed();

		await run(
			queryClient,
			setStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, NEW_COVER)),
				queryClient,
				STORY_ID,
			),
			image(),
		);

		expect(isInvalidated(queryClient, CREATOR_ANALYTICS_QUERY_KEY_PREFIX)).toBe(
			false,
		);
		/**
		 * Invalidating the whole ['viewer'] prefix would refetch the viewer, personalization,
		 * notifications, account and billing on one cover change. None of the five relates to the cover.
		 */
		expect(isInvalidated(queryClient, VIEWER_QUERY_KEY)).toBe(false);
	});

	it("the gallery prefix does not go stale either", async () => {
		const { queryClient } = seed();

		await run(
			queryClient,
			setStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, NEW_COVER)),
				queryClient,
				STORY_ID,
			),
			image(),
		);

		/**
		 * The new address is already seated, so there is nothing to ask again. coverUrl carries the
		 * content identity (?v=<hash>), so the browser sees the new address and fetches the image on its
		 * own.
		 */
		const stale = queryClient
			.getQueryCache()
			.findAll({ queryKey: GALLERY_QUERY_KEY_PREFIX })
			.filter((query) => query.state.isInvalidated);
		expect(stale).toHaveLength(0);
	});

	it("deleting the cover marks no cell stale", async () => {
		const { queryClient } = seed();

		await run(
			queryClient,
			removeStoryCoverMutationOptions(
				clientReturning(story(STORY_ID, null)),
				queryClient,
				STORY_ID,
			),
			undefined,
		);

		expect(isInvalidated(queryClient, CREATOR_WORKS_QUERY_KEY_PREFIX)).toBe(
			false,
		);
		expect(isInvalidated(queryClient, CREATOR_ANALYTICS_QUERY_KEY_PREFIX)).toBe(
			false,
		);
		expect(isInvalidated(queryClient, VIEWER_QUERY_KEY)).toBe(false);
		expect(isInvalidated(queryClient, GALLERY_WITH_KEY)).toBe(false);
	});
});

describe("failure", () => {
	/**
	 * No optimistic update, so there is nothing to roll back; that is the design of this mutation. The
	 * server can reject the request for several reasons (format, size, resolution, ownership,
	 * sanction), and even on success the URL to show is the identity of the server's normalized
	 * result, which cannot be guessed in advance. After a failure the cache must be byte-identical. If
	 * a seeded value changed, an optimistic path was added somewhere, and it has no rollback.
	 */
	it("on failure no held cell changes", async () => {
		const seeded = seed();
		const { queryClient } = seeded;

		const result = await run(
			queryClient,
			setStoryCoverMutationOptions(clientFailing(), queryClient, STORY_ID),
			image(),
		);

		expect(result).toBe("error");
		expect(queryClient.getQueryData(GALLERY_WITH_KEY)).toBe(seeded.galleryWith);
		expect(queryClient.getQueryData(GALLERY_WITHOUT_KEY)).toBe(
			seeded.galleryWithout,
		);
		expect(queryClient.getQueryData(creatorStoriesQueryKey("me"))).toBe(
			seeded.profileGrid,
		);
		expect(queryClient.getQueryData(storyDetailQueryKey(STORY_ID))).toBe(
			seeded.detail,
		);
		expect(queryClient.getQueryData(CREATOR_WORKS_QUERY_KEY_PREFIX)).toBe(
			seeded.works,
		);
		expect(isInvalidated(queryClient, CREATOR_WORKS_QUERY_KEY_PREFIX)).toBe(
			false,
		);
	});

	it("a failed delete does not remove the cover", async () => {
		const seeded = seed();
		const { queryClient } = seeded;

		const result = await run(
			queryClient,
			removeStoryCoverMutationOptions(clientFailing(), queryClient, STORY_ID),
			undefined,
		);

		expect(result).toBe("error");
		// If the cover had been removed optimistically, the old address would be revived here. But the
		// value to revive may already have been superseded by a cover another device uploaded in the
		// meantime, so the cover is never removed in the first place.
		expect(coverIn(queryClient, GALLERY_WITH_KEY)).toBe(OLD_COVER);
		expect(queryClient.getQueryData(storyDetailQueryKey(STORY_ID))).toBe(
			seeded.detail,
		);
		expect(workRow(queryClient, STORY_ID)?.coverUrl).toBe(OLD_COVER);
	});
});

describe("queueing", () => {
	/**
	 * The two cover operations on the same work never run side by side. If they did, a request started
	 * later could finish first and the cache would settle on the old cover. The server's final state
	 * is set by the last commit, so only the screen would be wrong, and it would stay wrong until
	 * reload.
	 */
	it("the scope's identity is the story id", () => {
		const queryClient = newClient();
		const client = clientReturning(story(STORY_ID, NEW_COVER));

		expect(
			setStoryCoverMutationOptions(client, queryClient, STORY_ID).scope,
		).toEqual({ id: `story-cover:${STORY_ID}` });
	});

	/**
	 * Upload and delete share the same line. If they were split, 'delete, then upload a new cover'
	 * could fly at once, and a delete that finishes late would erase the cover just uploaded from the
	 * cache.
	 */
	it("uploading and deleting share one queue", () => {
		const queryClient = newClient();
		const client = clientReturning(story(STORY_ID, null));

		// Asserts what the value is, not merely that it equals something. Comparing equivalence alone
		// would pass when both sides lost the row (both undefined).
		expect(
			removeStoryCoverMutationOptions(client, queryClient, STORY_ID).scope,
		).toEqual({ id: `story-cover:${STORY_ID}` });
		expect(
			setStoryCoverMutationOptions(client, queryClient, STORY_ID).scope,
		).toEqual(
			removeStoryCoverMutationOptions(client, queryClient, STORY_ID).scope,
		);
	});

	it("different stories, different queues", () => {
		const queryClient = newClient();
		const client = clientReturning(story(STORY_ID, NEW_COVER));

		expect(
			setStoryCoverMutationOptions(client, queryClient, OTHER_ID).scope,
		).toEqual({ id: `story-cover:${OTHER_ID}` });
	});
});
