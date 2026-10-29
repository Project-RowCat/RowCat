import type { Story } from "@rowcat/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { StoryShareControl } from "./share-control.tsx";

/**
 * Hydration boundary for the share control: the first render must not read the browser.
 *
 * The repo's rule against rendering React in web tests exists because tests break whenever markup
 * changes. That rationale does not apply here. This file checks one thing, whether the control is
 * present in the first render, and that answer must hold regardless of class changes
 * (`features/chat/messages/markdown-render.test.tsx` made the same call).
 *
 * The regression this guards against: deriving the origin during render (a `typeof window` check)
 * makes the server send a tree without the control, while the browser builds one with it from the
 * first render. The trees diverge silently, and the page looks like it works.
 *
 * `renderToStaticMarkup` can answer this because it does not run effects. As long as the origin is
 * set in an effect, the tree it sees matches the first pass of `hydrateRoot`. The only gap would be
 * `useSyncExternalStore`'s `getServerSnapshot`, which this component does not use.
 *
 * A true `hydrateRoot` regression test needs a DOM implementation, which this workspace lacks.
 * Building test infrastructure for one share control is not worth it, so the test renders the tree
 * before effects run instead.
 */

const storyOf = (over: Partial<Story> = {}): Story => ({
	id: "s1",
	title: "Night Library",
	description: "Description",
	author: "",
	coverUrl: null,
	orientation: null,
	adult: false,
	visibility: "public",
	promptProtected: false,
	tags: [],
	favorites: 12,
	creator: { id: "c1", nickname: "Creator" },
	playMode: "chat",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	sizeBytes: 0,
	...over,
});

/**
 * The tree before effects run: the server render, which is also the first client render during
 * hydration.
 */
const firstRender = (story: Story): string =>
	renderToStaticMarkup(<StoryShareControl story={story} />);

/**
 * Only `window.location.origin` is stubbed. Adding more stubs would make the test check our own
 * fakes. What matters is that the origin can be read, and that the first render still does not use
 * it.
 */
const withBrowserOrigin = (origin: string, run: () => string): string => {
	const global = globalThis as { window?: unknown };
	const had = "window" in global;
	const before = global.window;
	global.window = { location: { origin } };
	try {
		return run();
	} finally {
		if (had) global.window = before;
		else delete global.window;
	}
};

afterEach(() => {
	delete (globalThis as { window?: unknown }).window;
});

describe("first render", () => {
	/**
	 * The server has no origin. A guessed domain would 404 for the recipient, so the control is not
	 * drawn at all in that case.
	 */
	it("server render has no share control", () => {
		expect("window" in globalThis).toBe(false);
		expect(firstRender(storyOf())).toBe("");
	});

	/**
	 * The regression test for this file. The assertion failed while the origin was read during render:
	 * the button was drawn and the tree diverged from the server's. The first render must be empty
	 * even when the browser has an origin, for the two trees to match.
	 */
	it("the first render has no share control even with an origin in the browser", () => {
		const out = withBrowserOrigin("https://example.com", () =>
			firstRender(storyOf()),
		);
		expect(out).toBe("");
		expect(out).not.toContain("Share story");
	});

	/**
	 * The invariant this slice keeps: the server tree and the first client tree are identical,
	 * whatever the exposure state. Link-public works are shareable, so the check must hold for them
	 * too. Without it, the trees would diverge only for those works.
	 */
	it("the server tree equals the first client tree", () => {
		for (const visibility of [
			"public",
			"unlisted",
			"private",
			"archived",
		] as const) {
			const story = storyOf({ visibility });
			const server = firstRender(story);
			const client = withBrowserOrigin("https://example.com", () =>
				firstRender(story),
			);
			expect(client, visibility).toBe(server);
		}
	});
});
