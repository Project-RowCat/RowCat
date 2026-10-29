import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { relatedStoriesQueryKey, storyPlaybackQueryKey } from "./story.ts";
import { refreshViewerState, resetViewerState } from "./viewer.ts";

/**
 * When the identity changes, playback bodies and related stories must be emptied. The old comment
 * said logout clears the whole ['stories'] prefix, which was false: the reset only cleared gallery,
 * detail and comments. The previous user's paid playback body opened without a request for the next
 * user, and the related-works list kept their private works. Neither shows on screen, so the test
 * asserts the cached values directly.
 */

const newClient = () =>
	new QueryClient({ defaultOptions: { queries: { retry: false } } });

const seed = (queryClient: QueryClient) => {
	queryClient.setQueryData(storyPlaybackQueryKey("s1"), {
		kind: "runtime",
		artifact: "PAID",
	});
	queryClient.setQueryData(relatedStoriesQueryKey("s1"), [
		{ id: "private-own", title: "secret" },
	]);
};

describe("an identity switch clears story body cells", () => {
	it.each([
		["sign-out", resetViewerState],
		["sign-in", refreshViewerState],
	] as const)("after %s no playback body or related works remain", async (_label, reset) => {
		const queryClient = newClient();
		seed(queryClient);

		await reset(queryClient);

		expect(
			queryClient.getQueryData(storyPlaybackQueryKey("s1")),
		).toBeUndefined();
		expect(
			queryClient.getQueryData(relatedStoriesQueryKey("s1")),
		).toBeUndefined();
	});
});
