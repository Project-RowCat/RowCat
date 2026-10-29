import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	SECTION,
	SECTION_SUMMARY_NOUN,
	sectionSummary,
} from "./editor-copy.ts";

/**
 * Progressive disclosure in the editor: what collapses, and what stays when collapsed.
 *
 * This app's tests do not render screens. Wording is checked by value and structure by static scan
 * (the same approach as `lib/boundaries.test.ts`). Each regression below is silent:
 *
 * ```text
 * prompt collapses          the work's body reads as optional
 * publish collapses         the publish button cannot be found
 * collapse unmounts         unsaved typing and focus are lost on collapse
 * alert inside the body     the over-limit fact is hidden in a collapsed section
 * ```
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (path: string): string =>
	stripComments(readFileSync(join(SRC, path), "utf8"));

const section = read("create/editor-section.tsx");
const editor = read("create/draft-editor-screen.tsx");

describe("one summary line", () => {
	/**
	 * The question a collapsed section must answer is one: *is anything here?* So the answer is a
	 * count, not a word.
	 */
	it("states what and how many", () => {
		expect(sectionSummary(SECTION_SUMMARY_NOUN.lore, 4)).toBe("World · 4");
	});

	/**
	 * Zero is not hidden. A bare word would make "empty" and "not counted yet" the same text, and the
	 * user would have to open the section to tell them apart. The point of collapsing is to show what
	 * is there without opening it.
	 */
	it("writes 0 too", () => {
		expect(sectionSummary(SECTION_SUMMARY_NOUN.startScenes, 0)).toBe(
			"Opening scenes · 0",
		);
	});

	/** Counts are not abbreviated, the same rule as the rest of this repository. */
	it("separates thousands", () => {
		expect(sectionSummary(SECTION_SUMMARY_NOUN.sceneImages, 1234)).toBe(
			"Scene images · 1,234",
		);
	});

	/**
	 * The noun differs from the section title. The title sits right beside the summary, and repeating
	 * the same word would show it twice on one line.
	 */
	it("doesn't repeat the title as is", () => {
		expect(SECTION_SUMMARY_NOUN.lore).not.toBe(SECTION.lore.title);
	});
});

describe("what folds", () => {
	/**
	 * Only the three repeatable sections collapse. A work is valid without each of them (a work
	 * without lore, a conversation without an opening, a work without images), and each grows long
	 * when it has entries.
	 */
	it.each([
		["create/lore-section.tsx", "lore"],
		["create/start-scene-section.tsx", "startScenes"],
		["create/scene-image-section.tsx", "sceneImages"],
	])("%s passes a summary", (path, noun) => {
		const text = read(path);
		expect(text).toContain(`SECTION_SUMMARY_NOUN.${noun}`);
		expect(text).toContain("sectionSummary(");
	});

	/**
	 * Basics, prompt and publish never collapse. Without the first two there is no work, and
	 * collapsing publish would hide its button. The decision is the presence of `summary`, so not
	 * passing it means "open".
	 */
	it.each([
		"create/basics-section.tsx",
		"create/publish-section.tsx",
		"create/draft-editor-screen.tsx",
	])("%s doesn't pass a summary", (path) => {
		expect(read(path)).not.toContain("summary=");
	});

	/**
	 * The prompt section is built directly by the editor screen. The check above reads that file too,
	 * so it fails here first if the prompt starts collapsing.
	 */
	it("the prompt is a section of the editor screen", () => {
		expect(editor).toContain("SECTION.prompt.title");
	});
});

describe("folding loses nothing", () => {
	/**
	 * Hide, do not unmount. Conditional rendering would drop three things at the moment of collapse:
	 * typing still in the debounce, a card's local input state, and focus.
	 */
	it("doesn't render the body conditionally", () => {
		expect(section).toContain("{children}");
		expect(section).not.toMatch(/\{open \? children : null\}/);
		expect(section).toContain('hidden: { display: "none" }');
	});

	/**
	 * Warnings stand outside the collapse. Inside the body, over-limit or duplicate-trigger problems
	 * would be hidden until publish, and the warning exists to appear before that.
	 */
	it("warnings stand outside the body", () => {
		const body = section.slice(section.indexOf("{alert}"));
		expect(section).toContain("{alert}");
		expect(body).toContain("section.hidden");
	});

	it.each([
		"create/lore-section.tsx",
		"create/start-scene-section.tsx",
		"create/scene-image-section.tsx",
	])("%s passes warnings as alert", (path) => {
		expect(read(path)).toContain("alert={");
	});
});

describe("folding accessibility", () => {
	/**
	 * Open and closed are conveyed by state. Writing "expand" in the name would eventually disagree
	 * with the state, and the chevron is decoration with no name of its own.
	 */
	it("exposes the expanded state", () => {
		expect(section).toContain("accessibilityState={{ expanded }}");
		expect(section).not.toMatch(/accessibilityLabel=\{[^}]*[Ee]xpand/);
	});

	/** The name is title plus summary, so a user who cannot see the screen knows the count without opening it. */
	it("the name reads title and summary together", () => {
		expect(section).toMatch(
			/accessibilityLabel=\{summary \? `.+summary.+` : title\}/,
		);
	});

	/**
	 * The target is the whole row and 44pt. Rows sit directly above and below sibling sections, so
	 * widening them with `hitSlop` would overlap touch areas, and in RN the sibling drawn later wins.
	 */
	it("the trigger keeps the finger floor", () => {
		expect(section).toMatch(/trigger: \{[^}]*minHeight: touchTarget/);
		expect(section).not.toContain("hitSlop");
	});

	/** A non-collapsible section's title stays plain text, not a button. */
	it("an expanded section's title doesn't become a button", () => {
		expect(section).toMatch(
			/if \(!collapsible\)[\s\S]{0,200}accessibilityRole="header"/,
		);
	});
});

describe("doesn't store the folded state", () => {
	/**
	 * The value is what the user is looking at now, not a fact about the work. Once it is saved, the
	 * question of whether it syncs has to be answered, and either answer is wrong.
	 */
	it("written to neither the draft, the device nor the address", () => {
		for (const forbidden of [
			"patchDraft",
			"setParams",
			"AsyncStorage",
			"deviceStorage",
			"autosave",
		])
			expect(section, forbidden).not.toContain(forbidden);
	});

	/** No animation on collapse: a measuring layer and a growing layer overlapping would make the section jump on every open. */
	it("doesn't create an expand transition", () => {
		for (const forbidden of ["Animated", "withTiming", "LayoutAnimation"])
			expect(section, forbidden).not.toContain(forbidden);
	});
});
