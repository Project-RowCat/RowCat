import { readFileSync } from "node:fs";
import { STORY_START_LABEL } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import { storyStartLabel } from "./story-start-copy.ts";

/**
 * The primary action of the story detail — **it is always start.**
 *
 * This spot once guarded the screen side of collecting (copy that stated a price, collect failure
 * branches, the path to top-up, a cell waiting on subscription state). With collecting gone this
 * button does one thing, and what is guarded here is **that absence** — if collect wiring comes back,
 * a button stands that calls an operation the server does not have.
 *
 * This app's tests do not render screens. So copy is checked **by value** and wiring by a static
 * scan (`lib/boundaries.test.ts` works the same way).
 */

const source = readFileSync(
	new URL("./story-start-control.tsx", import.meta.url),
	"utf8",
);
const hook = readFileSync(
	new URL("./use-story-start.tsx", import.meta.url),
	"utf8",
);

describe("primary action copy", () => {
	it("the words are the domain's table as is", () => {
		expect(storyStartLabel(false, "chat")).toBe(STORY_START_LABEL.chat);
		expect(storyStartLabel(false, "runtime")).toBe(STORY_START_LABEL.runtime);
	});

	it("without a playback mode it's conversation", () => {
		expect(storyStartLabel(false)).toBe(STORY_START_LABEL.chat);
	});

	/**
	 * The in-progress copy follows the playback mode too — drawing "Starting the conversation" on a
	 * runtime story promises something other than what opens at that moment.
	 */
	it("in-progress copy differs per playback mode", () => {
		expect(storyStartLabel(true, "chat")).toBe("Starting the conversation");
		expect(storyStartLabel(true, "runtime")).toBe("Preparing");
	});
});

describe("absence of ownership", () => {
	/**
	 * The server has no collect path. If the screen takes that vocabulary back in, either a button that
	 * always fails when pressed stands, or a top-up link that leads nowhere gets attached.
	 */
	it("hooks and screens don't call ownership or billing", () => {
		for (const code of [source, hook]) {
			expect(code).not.toMatch(/stories\.purchase|purchaseStory/);
			expect(code).not.toMatch(/"\/billing"|billingSummary|cattower/i);
			expect(code).not.toMatch(/[Cc]huru|[Cc]ollect/);
		}
	});

	/**
	 * With one primary action there is **no reason to wait for personalization.** If the lookup that
	 * asked about ownership came back, the button would lock until it finished, and presses in between
	 * would do nothing.
	 */
	it("the primary action doesn't wait for the personalized lookup", () => {
		expect(hook).not.toMatch(/personalizationQueryOptions/);
		expect(source).not.toMatch(/start\.primary/);
	});
});

/**
 * Where the picture comes from — paired with the web's function of the same name. If the screen read
 * the playback mode in a ternary, that decision would exist twice across the two apps, and one day
 * only one copy would be fixed.
 */
describe("primary action icon", () => {
	it("picks the icon from the domain's table", () => {
		expect(source).toMatch(/storyStartGlyph\(story\.playMode\)/);
	});

	it("doesn't branch on playback mode directly", () => {
		expect(source).not.toMatch(/icon="chat"/);
		expect(source).not.toMatch(/playMode === "runtime"/);
	});
});
