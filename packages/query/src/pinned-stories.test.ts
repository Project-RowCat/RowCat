import type { CreatorWork, Story } from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
	OWN_PINNED_STORIES_QUERY_KEY,
	pinnedStoriesMutationOptions,
	pinnedStoriesQueryKey,
} from "./profile.ts";
import { blockMutationOptions } from "./social.ts";
import { applyStoryCover } from "./story-cover.ts";
import { applyStoryLifecycle } from "./story-lifecycle.ts";
import { refreshViewerState, resetViewerState } from "./viewer.ts";

/**
 * Two cache slots for pinned works. Check that they move together with the grid.
 *
 * ["creators","pinned",id]     public pinned works. Depends on the viewer, so clear on
 *                               identity change.
 * ["viewer","pinned-stories"]  my pinned works. Includes unpublished titles, so logout
 *                               clears it.
 *
 * These slots sit outside the grid's prefix because the value shape differs. Each policy that
 * changes the grid must name this prefix explicitly. If one omits it, the symptom is a work that is
 * gone from the grid but still at the top of the profile. Neither the compiler nor other tests
 * catch that.
 */

const CREATOR = "creator-1";

const story = (id: string, coverUrl: string | null = null): Story =>
	({ id, coverUrl, creator: { id: CREATOR, nickname: "Night" } }) as Story;

const work = (id: string): CreatorWork => ({
	id,
	originDraftId: null,
	title: "Story",
	visibility: "public",
	adult: false,
	promptProtected: false,
	hidden: false,
	coverUrl: null,
	createdAt: "2026-10-01T00:00:00.000Z",
	updatedAt: "2026-10-01T00:00:00.000Z",
});

function seeded(): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(pinnedStoriesQueryKey(CREATOR), [
		story("s1"),
		story("s2"),
	]);
	queryClient.setQueryData(OWN_PINNED_STORIES_QUERY_KEY, [
		work("s1"),
		work("s2"),
	]);
	return queryClient;
}

describe.each([
	["sign-out", resetViewerState],
	["sign-in", refreshViewerState],
] as const)("after %s", (_name, transition) => {
	it("both cells are cleared with their values", async () => {
		const queryClient = seeded();
		await transition(queryClient);
		expect(queryClient.getQueryData(pinnedStoriesQueryKey(CREATOR))).toBe(
			undefined,
		);
		expect(queryClient.getQueryData(OWN_PINNED_STORIES_QUERY_KEY)).toBe(
			undefined,
		);
	});
});

describe("exposure transitions", () => {
	it("a withdrawn work leaves the public featured list immediately and stays in mine with its state", () => {
		const queryClient = seeded();
		applyStoryLifecycle(queryClient, story("s1"), "unpublish");

		expect(
			queryClient
				.getQueryData<Story[]>(pinnedStoriesQueryKey(CREATOR))
				?.map((item) => item.id),
		).toEqual(["s2"]);
		expect(
			queryClient
				.getQueryData<CreatorWork[]>(OWN_PINNED_STORIES_QUERY_KEY)
				?.map((item) => [item.id, item.visibility]),
		).toEqual([
			["s1", "private"],
			["s2", "public"],
		]);
	});
});

describe("cover replacement", () => {
	it("both cells' covers change together", () => {
		const queryClient = seeded();
		applyStoryCover(queryClient, story("s2", "https://cdn.test/s2?v=2"));
		expect(
			queryClient.getQueryData<Story[]>(pinnedStoriesQueryKey(CREATOR))?.[1]
				?.coverUrl,
		).toBe("https://cdn.test/s2?v=2");
		expect(
			queryClient.getQueryData<CreatorWork[]>(OWN_PINNED_STORIES_QUERY_KEY)?.[1]
				?.coverUrl,
		).toBe("https://cdn.test/s2?v=2");
	});
});

describe("block", () => {
	it("a blocked creator's featured works are cleared once confirmed", async () => {
		const queryClient = seeded();
		const client = {
			social: {
				setBlock: vi.fn(async () => ({ blocked: true, followers: 0 })),
			},
		} as unknown as RowCatClient;
		const options = blockMutationOptions(client, queryClient, CREATOR);
		const result = await options.mutationFn?.(true, {} as never);
		options.onSuccess?.(result as never, true, undefined, {} as never);
		expect(queryClient.getQueryData(pinnedStoriesQueryKey(CREATOR))).toBe(
			undefined,
		);
	});
});

describe("setting featured works", () => {
	it("overwrites mine with the server's confirmed list and invalidates the public cell", async () => {
		const queryClient = seeded();
		const confirmed = [work("s2")];
		const client = {
			me: { setPinnedStories: vi.fn(async () => confirmed) },
		} as unknown as RowCatClient;
		const options = pinnedStoriesMutationOptions(client, queryClient, CREATOR);

		const result = await options.mutationFn?.(["s2"], {} as never);
		options.onSuccess?.(result as never, ["s2"], undefined, {} as never);

		expect(client.me.setPinnedStories).toHaveBeenCalledWith({
			storyIds: ["s2"],
		});
		expect(queryClient.getQueryData(OWN_PINNED_STORIES_QUERY_KEY)).toEqual(
			confirmed,
		);
		/**
		 * Public slots are not invented, because the response has no card material. Only mark them stale.
		 * The stored value stays until it is refetched.
		 */
		expect(
			queryClient.getQueryState(pinnedStoriesQueryKey(CREATOR))?.isInvalidated,
		).toBe(true);
	});
});
