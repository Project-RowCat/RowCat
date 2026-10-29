import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Story } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import { STORY_SHARE_LABEL, storySharePayload } from "./share-story.ts";

/**
 * Sharing a work: **whether it can be handed over, and what gets included.**
 *
 * This app's tests do not render screens, so verdicts are checked **by value** and wiring **by
 * static scan** (`lib/boundaries.test.ts` works the same way). All three regressions targeted here
 * are silent: a private work's link leaving the device, a dead link produced by a deployment with
 * no origin, and an invented sentence getting attached to a shared text.
 */

const storyOf = (over: Partial<Story> = {}): Story => ({
	id: "s1",
	title: "The Night Library",
	description: "Description",
	author: "",
	coverUrl: null,
	orientation: null,
	adult: false,
	visibility: "public",
	promptProtected: false,
	tags: ["noir", "mystery"],
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
			title: "The Night Library",
			url: `${ORIGIN}/stories/s1`,
		});
	});

	/**
	 * **A private work is not handed over.** Its detail opens for its owner, so arriving here is
	 * normal, but whoever receives the link sees a 404, and the sender cannot tell what they did
	 * wrong.
	 */
	it("private stories aren't shared", () => {
		expect(
			storySharePayload(storyOf({ visibility: "private" }), ORIGIN),
		).toBeNull();
	});

	/**
	 * **An unlisted work is handed over: sharing is exactly what someone who chose that state wants to
	 * do.**
	 *
	 * If the verdict were written as "is it public", only this line would break quietly, and the
	 * symptom would be the share button vanishing from an unlisted work's detail (the feature would
	 * lose its handle).
	 */
	it("unlisted stories are shared — the same address as public", () => {
		expect(
			storySharePayload(storyOf({ visibility: "unlisted" }), ORIGIN),
		).toEqual({
			title: "The Night Library",
			url: `${ORIGIN}/stories/s1`,
		});
	});

	/**
	 * An archived work does not open from outside: the recipient gets a 404, so it is a dead end, not
	 * a link.
	 */
	it("archived stories aren't shared", () => {
		expect(
			storySharePayload(storyOf({ visibility: "archived" }), ORIGIN),
		).toBeNull();
	});

	/** With no origin in a deployment there is no address to build; a guessed domain is a 404 for the recipient. */
	it("without an origin it isn't shared", () => {
		expect(storySharePayload(storyOf(), null)).toBeNull();
	});

	/** A trailing slash would yield `//stories/...`, and that address splits depending on the origin. */
	it("removes the trailing slash", () => {
		expect(storySharePayload(storyOf(), `${ORIGIN}/`)?.url).toBe(
			`${ORIGIN}/stories/s1`,
		);
	});

	/**
	 * The ids issued today are hyphen-free hex, so encoding changes nothing. Relying on that fact
	 * would silently break **only shared addresses** the day the id rule changes.
	 */
	it("encodes the id", () => {
		expect(storySharePayload(storyOf({ id: "a b/c" }), ORIGIN)?.url).toBe(
			`${ORIGIN}/stories/a%20b%2Fc`,
		);
	});
});

describe("only the title and address are carried", () => {
	/**
	 * Description, tags, creator and rating are not carried. This payload **leaves** through the app
	 * the user picks and persists on someone else's device, so any sentence we added becomes words
	 * that person never wrote. The adult-content display especially: carrying it would surface that
	 * word in the recipient's notification preview.
	 */
	it("the key set is two", () => {
		const payload = storySharePayload(
			storyOf({ adult: true, visibility: "public" }),
			ORIGIN,
		);
		expect(payload && Object.keys(payload).sort()).toEqual(["title", "url"]);
	});

	it("description, tags, creator and rating aren't carried", () => {
		const payload = storySharePayload(storyOf({ adult: true }), ORIGIN);
		const serialized = JSON.stringify(payload);
		for (const absent of ["Description", "noir", "Creator", "Adult", "adult"])
			expect(serialized, absent).not.toContain(absent);
	});

	/**
	 * **Title and address are not joined into one string.** iOS needs `url` to draw the preview card,
	 * and joining them would make that card disappear (Android folds to one string anyway).
	 */
	it("the title doesn't mix into the address", () => {
		const payload = storySharePayload(storyOf(), ORIGIN);
		expect(payload?.url).not.toContain("The Night Library");
	});
});

/**
 * **Wiring**: a rule existing does not mean the screen uses it.
 *
 * The regression this group targets is one thing: the screen re-deriving the verdict. If the detail
 * screen starts reading visibility state directly, the same rule lives in two places, and one of
 * them sends a link that is a 404 to the recipient.
 */
describe("wiring", () => {
	const SRC = fileURLToPath(new URL("../..", import.meta.url));
	const stripComments = (text: string): string =>
		text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
	const read = (path: string): string =>
		stripComments(readFileSync(join(SRC, path), "utf8"));

	const control = read("features/story/share-control.tsx");
	const detail = read("features/story/story-detail-screen.tsx");

	it("the detail screen actually stands the share operation", () => {
		expect(detail).toContain("<StoryShareControl story={value} />");
	});

	/** There is one primary action; sharing does not stand up a second filled button. */
	it("share doesn't compete with the primary action", () => {
		expect(control).not.toContain("<Button");
		expect(control).toContain('<Icon name="share"');
	});

	/**
	 * One owner of the verdict. If the screen re-reads visibility or the origin, that copy diverges
	 * from the pure function, and the diverged side sends the link.
	 */
	it("the screen doesn't re-read the visibility state", () => {
		expect(control).toContain("storySharePayload(story, WEB_ORIGIN)");
		expect(control).not.toMatch(/isPrivate|visibility/);
	});

	/**
	 * **The screen does not assemble the address.** This value leaves the device and persists on
	 * someone else's; if a copy diverges from the route rules, the link is dead.
	 */
	it("doesn't write addresses by hand", () => {
		for (const file of [control, read("features/story/share-story.ts")])
			expect(file).not.toMatch(/`\$\{[^`]*\}\/stories\//);
		expect(read("features/story/share-story.ts")).toContain("storyWebUrl");
	});

	/**
	 * **Not built as an app scheme.** The person opening this address is the one who received the
	 * link, and their device has no reason to have this app (the same call as the guardian consent
	 * link).
	 */
	it("doesn't use the app scheme", () => {
		for (const file of [control, read("features/story/share-story.ts")])
			expect(file).not.toContain("rowcat://");
	});

	/**
	 * **No new dependency.** Pulling in a sharing library would be a build-pipeline change needing a
	 * native rebuild, not a component addition: RN core's `Share` opens both platforms' sheets as they
	 * are.
	 */
	it("uses RN core's share", () => {
		expect(control).toMatch(
			/import \{[^}]*\bShare\b[^}]*\} from "react-native"/,
		);
		expect(control).not.toMatch(/react-native-share|expo-sharing/);
	});

	/**
	 * **There is exactly one place that hands over a work.**
	 *
	 * The list has a second entry, and it hands over something else: the guardian consent link
	 * (`guardian-panel.tsx`). That value is a single-use address the server creates, and its verdict
	 * differs (the recipient is not a member), so it does not pass the same function. That is why the
	 * list is pinned: if each screen began opening a sheet on its own, one of them would skip the
	 * visibility verdict, and the failure would show only **after** the link had gone out.
	 */
	it("the files opening the share sheet match the list", () => {
		const sources = (dir: string, files: string[] = []): string[] => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) sources(full, files);
				else if (/\.tsx?$/.test(entry.name)) files.push(full);
			}
			return files;
		};
		const callers = sources(SRC)
			.map((path) => ({
				path: path.slice(SRC.length),
				text: stripComments(readFileSync(path, "utf8")),
			}))
			.filter((file) => !/\.test\.tsx?$/.test(file.path))
			.filter((file) => /\bShare\.share\(/.test(file.text))
			.map((file) => file.path);
		expect(callers.sort()).toEqual([
			"features/onboarding/guardian-panel.tsx",
			"features/story/share-control.tsx",
		]);
	});
});

/** A trigger with only a picture reads as just "button"; the name says what is being shared. */
describe("copy", () => {
	it("the name says what is being shared", () => {
		expect(STORY_SHARE_LABEL).toBe("Share story");
	});
});
