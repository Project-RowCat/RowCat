import type { PersonalizationState, PublicProfile } from "@rowcat/domain";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { creatorStoriesQueryKey, publicProfileQueryKey } from "./profile.ts";
import {
	PERSONALIZATION_QUERY_KEY,
	refreshViewerState,
	resetViewerState,
} from "./viewer.ts";

/**
 * Viewer boundary for the profile cache: what survives an account change and what is cleared. Two
 * slots:
 * ["creators","profile",id]  the same public value for everyone; survives an account change
 * ["creators","stories",id]  a different value per viewer; cleared when the account changes
 *
 * If the stories slot survived, Bob would see Alice's exposure result. Adult-content settings and
 * the block list decide that list, so works from a creator Alice did not block would be drawn on
 * Bob's screen regardless of Bob's own rules. Clearing the profile slot too would be wasteful and
 * would show as flicker, since name and bio are the same for everyone.
 *
 * It must be a reset, not an invalidation. Invalidation only marks stale and keeps the stored
 * value, so the previous person's list would paint on the next person's screen until refetch
 * completes.
 */

const CREATOR = "creator-1";

const PROFILE: PublicProfile = {
	id: CREATOR,
	displayName: "NightCat",
	avatarUrl: null,
	bio: null,
	followers: 10,
};

const PERSONALIZATION: PersonalizationState = {
	favorites: ["s1"],
	following: [CREATOR],
	blocked: ["creator-2"],
};

const STORIES = {
	pages: [
		{ items: [{ id: "s1" }], total: 1, page: 1, pageSize: 24, pageCount: 1 },
	],
	pageParams: [1],
};

function seeded(): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(publicProfileQueryKey(CREATOR), PROFILE);
	queryClient.setQueryData(creatorStoriesQueryKey(CREATOR), STORIES);
	queryClient.setQueryData(PERSONALIZATION_QUERY_KEY, PERSONALIZATION);
	return queryClient;
}

describe.each([
	["sign-out", resetViewerState],
	["sign-in", refreshViewerState],
] as const)("after %s", (_name, transition) => {
	it("the creator's work list is cleared with its values", async () => {
		const queryClient = seeded();
		await transition(queryClient);
		expect(
			queryClient.getQueryData(creatorStoriesQueryKey(CREATOR)),
		).toBeUndefined();
	});

	it("no relation (following, block) remains", async () => {
		const queryClient = seeded();
		await transition(queryClient);
		const state = queryClient.getQueryData<PersonalizationState>(
			PERSONALIZATION_QUERY_KEY,
		);
		expect(state?.following ?? []).not.toContain(CREATOR);
		expect(state?.blocked ?? []).not.toContain("creator-2");
	});

	/**
	 * Public identity survives. Name and bio are the same for everyone, so there is no reason to clear
	 * them. Clearing them would make the name vanish and reappear for the person who just switched
	 * accounts.
	 */
	it("the public profile identity stays", async () => {
		const queryClient = seeded();
		await transition(queryClient);
		expect(
			queryClient.getQueryData<PublicProfile>(publicProfileQueryKey(CREATOR)),
		).toEqual(PROFILE);
	});
});

describe("profile caches sit in a different cell per person", () => {
	/**
	 * Opening Bob's profile after viewing Alice's would otherwise show Alice's name and bio as Bob's
	 * until the refetch finishes.
	 */
	it("the id is part of the key", () => {
		expect(publicProfileQueryKey("a")).not.toEqual(publicProfileQueryKey("b"));
		expect(creatorStoriesQueryKey("a")).not.toEqual(
			creatorStoriesQueryKey("b"),
		);
	});

	/** The two slots must not share a prefix. Clearing one must not clear the other. */
	it("the identity cell and the works cell share no prefix", () => {
		const identity = publicProfileQueryKey(CREATOR).join("/");
		const stories = creatorStoriesQueryKey(CREATOR).join("/");
		expect(identity.startsWith(stories)).toBe(false);
		expect(stories.startsWith(identity)).toBe(false);
	});
});
