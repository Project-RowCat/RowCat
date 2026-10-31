import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **A new story is a new screen instance.**
 *
 * The screen holds per-playthrough state that must never cross stories: the answer to the trusted AI
 * notice (`aiAllowed` — one press must not become permission across this person's runtime stories),
 * the play-start report flag, the open dialogs, and the bridge, session and lifecycle that
 * `use-runtime-player.ts` creates once per mount. Whether a navigation from story A to story B
 * remounts depends on the router's stack bookkeeping, which this app does not own; a `key` on the
 * story id makes it a property of this route instead. This app's tests do not render, so the key is
 * pinned by value.
 */
const route = readFileSync(
	fileURLToPath(
		new URL("../../app/chat/runtime/[storyId].tsx", import.meta.url),
	),
	"utf8",
);

describe("runtime playback route", () => {
	it("keys the screen on the story id", () => {
		expect(route).toMatch(
			/<RuntimeChatScreen\s+key=\{id\}\s+storyId=\{id\}\s*\/>/,
		);
	});

	it("renders the screen in one place", () => {
		expect(route.match(/<RuntimeChatScreen\b/g)).toHaveLength(1);
	});
});
