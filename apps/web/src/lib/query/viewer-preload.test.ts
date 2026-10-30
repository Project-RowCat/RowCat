import {
	DEFAULT_GALLERY_FILTERS,
	EMPTY_PERSONALIZATION_STATE,
	type Story,
	type StoryPage,
	type Viewer,
} from "@rowcat/domain";
import {
	galleryInfiniteQueryOptions,
	galleryStories,
	PERSONALIZATION_QUERY_KEY,
	storyQueryOptions,
	VIEWER_QUERY_KEY,
} from "@rowcat/query";
import { RowCatApiError, type RowCatClient } from "@rowcat/sdk";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { preloadPersonalization, preloadViewer } from "./viewer-preload.ts";

/**
 * Checks that public screens survive an auth failure. No router is mounted: the loader only fires
 * several queries and decides what to await, which one QueryClient reproduces exactly without
 * burying the rules in router wiring.
 * - A viewer or personalization failure still renders public content.
 * - A story query failure is NOT swallowed, because it is the server's visibility decision.
 */

const VIEWER: Viewer = {
	id: "member-1",
	nickname: "Tester",
	status: "approved",
	role: "user",
	verified: false,
	adult: false,
	showAdult: false,
	adultRecheckRequired: false,
	localOwner: false,
	ageStatus: "standard",
	membershipGate: null,
};

const STORY: Story = {
	id: "story-1",
	title: "Test story",
	description: "Description",
	author: "Author",
	coverUrl: null,
	orientation: null,
	adult: false,
	visibility: "public",
	promptProtected: false,
	tags: [],
	favorites: 0,
	creator: { id: "member-9", nickname: "Creator" },
	playMode: "chat",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	sizeBytes: 0,
};

const PAGE: StoryPage = {
	items: [STORY],
	page: 1,
	pageSize: 24,
	total: 1,
	pageCount: 1,
};

const clientOf = (overrides: {
	me?: () => Promise<Viewer | null>;
	story?: () => Promise<Story>;
}): RowCatClient =>
	({
		me: {
			get: overrides.me ?? (() => Promise.resolve(VIEWER)),
			state: () => Promise.resolve(EMPTY_PERSONALIZATION_STATE),
		},
		stories: {
			list: () => Promise.resolve(PAGE),
			get: overrides.story ?? (() => Promise.resolve(STORY)),
		},
	}) as unknown as RowCatClient;

/** Retries are off: this test checks how failures are handled, not the retry policy. */
const newQueryClient = () =>
	new QueryClient({ defaultOptions: { queries: { retry: false } } });

const authFailure = () =>
	Promise.reject(
		new RowCatApiError({
			status: 500,
			code: "internal_error",
			message: "the session lookup failed",
		}),
	);

describe("preloadViewer", () => {
	it("on the normal path it fills the viewer into the cache", async () => {
		const queryClient = newQueryClient();
		const viewer = await preloadViewer(queryClient, clientOf({}));

		// The SSR hydration benefit still holds: the first HTML already knows the signed-in state.
		expect(viewer).toEqual(VIEWER);
		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toEqual(VIEWER);
	});

	it("on failure it falls back to guest without throwing", async () => {
		const queryClient = newQueryClient();
		await expect(
			preloadViewer(queryClient, clientOf({ me: authFailure })),
		).resolves.toBeNull();
	});

	it("it does not write the failure into the cache as a guest", async () => {
		/**
		 * Writing null would mean 'definitely signed out' and remove the browser's reason to ask again. A
		 * failure is not a verdict, so the query stays in error and is retried naturally.
		 */
		const queryClient = newQueryClient();
		await preloadViewer(queryClient, clientOf({ me: authFailure }));

		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toBeUndefined();
		expect(queryClient.getQueryState(VIEWER_QUERY_KEY)?.status).toBe("error");
	});
});

describe("gallery loader", () => {
	it("even if the viewer fails, the public gallery works once the list arrives", async () => {
		const queryClient = newQueryClient();
		const client = clientOf({ me: authFailure });

		// Mirrors the route loader: viewer and gallery fire together, and only personalization waits for
		// the viewer.
		const [viewer, gallery] = await Promise.all([
			preloadViewer(queryClient, client),
			queryClient.ensureInfiniteQueryData(
				galleryInfiniteQueryOptions(client, DEFAULT_GALLERY_FILTERS),
			),
		]);
		if (viewer) await preloadPersonalization(queryClient, client);

		expect(viewer).toBeNull();
		// The gallery is an infinite (appending) query, but the loader keeps only the first page.
		expect(gallery.pages).toEqual([PAGE]);
		expect(galleryStories(gallery)).toEqual([STORY]);
		expect(queryClient.getQueryData(PERSONALIZATION_QUERY_KEY)).toBeUndefined();
	});

	it("if the list itself fails it throws", async () => {
		/**
		 * With no main content there is nothing to draw. Swallowing the error here would make the gallery
		 * look like a service with no works at all, which is worse than a visible failure.
		 */
		const queryClient = newQueryClient();
		const client = {
			...clientOf({}),
			stories: { list: () => Promise.reject(new Error("list failure")) },
		} as unknown as RowCatClient;

		await expect(
			Promise.all([
				preloadViewer(queryClient, client),
				queryClient.ensureInfiniteQueryData(
					galleryInfiniteQueryOptions(client, DEFAULT_GALLERY_FILTERS),
				),
			]),
		).rejects.toThrow("list failure");
	});
});

describe("story detail loader", () => {
	it("the story resolves in the loader even if the viewer fails", async () => {
		/**
		 * head builds meta tags from this value, so a viewer lookup failure must not leave link previews
		 * and crawlers with an empty document.
		 */
		const queryClient = newQueryClient();
		const client = clientOf({ me: authFailure });

		const [story, viewer] = await Promise.all([
			queryClient.ensureQueryData(storyQueryOptions(client, STORY.id)),
			preloadViewer(queryClient, client),
		]);

		expect(viewer).toBeNull();
		expect(story).toEqual(STORY);
	});

	it("a story 404 is not swallowed; hiding existence is the server's decision", async () => {
		/**
		 * Missing, private, blocked, and adult-gated works all return the same 404. If the loader
		 * swallowed it as a viewer failure, the page for an unviewable work would open and its existence
		 * would be revealed. Authorization stays with the server.
		 */
		const queryClient = newQueryClient();
		const client = clientOf({
			story: () =>
				Promise.reject(
					new RowCatApiError({
						status: 404,
						code: "not_found",
						message: "Not found.",
					}),
				),
		});

		await expect(
			Promise.all([
				queryClient.ensureQueryData(storyQueryOptions(client, STORY.id)),
				preloadViewer(queryClient, client),
			]),
		).rejects.toMatchObject({ status: 404 });
	});
});
