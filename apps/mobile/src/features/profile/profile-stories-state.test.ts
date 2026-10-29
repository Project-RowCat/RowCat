import { describe, expect, it } from "vitest";
import {
	canLoadMoreProfileStories,
	type ProfileStoriesSnapshot,
	resolveProfileStoriesState,
	showsProfileStoriesEnd,
} from "./profile-stories-state.ts";

/**
 * Works slot states. **The point of this file is that blocked and empty never fold together.**
 *
 * The server returns zero works in both cases, so the data alone does not distinguish them. If this
 * decision is wrong, the symptom is silent: a blocker sees "no works published yet" and has no way
 * to learn why the screen is empty.
 */

/**
 * The default is the first query that has never received data (`hasData: false`). Because of that
 * default, any case that omits `hasData` means "no data". Cases that hold received data say so
 * explicitly.
 */
const snapshot = (
	patch: Partial<ProfileStoriesSnapshot> = {},
): ProfileStoriesSnapshot => ({
	status: "pending",
	paused: false,
	hasData: false,
	storyCount: 0,
	...patch,
});

describe("blocking comes before the empty state", () => {
	it("blocked + zero is blocked", () => {
		expect(
			resolveProfileStoriesState({
				blocked: true,
				stories: snapshot({ status: "success", hasData: true, storyCount: 0 }),
			}),
		).toBe("blocked");
	});

	it("zero without a block is the empty state", () => {
		expect(
			resolveProfileStoriesState({
				blocked: false,
				stories: snapshot({ status: "success", hasData: true, storyCount: 0 }),
			}),
		).toBe("empty");
	});

	it("the two states don't fold into one", () => {
		const blocked = resolveProfileStoriesState({
			blocked: true,
			stories: snapshot({ status: "success", hasData: true, storyCount: 0 }),
		});
		const empty = resolveProfileStoriesState({
			blocked: false,
			stories: snapshot({ status: "success", hasData: true, storyCount: 0 }),
		});
		expect(blocked).not.toBe(empty);
	});

	it("blocking doesn't wait for the lookup", () => {
		/**
		 * Already known, so there is no reason to draw a placeholder first. Waiting would flash a spinner
		 * and then show the same sentence every time a blocked creator's profile opens.
		 */
		for (const stories of [
			snapshot(),
			snapshot({ paused: true }),
			snapshot({ status: "error" }),
		])
			expect(resolveProfileStoriesState({ blocked: true, stories })).toBe(
				"blocked",
			);
	});
});

describe("the remaining branches", () => {
	it("loading while the first lookup runs", () => {
		expect(
			resolveProfileStoriesState({ blocked: false, stories: snapshot() }),
		).toBe("loading");
	});

	it("a paused lookup is offline, not loading", () => {
		expect(
			resolveProfileStoriesState({
				blocked: false,
				stories: snapshot({ paused: true }),
			}),
		).toBe("offline");
	});

	it("a story lookup failure ends inside that section", () => {
		/** Identity is answered separately by `resolveProfileState`; the two axes are split. */
		expect(
			resolveProfileStoriesState({
				blocked: false,
				stories: snapshot({ status: "error" }),
			}),
		).toBe("failed");
	});

	it("draws when there's a held list", () => {
		expect(
			resolveProfileStoriesState({
				blocked: false,
				stories: snapshot({ status: "success", hasData: true, storyCount: 3 }),
			}),
		).toBe("stories");
	});
});

describe("a held list isn't covered by a failure", () => {
	/**
	 * **The defect this file fixed.**
	 *
	 * Query does not discard already-received pages when a background refresh fails; then `status` is
	 * `error` while `data` remains. Checking failure before the count turns a grid of twenty-four
	 * works into an error message because one refresh failed, and the user reads that creator's works
	 * as having disappeared.
	 *
	 * The identity resolver already follows the same rule (`if (data)` in `profile-state.ts`).
	 */
	it("draws the list already received even when a background refresh fails", () => {
		expect(
			resolveProfileStoriesState({
				blocked: false,
				stories: snapshot({ status: "error", hasData: true, storyCount: 24 }),
			}),
		).toBe("stories");
	});

	it("a first-lookup failure has nothing to draw, so it's a failure", () => {
		/** Same `error`, but the axis that splits here is data presence, not count. */
		expect(
			resolveProfileStoriesState({
				blocked: false,
				stories: snapshot({ status: "error", hasData: false, storyCount: 0 }),
			}),
		).toBe("failed");
	});

	/**
	 * An offline background refresh is the same. Replacing a held list with a placeholder would make
	 * reopening a profile on the subway lose the screen.
	 */
	it("a paused refresh doesn't erase the list already received either", () => {
		expect(
			resolveProfileStoriesState({
				blocked: false,
				stories: snapshot({ paused: true, hasData: true, storyCount: 24 }),
			}),
		).toBe("stories");
	});

	/**
	 * **Blocking still comes first.** Even with a held list, blocking wins. If the old card of a
	 * creator who now returns zero stayed on screen, blocking would appear to do nothing (the same
	 * axis as cache cleanup removing that list).
	 */
	it("blocking wins even with a held list", () => {
		for (const stories of [
			snapshot({ status: "success", hasData: true, storyCount: 24 }),
			snapshot({ status: "error", hasData: true, storyCount: 24 }),
		])
			expect(resolveProfileStoriesState({ blocked: true, stories })).toBe(
				"blocked",
			);
	});

	it("a successful zero stays the empty state", () => {
		/** Failure and "really none" are different screens; a count of zero does not fold them together. */
		expect(
			resolveProfileStoriesState({
				blocked: false,
				stories: snapshot({ status: "success", hasData: true, storyCount: 0 }),
			}),
		).toBe("empty");
	});

	/** The next page can be requested while a held list is drawn; the state decides eligibility. */
	it("after a failure, a list state can still call the next page", () => {
		const state = resolveProfileStoriesState({
			blocked: false,
			stories: snapshot({ status: "error", hasData: true, storyCount: 24 }),
		});
		expect(
			canLoadMoreProfileStories(state, { hasNext: true, fetching: false }),
		).toBe(true);
		expect(showsProfileStoriesEnd(state)).toBe(true);
	});
});

describe("a received zero is data too", () => {
	/**
	 * **The gap that the `storyCount > 0` proxy missed.**
	 *
	 * A successful empty result is valid cached data. The server has answered "this creator has no
	 * public works", and a later failed refresh does not invalidate that answer. Using the count as a
	 * proxy for presence makes both cases the same value (`0`), and the empty state turns into a
	 * failure message.
	 */
	it("cached zero + failed background refresh is still the empty state", () => {
		expect(
			resolveProfileStoriesState({
				blocked: false,
				stories: snapshot({ status: "error", hasData: true, storyCount: 0 }),
			}),
		).toBe("empty");
	});

	it("cached zero + paused refresh is still the empty state too", () => {
		expect(
			resolveProfileStoriesState({
				blocked: false,
				stories: snapshot({ paused: true, hasData: true, storyCount: 0 }),
			}),
		).toBe("empty");
	});

	it("`hasData: false` and `hasData: true` split on the same zero", () => {
		/**
		 * The one assertion that carries the whole change. The two snapshots match in `storyCount` and
		 * `status` and differ **only in `hasData`**, and the answers must differ. No count-only decision
		 * can express that distinction.
		 */
		const never = resolveProfileStoriesState({
			blocked: false,
			stories: snapshot({ status: "error", hasData: false, storyCount: 0 }),
		});
		const cached = resolveProfileStoriesState({
			blocked: false,
			stories: snapshot({ status: "error", hasData: true, storyCount: 0 }),
		});
		expect(never).toBe("failed");
		expect(cached).toBe("empty");
		expect(never).not.toBe(cached);
	});

	it("a lookup paused without ever receiving anything is offline", () => {
		/** With no held answer this is not `empty`: there is no basis for claiming zero. */
		expect(
			resolveProfileStoriesState({
				blocked: false,
				stories: snapshot({ paused: true, hasData: false, storyCount: 0 }),
			}),
		).toBe("offline");
	});

	it("blocking beats a cached zero too", () => {
		expect(
			resolveProfileStoriesState({
				blocked: true,
				stories: snapshot({ status: "error", hasData: true, storyCount: 0 }),
			}),
		).toBe("blocked");
	});

	it("blocking beats a cached list too", () => {
		expect(
			resolveProfileStoriesState({
				blocked: true,
				stories: snapshot({ status: "error", hasData: true, storyCount: 24 }),
			}),
		).toBe("blocked");
	});

	/**
	 * An empty state is not a list, so there is no next page and no end marker. This confirms that
	 * moving from failure to empty does not disturb those two axes.
	 */
	it("doesn't call the next page from a cached empty state", () => {
		const state = resolveProfileStoriesState({
			blocked: false,
			stories: snapshot({ status: "error", hasData: true, storyCount: 0 }),
		});
		expect(
			canLoadMoreProfileStories(state, { hasNext: true, fetching: false }),
		).toBe(false);
		expect(showsProfileStoriesEnd(state)).toBe(false);
	});
});

describe("calls the next page only for a list", () => {
	it("true only for a list with a next page and no request in flight", () => {
		expect(
			canLoadMoreProfileStories("stories", { hasNext: true, fetching: false }),
		).toBe(true);
	});

	it("doesn't call while a request is in flight", () => {
		/**
		 * RN fires `onEndReached` several times per scroll, and Query does not merge in-flight requests;
		 * checking both is all that prevents duplicates.
		 */
		expect(
			canLoadMoreProfileStories("stories", { hasNext: true, fetching: true }),
		).toBe(false);
	});

	it("doesn't call without a next page", () => {
		expect(
			canLoadMoreProfileStories("stories", { hasNext: false, fetching: false }),
		).toBe(false);
	});

	it("always false outside a list state", () => {
		for (const state of [
			"blocked",
			"loading",
			"offline",
			"failed",
			"empty",
		] as const)
			expect(
				canLoadMoreProfileStories(state, { hasNext: true, fetching: false }),
			).toBe(false);
	});
});

describe("the end marker is drawn only for a list", () => {
	it("doesn't draw `You've reached the end` on zero", () => {
		/** Collides head-on with the empty-state guidance. */
		expect(showsProfileStoriesEnd("empty")).toBe(false);
		expect(showsProfileStoriesEnd("blocked")).toBe(false);
	});

	it("true only for a list", () => {
		expect(showsProfileStoriesEnd("stories")).toBe(true);
		for (const state of ["loading", "offline", "failed"] as const)
			expect(showsProfileStoriesEnd(state)).toBe(false);
	});
});
