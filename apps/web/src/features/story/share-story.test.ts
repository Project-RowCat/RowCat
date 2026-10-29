import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Story } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import { storySharePayload } from "./share-story.ts";

/**
 * Work sharing: what can be handed off, and what is included.
 *
 * These rules fail silently. A private work's link leaking out, or the share button disappearing
 * for link-public works, raises no error. So they are locked with values.
 *
 * The mobile app has a same-named pair (`apps/mobile/src/features/story/share-story.test.ts`), and
 * both files run the same table. The source of the judgement is one domain predicate
 * (`isStoryShareable`). If each app wrote its own, one would eventually forget link-public.
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

const ORIGIN = "https://example.com";

describe("can it be shared", () => {
	it("a public story with an origin can be shared", () => {
		expect(storySharePayload(storyOf(), ORIGIN)).toEqual({
			title: "Night Library",
			url: `${ORIGIN}/stories/s1`,
		});
	});

	/**
	 * Link-public works are shareable, at the same address as public works.
	 *
	 * If the rule were written as 'is public', only this line would break, and silently. Link-public
	 * works would lose the share control entirely, and the feature would have no handle for that
	 * state.
	 */
	it("a link-only story is shared at **the same address** as a public one", () => {
		expect(
			storySharePayload(storyOf({ visibility: "unlisted" }), ORIGIN),
		).toEqual({ title: "Night Library", url: `${ORIGIN}/stories/s1` });
	});

	/**
	 * Private works are not shared. Their detail page opens for the owner, so the control arriving
	 * here is normal. But a link recipient gets a 404, and the sender cannot tell what went wrong.
	 */
	it("private and archived are not shared", () => {
		expect(
			storySharePayload(storyOf({ visibility: "private" }), ORIGIN),
		).toBeNull();
		expect(
			storySharePayload(storyOf({ visibility: "archived" }), ORIGIN),
		).toBeNull();
	});

	it("not shared without an origin", () => {
		expect(storySharePayload(storyOf(), null)).toBeNull();
	});
});

describe("what is carried", () => {
	/**
	 * A single canonical route. There is no token, no query parameter, no expiry, and no separate
	 * address for link-public works. Once an address carries the exposure difference, the string
	 * itself becomes the authorization, a security boundary this feature never promised.
	 */
	it("link only carries no token or parameter", () => {
		const url = storySharePayload(
			storyOf({ visibility: "unlisted" }),
			ORIGIN,
		)?.url;
		expect(url).toBe(`${ORIGIN}/stories/s1`);
		expect(url).not.toContain("?");
		expect(url).not.toContain("token");
	});

	it("one address even with a trailing slash on the origin", () => {
		expect(storySharePayload(storyOf(), `${ORIGIN}/`)?.url).toBe(
			`${ORIGIN}/stories/s1`,
		);
	});

	/**
	 * The story id is encoded. The server issues the id, but if the id format ever changes, only
	 * addresses that were already shared would break silently.
	 */
	it("encodes the story id", () => {
		expect(storySharePayload(storyOf({ id: "a/b?c" }), ORIGIN)?.url).toBe(
			`${ORIGIN}/stories/a%2Fb%3Fc`,
		);
	});

	/**
	 * Description, tags, creator, and rating are not included. The payload leaves the device in
	 * another app and stays on someone else's device, so any sentence we added would be words the
	 * sender never wrote. The adult flag would also show its keyword in the recipient's notification
	 * preview.
	 */
	it("only the title and the address", () => {
		const payload = storySharePayload(
			storyOf({ adult: true, description: "a secret description" }),
			ORIGIN,
		);
		expect(Object.keys(payload ?? {}).sort()).toEqual(["title", "url"]);
		expect(JSON.stringify(payload)).not.toContain("secret");
		expect(JSON.stringify(payload)).not.toContain("adult");
	});
});

/**
 * Having a rule does not mean the screen uses it. This block guards one regression: the screen
 * re-deriving the decision. If the control starts reading the exposure state directly, the same
 * rule lives in two places, and one of them eventually sends a link that returns 404 to the
 * recipient. The mobile app has the same block.
 */
describe("wiring", () => {
	const SRC = fileURLToPath(new URL("../..", import.meta.url));
	const stripComments = (text: string): string =>
		text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
	const read = (path: string): string =>
		stripComments(readFileSync(join(SRC, path), "utf8"));

	const control = read("features/story/share-control.tsx");
	const hero = read("features/story/story-hero.tsx");

	it("the story detail actually renders the share control", () => {
		expect(hero).toContain("<StoryShareControl story={story} />");
	});

	it("the screen does not reread the visibility", () => {
		expect(control).toContain("storySharePayload(story, origin)");
		expect(control).not.toMatch(/visibility|isStoryShareable/);
	});

	/**
	 * Checks the code shape that would bring back the defect: a single `typeof window` line is enough
	 * to reintroduce it. The rendered tree itself is checked in `share-control.test.tsx`.
	 */
	it("does not read window during render", () => {
		expect(control).not.toContain("typeof window");
		expect(control).toContain("useState<string | null>(null)");
		expect(control).toMatch(
			/useEffect\([\s\S]*?setOrigin\(window\.location\.origin\)[\s\S]*?\[\]\)/,
		);
	});

	/**
	 * The address is not assembled in the screen. The value leaves the device and stays there, so any
	 * copy of the route rule that drifts would produce a dead link. Hence the check against the
	 * literal route prefix.
	 */
	it("does not write the address by hand", () => {
		expect(control).not.toContain("/stories/");
	});

	it("sharing does not compete with the primary action", () => {
		expect(control).toContain('variant="ghost"');
		expect(control).toContain('size="icon"');
	});

	it("does not call the toast layer", () => {
		expect(control).not.toContain("showErrorToast");
		expect(control).not.toContain("lib/toast");
	});

	it("separates cancel from failure", () => {
		expect(control).toContain("isShareAbort(error)");
	});
});
