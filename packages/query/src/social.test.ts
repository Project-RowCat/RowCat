import {
	DEFAULT_GALLERY_FILTERS,
	type PersonalizationState,
	type PublicProfile,
	type Story,
} from "@rowcat/domain";
import type { RowCatClient } from "@rowcat/sdk";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { storyCommentsQueryKey } from "./comments.ts";
import { galleryQueryKey } from "./gallery.ts";
import { creatorStoriesQueryKey, publicProfileQueryKey } from "./profile.ts";
import { blockMutationOptions, followMutationOptions } from "./social.ts";
import { storyDetailQueryKey } from "./story.ts";
import { PERSONALIZATION_QUERY_KEY } from "./viewer.ts";

/**
 * Cache policy for follow and block writes. Whether the request went out is not checked here (that
 * is the SDK's job). This file checks what happens to each slot when a write finishes. Three
 * results are never visible by eye:
 * - Whether an optimistic follow rolls back on failure. The screen would briefly show a right
 *   value and then lose it.
 * - Whether the server's follower total **overwrites** the optimistic ±1. If it does not, the
 *   number drifts after repeated taps.
 * - Whether a block **drops** the cache or only marks it stale. If only stale, the just-blocked
 *   creator's works stay on screen until the refetch finishes.
 *
 * No React. The policy is a set of rules on `QueryClient`, not a hook.
 */

const CREATOR = "creator-1";
const OTHER = "creator-2";

const PROFILE: PublicProfile = {
	id: CREATOR,
	displayName: "NightCat",
	avatarUrl: null,
	bio: null,
	followers: 10,
};

const story = (id: string, creatorId: string | null): Story =>
	({
		id,
		title: id,
		creator: creatorId ? { id: creatorId, nickname: "Nick" } : null,
		favorites: 0,
	}) as Story;

const GALLERY_KEY = galleryQueryKey(DEFAULT_GALLERY_FILTERS);

/** Infinite-query fixture. One page mixes works from two creators. */
const galleryPage = () => ({
	pages: [
		{
			items: [
				story("s1", CREATOR),
				story("s2", OTHER),
				// A work whose owner was erased with their account. It belongs to no one, so the block must not
				// catch it.
				story("s3", null),
			],
			total: 3,
			page: 1,
			pageSize: 24,
			pageCount: 1,
		},
	],
	pageParams: [1],
});

const personalization = (
	patch: Partial<PersonalizationState> = {},
): PersonalizationState => ({
	favorites: [],
	following: [],
	blocked: [],
	...patch,
});

function seed(
	queryClient: QueryClient,
	state: PersonalizationState = personalization(),
): void {
	queryClient.setQueryData(PERSONALIZATION_QUERY_KEY, state);
	queryClient.setQueryData(publicProfileQueryKey(CREATOR), PROFILE);
	queryClient.setQueryData(GALLERY_KEY, galleryPage());
	queryClient.setQueryData(storyDetailQueryKey("s1"), story("s1", CREATOR));
	queryClient.setQueryData(storyDetailQueryKey("s2"), story("s2", OTHER));
	queryClient.setQueryData(creatorStoriesQueryKey(CREATOR), {
		pages: [
			{
				items: [story("s1", CREATOR)],
				total: 1,
				page: 1,
				pageSize: 24,
				pageCount: 1,
			},
		],
		pageParams: [1],
	});
	queryClient.setQueryData(storyCommentsQueryKey("s2"), {
		pages: [{ items: [{ id: "c1" }], nextCursor: null }],
		pageParams: [""],
	});
}

const newClient = () =>
	new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

const clientOf = (social: Partial<RowCatClient["social"]>): RowCatClient =>
	({ social }) as RowCatClient;

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

const stateIn = (queryClient: QueryClient) =>
	queryClient.getQueryData<PersonalizationState>(PERSONALIZATION_QUERY_KEY);

const followersIn = (queryClient: QueryClient, creatorId = CREATOR) =>
	queryClient.getQueryData<PublicProfile>(publicProfileQueryKey(creatorId))
		?.followers;

const galleryIds = (queryClient: QueryClient): string[] =>
	(
		queryClient.getQueryData<{ pages: { items: Story[] }[] }>(GALLERY_KEY)
			?.pages ?? []
	).flatMap((page) => page.items.map((s) => s.id));

const isInvalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
	queryClient.getQueryState(key)?.isInvalidated === true;

describe("followMutationOptions", () => {
	it("draws the relation and follower count optimistically while the request runs", async () => {
		const queryClient = newClient();
		seed(queryClient);
		let duringRequest: { following: string[]; followers?: number } | null =
			null;

		await run(
			queryClient,
			followMutationOptions(
				clientOf({
					setFollow: async () => {
						duringRequest = {
							following: stateIn(queryClient)?.following ?? [],
							followers: followersIn(queryClient),
						};
						return { following: true, followers: 11 };
					},
				}),
				queryClient,
				CREATOR,
			),
			true,
		);

		expect(duringRequest).toEqual({ following: [CREATOR], followers: 11 });
	});

	it("on success it overwrites with the server's total, not adding to the optimistic ±1", async () => {
		const queryClient = newClient();
		seed(queryClient);

		/**
		 * If another person also followed this creator at the same moment, the optimistic 11 is already
		 * wrong. The server's absolute value (20) must stay. If this spot is off, the number drifts
		 * further from reality with every request.
		 */
		await run(
			queryClient,
			followMutationOptions(
				clientOf({
					setFollow: async () => ({ following: true, followers: 20 }),
				}),
				queryClient,
				CREATOR,
			),
			true,
		);

		expect(followersIn(queryClient)).toBe(20);
		expect(stateIn(queryClient)?.following).toEqual([CREATOR]);
	});

	it("on failure the relation and total both return", async () => {
		const queryClient = newClient();
		seed(queryClient);

		const result = await run(
			queryClient,
			followMutationOptions(
				clientOf({
					setFollow: async () => {
						throw new Error("network");
					},
				}),
				queryClient,
				CREATOR,
			),
			true,
		);

		expect(result).toBe("error");
		expect(stateIn(queryClient)?.following).toEqual([]);
		expect(followersIn(queryClient)).toBe(10);
	});

	it("following again while already following does not raise the total", async () => {
		const queryClient = newClient();
		seed(queryClient, personalization({ following: [CREATOR] }));
		let duringRequest: number | undefined;

		/**
		 * The server is an idempotent API that takes the desired state, so a duplicate request does not
		 * raise the total. Changing only ±1 on screen would show a wrong number until the response
		 * arrives, and repeated taps would pile up the error.
		 */
		await run(
			queryClient,
			followMutationOptions(
				clientOf({
					setFollow: async () => {
						duringRequest = followersIn(queryClient);
						return { following: true, followers: 10 };
					},
				}),
				queryClient,
				CREATOR,
			),
			true,
		);

		expect(duringRequest).toBe(10);
		expect(followersIn(queryClient)).toBe(10);
	});

	it("the last intent of rapid presses wins; a late old response does not overwrite", async () => {
		const queryClient = newClient();
		seed(queryClient);
		const options = followMutationOptions(
			/**
			 * Creates the case where the first request finishes **more slowly**. Without queueing (`scope`),
			 * both requests fly in parallel, and the late first response overwrites the final intent.
			 */
			clientOf({
				setFollow: async (_creatorId, following) => {
					await new Promise((resolve) =>
						setTimeout(resolve, following ? 30 : 0),
					);
					return { following, followers: following ? 11 : 10 };
				},
			}),
			queryClient,
			CREATOR,
		);

		await Promise.all([
			run(queryClient, options, true),
			run(queryClient, options, false),
		]);

		expect(stateIn(queryClient)?.following).toEqual([]);
		expect(followersIn(queryClient)).toBe(10);
	});

	it("does not invent a missing profile cell", async () => {
		const queryClient = newClient();
		queryClient.setQueryData(PERSONALIZATION_QUERY_KEY, personalization());

		await run(
			queryClient,
			followMutationOptions(
				clientOf({
					setFollow: async () => ({ following: true, followers: 1 }),
				}),
				queryClient,
				CREATOR,
			),
			true,
		);

		// A value the server was never asked for must not sit there as an already-present value. The next
		// screen that opens that profile would read it as fresh.
		expect(
			queryClient.getQueryData(publicProfileQueryKey(CREATOR)),
		).toBeUndefined();
	});

	it("Alice's state does not leak into Bob's cache", async () => {
		/**
		 * Personalization sits **under the viewer cache**, and login and logout clear that prefix
		 * (`viewer.ts`). This test checks that premise: when the account changes, the cache is either a
		 * new QueryClient or cleared. The follow mutation also does not create a missing slot.
		 */
		const alice = newClient();
		seed(alice, personalization({ following: [CREATOR] }));
		const bob = newClient();

		await run(
			bob,
			followMutationOptions(
				clientOf({
					setFollow: async () => ({ following: true, followers: 1 }),
				}),
				bob,
				CREATOR,
			),
			true,
		);

		expect(stateIn(bob)).toBeUndefined();
		expect(stateIn(alice)?.following).toEqual([CREATOR]);
	});
});

describe("blockMutationOptions", () => {
	it("blocking lands in personalization and drops the follow", async () => {
		const queryClient = newClient();
		seed(queryClient, personalization({ following: [CREATOR, OTHER] }));

		await run(
			queryClient,
			blockMutationOptions(
				clientOf({ setBlock: async () => ({ blocked: true, followers: 9 }) }),
				queryClient,
				CREATOR,
			),
			true,
		);

		const state = stateIn(queryClient);
		expect(state?.blocked).toEqual([CREATOR]);
		// The unfollow the server applied in the same transaction is reflected on screen as well.
		expect(state?.following).toEqual([OTHER]);
		expect(followersIn(queryClient)).toBe(9);
	});

	it("blocking removes that creator's works from the cache **immediately**", async () => {
		const queryClient = newClient();
		seed(queryClient);

		await run(
			queryClient,
			blockMutationOptions(
				clientOf({ setBlock: async () => ({ blocked: true, followers: 10 }) }),
				queryClient,
				CREATOR,
			),
			true,
		);

		// With invalidation only, s1 would stay on screen until the refetch finishes.
		expect(galleryIds(queryClient)).toEqual(["s2", "s3"]);
		// The total must drop too, so the `N stories` count in the toolbar does not disagree with the list.
		expect(
			queryClient.getQueryData<{ pages: { total: number }[] }>(GALLERY_KEY)
				?.pages[0]?.total,
		).toBe(2);
	});

	it("blocking drops only that creator's story details", async () => {
		const queryClient = newClient();
		seed(queryClient);

		await run(
			queryClient,
			blockMutationOptions(
				clientOf({ setBlock: async () => ({ blocked: true, followers: 10 }) }),
				queryClient,
				CREATOR,
			),
			true,
		);

		expect(queryClient.getQueryData(storyDetailQueryKey("s1"))).toBeUndefined();
		// Unrelated works are unchanged. Clearing the whole prefix would make the work being watched
		// refetch needlessly.
		expect(queryClient.getQueryData(storyDetailQueryKey("s2"))).toBeDefined();
	});

	it("blocking clears the profile grid and comments and leaves the identity cell", async () => {
		const queryClient = newClient();
		seed(queryClient);

		await run(
			queryClient,
			blockMutationOptions(
				clientOf({ setBlock: async () => ({ blocked: true, followers: 10 }) }),
				queryClient,
				CREATOR,
			),
			true,
		);

		expect(
			queryClient.getQueryData(creatorStoriesQueryKey(CREATOR)),
		).toBeUndefined();
		expect(
			queryClient.getQueryData(storyCommentsQueryKey("s2")),
		).toBeUndefined();
		/**
		 * Name and bio are still public values. Blocking is not a feature that makes someone invisible.
		 * It is a personal setting that removes that person's works from my screen. The profile is also
		 * where you unblock, so clearing the identity slot would make that screen empty once and then
		 * refill.
		 */
		expect(
			queryClient.getQueryData<PublicProfile>(publicProfileQueryKey(CREATOR))
				?.displayName,
		).toBe("NightCat");
	});

	it("unblocking keeps held values and only refetches", async () => {
		const queryClient = newClient();
		seed(queryClient, personalization({ blocked: [CREATOR] }));

		await run(
			queryClient,
			blockMutationOptions(
				clientOf({ setBlock: async () => ({ blocked: false, followers: 10 }) }),
				queryClient,
				CREATOR,
			),
			false,
		);

		expect(stateIn(queryClient)?.blocked).toEqual([]);
		// Unblocking does **not** revive the follow. Following again is an explicit action.
		expect(stateIn(queryClient)?.following).toEqual([]);
		// The list visible now is still valid. Clearing it would make the screen empty once and then
		// refill.
		expect(galleryIds(queryClient)).toEqual(["s1", "s2", "s3"]);
		expect(isInvalidated(queryClient, GALLERY_KEY)).toBe(true);
	});

	it("on failure no cell changes", async () => {
		const queryClient = newClient();
		seed(queryClient, personalization({ following: [CREATOR] }));

		const result = await run(
			queryClient,
			blockMutationOptions(
				clientOf({
					setBlock: async () => {
						throw new Error("network");
					},
				}),
				queryClient,
				CREATOR,
			),
			true,
		);

		expect(result).toBe("error");
		// Nothing is removed optimistically, so there is nothing to roll back. That is this mutation's
		// design.
		expect(stateIn(queryClient)?.blocked).toEqual([]);
		expect(stateIn(queryClient)?.following).toEqual([CREATOR]);
		expect(galleryIds(queryClient)).toEqual(["s1", "s2", "s3"]);
	});
});
