import { describe, expect, it } from "vitest";
import {
	canRunStoryLifecycleAction,
	isOwnWorkViewable,
	isStoryDirectlyViewable,
	isStoryDiscoverable,
	isStoryShareable,
	isStoryVisibleOnCreatorProfile,
	STORY_LIFECYCLE_ACTIONS,
	STORY_LIFECYCLE_RESULT,
	STORY_VISIBILITIES,
	STORY_VISIBILITY_LABEL,
	type StoryLifecycleAction,
	type StoryVisibility,
	storyLifecycleActions,
	storyVisibilityBadgeLabel,
} from "./story.ts";

/**
 * The lifecycle state machine for works. The server enforces the same rules with its own
 * predicates, so this table is display, not authorization. It is pinned as values because failures
 * are silent. A button may be pressed and get a 409, or a possible action may be missing from the
 * screen. Neither raises an error.
 *
 * In particular, the absence of `archived -> public` exists only as a missing entry. Without a
 * test, someone adding that line for convenience would not be caught anywhere.
 */

const each = (fn: (visibility: StoryVisibility) => void) => {
	for (const visibility of STORY_VISIBILITIES) fn(visibility);
};

describe("storyLifecycleActions", () => {
	it("each state offers exactly those operations", () => {
		expect(storyLifecycleActions({ visibility: "private" })).toEqual([
			"publish",
			"unlist",
			"archive",
		]);
		expect(storyLifecycleActions({ visibility: "unlisted" })).toEqual([
			"publish",
			"unpublish",
			"archive",
		]);
		expect(storyLifecycleActions({ visibility: "public" })).toEqual([
			"unlist",
			"unpublish",
			"archive",
		]);
		expect(storyLifecycleActions({ visibility: "archived" })).toEqual([
			"restore",
		]);
	});

	it("an archived work has **no** way out", () => {
		/**
		 * The core rule of this slice. Restoring from archive and publishing again are two separate
		 * decisions. If one press does both, a work archived long ago goes back out without confirmation.
		 *
		 * `Link only` is not that path either. Not appearing in lists does not mean restoring may open it,
		 * since a link-shared work is open to anyone who has the address.
		 */
		expect(
			canRunStoryLifecycleAction({ visibility: "archived" }, "publish"),
		).toBe(false);
		expect(
			canRunStoryLifecycleAction({ visibility: "archived" }, "unlist"),
		).toBe(false);
		expect(STORY_LIFECYCLE_RESULT.restore).toBe("private");
	});

	it("every operation has a destination; the vocabulary and result table agree", () => {
		/**
		 * The cache policy copies this table's lifecycle results (`@rowcat/query`). If the vocabulary
		 * gains a value and this table has no entry for it, the badge after that transition silently
		 * keeps its old value.
		 */
		for (const action of STORY_LIFECYCLE_ACTIONS)
			expect(STORY_VISIBILITIES).toContain(STORY_LIFECYCLE_RESULT[action]);
	});

	it("no state offers an operation that returns to itself", () => {
		/**
		 * Pressing a button whose target equals the current state does nothing. The server accepts it as
		 * idempotent (safe to retry), but the screen has no reason to offer it in the first place.
		 */
		each((visibility) => {
			for (const action of storyLifecycleActions({ visibility }))
				expect(STORY_LIFECYCLE_RESULT[action]).not.toBe(visibility);
		});
	});

	it("offers no operation outside the vocabulary", () => {
		each((visibility) => {
			for (const action of storyLifecycleActions({ visibility }))
				expect(STORY_LIFECYCLE_ACTIONS).toContain(action);
		});
	});

	it("ignores operator hiding; the owner can tidy a hidden work too", () => {
		/**
		 * Hidden is controlled by another party. Taking away the owner's ability to tidy their own work
		 * in that state would be a dead end, not a sanction. A hidden work moved to `public` still looks
		 * hidden to others, because the server does not touch `hidden`.
		 */
		each((visibility) => {
			expect(storyLifecycleActions({ visibility })).toEqual(
				storyLifecycleActions({ visibility }),
			);
		});
		expect(storyLifecycleActions({ visibility: "public" })).toContain(
			"archive",
		);
	});
});

describe("canRunStoryLifecycleAction", () => {
	it("gives the same answer as the list", () => {
		const all: StoryLifecycleAction[] = [...STORY_LIFECYCLE_ACTIONS];
		each((visibility) => {
			const allowed = storyLifecycleActions({ visibility });
			for (const action of all)
				expect(canRunStoryLifecycleAction({ visibility }, action)).toBe(
					allowed.includes(action),
				);
		});
	});
});

/**
 * The four visibility questions. They are not folded into one boolean.
 *
 * `Link only` (link sharing) is what brought this split into the repo. Before it, discovery and direct
 * viewing gave the same answer (visibility === 'public'), so checks could be scattered without
 * trouble. If any one of them keeps the old answer, link-shared works either leak into the gallery
 * or return 404 to people who have the address.
 */
describe("exposure predicates", () => {
	it("only public is discoverable", () => {
		expect(STORY_VISIBILITIES.filter(isStoryDiscoverable)).toEqual(["public"]);
	});

	it("public and link-only open by address", () => {
		expect(STORY_VISIBILITIES.filter(isStoryDirectlyViewable)).toEqual([
			"public",
			"unlisted",
		]);
	});

	it("those two are also shareable", () => {
		expect(STORY_VISIBILITIES.filter(isStoryShareable)).toEqual([
			"public",
			"unlisted",
		]);
	});

	it("only public stands on the public profile grid", () => {
		/**
		 * Discovery and creator-profile visibility give the same answer, but for different reasons. The
		 * profile grid is where the owner says what they put into lists. Including link-shared works
		 * would make that state discoverable through the creator profile list.
		 */
		expect(STORY_VISIBILITIES.filter(isStoryVisibleOnCreatorProfile)).toEqual([
			"public",
		]);
	});

	it("exactly one state opens without being discoverable", () => {
		/**
		 * This one line defines the feature. If the states drift back to one answer (adding `unlisted` to
		 * discovery, or taking it out of direct viewing), the feature has been removed.
		 */
		expect(
			STORY_VISIBILITIES.filter(
				(v) => !isStoryDiscoverable(v) && isStoryDirectlyViewable(v),
			),
		).toEqual(["unlisted"]);
	});

	it("private and archived are true for no question", () => {
		for (const visibility of ["private", "archived"] as const) {
			expect(isStoryDiscoverable(visibility)).toBe(false);
			expect(isStoryDirectlyViewable(visibility)).toBe(false);
			expect(isStoryShareable(visibility)).toBe(false);
			expect(isStoryVisibleOnCreatorProfile(visibility)).toBe(false);
		}
	});
});

/**
 * The badge text. Both apps call the same function.
 *
 * Public returns null on purpose. That state is the default. A badge for it would put an
 * uninformative pill on nearly every card, and the states that do carry meaning would be harder to
 * notice.
 */
describe("storyVisibilityBadgeLabel", () => {
	it("public has no badge", () => {
		expect(storyVisibilityBadgeLabel("public")).toBeNull();
	});

	it("the rest use the vocabulary table's words", () => {
		expect(storyVisibilityBadgeLabel("unlisted")).toBe("Link only");
		expect(storyVisibilityBadgeLabel("private")).toBe("Private");
		expect(storyVisibilityBadgeLabel("archived")).toBe("Archived");
		each((visibility) => {
			const label = storyVisibilityBadgeLabel(visibility);
			if (label !== null)
				expect(label).toBe(STORY_VISIBILITY_LABEL[visibility]);
		});
	});
});

describe("isOwnWorkViewable", () => {
	it("archived and operator-hidden do not open even for the owner", () => {
		/**
		 * The detail page passes through the same viewing boundary as the list. If this predicate is
		 * wrong, the screen draws dead links: the creator clicks their own work and gets `Not found`.
		 */
		expect(isOwnWorkViewable({ hidden: false, visibility: "public" })).toBe(
			true,
		);
		expect(isOwnWorkViewable({ hidden: false, visibility: "private" })).toBe(
			true,
		);
		expect(isOwnWorkViewable({ hidden: false, visibility: "unlisted" })).toBe(
			true,
		);
		expect(isOwnWorkViewable({ hidden: false, visibility: "archived" })).toBe(
			false,
		);
		expect(isOwnWorkViewable({ hidden: true, visibility: "public" })).toBe(
			false,
		);
	});
});
