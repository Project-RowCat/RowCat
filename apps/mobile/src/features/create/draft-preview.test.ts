import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StoryDraft } from "@rowcat/authoring";
import { describe, expect, it } from "vitest";
import { draftCardView } from "./draft-card-view.ts";
import { DRAFT_PREVIEW_SECTION } from "./editor-copy.ts";

/**
 * The editor's discovery-grid preview claims one thing: "this is how it will look once published".
 * It turns false silently in two ways: re-writing normalization here so it diverges from
 * publication, or hand-drawing the card so it diverges from the grid. The first is checked by
 * value, the second by wiring.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const stripComments = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (...parts: string[]) =>
	stripComments(readFileSync(join(HERE, ...parts), "utf8"));

const draft = (patch: Partial<StoryDraft> = {}): StoryDraft =>
	({
		id: "draft-1",
		title: "  The Convenience Store That Rewinds the Night  ",
		description: "",
		prompt: "",
		tags: [],
		orientation: null,
		adult: false,
		visibility: "private",
		promptProtected: false,
		publishedStoryId: null,
		...patch,
	}) as StoryDraft;

describe("draft → card values", () => {
	/**
	 * Goes through publication's own normalization (`prepareStoryMetadata`). A second `trim()` here
	 * would eventually be fixed on one side only, surfacing as a preview that differs from the
	 * published card, which is known only after publishing.
	 */
	it("the title folds by the same rule as publishing", () => {
		expect(draftCardView(draft(), { coverUrl: null }).title).toBe(
			"The Convenience Store That Rewinds the Night",
		);
	});

	/**
	 * An empty title is not filled in. `Untitled` is the draft list's vocabulary and the grid never draws
	 * it; filling it makes only the preview look fine and the user is blocked at the publish button.
	 * An empty-looking card is the accurate signal.
	 */
	it("doesn't put a fallback in an empty title", () => {
		expect(
			draftCardView(draft({ title: "   " }), { coverUrl: null }).title,
		).toBe("");
	});

	/**
	 * The badge word is decided by the domain predicate. A hand-written `private` comparison would
	 * silently go blank only for `Link only` drafts now that there are four states.
	 */
	it("the visibility badge answers all four states", () => {
		const label = (visibility: StoryDraft["visibility"]) =>
			draftCardView(draft({ visibility }), { coverUrl: null }).visibilityLabel;
		expect(label("private")).toBe("Private");
		expect(label("unlisted")).toBe("Link only");
		/**
		 * Archived is not a publish destination; publication folds it to private
		 * (`prepareStoryMetadata`). The preview shows what will be published, so it folds the same way
		 * and says the same word as the publish button.
		 */
		expect(label("archived")).toBe("Private");
		/** Public draws no badge; badging the default state puts a pill on nearly every card. */
		expect(label("public")).toBeNull();
	});

	/** A draft has no story id; the check's value is that there is no slot to fill. */
	it("there's no slot to invent a story id", () => {
		expect(draftCardView(draft(), { coverUrl: null })).not.toHaveProperty("id");
	});
});

describe("doesn't redraw the card by hand", () => {
	/**
	 * Goes through the grid's own component. A preview drawing its own card goes stale when the grid
	 * changes title lines or adds a badge, and the creator learns of a truncated word only after
	 * publishing.
	 */
	it("calls the discover grid's card component", () => {
		const preview = code("draft-preview-section.tsx");
		expect(preview).toContain("<StoryCardBody");
		expect(preview).toContain('from "../discover/story-card-body.tsx"');
		/** Cover, badge and title are not re-assembled here. */
		expect(preview).not.toContain("<StoryCover");
		expect(preview).not.toContain("<Badge");
	});

	/** Not wrapped: with a `Pressable` the card would press with no detail to open and no work to favourite. */
	it("the preview creates no press", () => {
		const preview = code("draft-preview-section.tsx");
		expect(preview).toContain("wrapMedia={(media) => media}");
		expect(preview).not.toContain("Pressable");
		expect(preview).not.toContain("router.push");
		expect(preview).not.toContain("<FavoriteControl");
	});

	/** Removed from both fingers and assistive technology; one alone leaves it operable to the other. */
	it("both layers drop out together", () => {
		const preview = code("draft-preview-section.tsx");
		expect(preview).toContain('pointerEvents="none"');
		expect(preview).toContain("accessibilityElementsHidden");
		expect(preview).toContain(
			'importantForAccessibility="no-hide-descendants"',
		);
	});

	/**
	 * The grid's card still presses. Without this, a change that strips pressing from the card to
	 * satisfy the three checks above would pass green.
	 */
	it("the grid's card still presses", () => {
		const card = code("../discover/story-card.tsx");
		expect(card).toContain("<Pressable");
		expect(card).toContain('pathname: "/stories/[storyId]"');
		expect(card).toContain("<FavoriteControl");
	});
});

describe("copy", () => {
	/**
	 * Drawing a not-yet-uploaded cover says so: the card claims "once published", so the picture not
	 * being on the server yet is a condition of that claim.
	 */
	it("the set-aside cover's description says so", () => {
		expect(DRAFT_PREVIEW_SECTION.stagedDescription).toContain("cover");
		expect(DRAFT_PREVIEW_SECTION.stagedDescription).toContain(
			"when you publish",
		);
		/** The branch drawing the server's cover has no such sentence; it is already uploaded. */
		expect(DRAFT_PREVIEW_SECTION.description).not.toContain("Cover");
	});

	/** The description splits by cover source, not by published state (a cover exists before publishing). */
	it("the two sentences are separate", () => {
		expect(DRAFT_PREVIEW_SECTION.description).not.toBe(
			DRAFT_PREVIEW_SECTION.stagedDescription,
		);
		expect(code("draft-preview-section.tsx")).toContain("cover.staged");
	});

	/**
	 * The cover goes through the same hook as the field right above; separate decisions would have one
	 * side show the staged file and the other the server's old cover, side by side.
	 */
	it("calls the same hook as the cover cell", () => {
		const preview = code("draft-preview-section.tsx");
		const field = code("draft-cover-field.tsx");
		expect(preview).toContain("useDraftCoverUrl(draft)");
		expect(field).toContain("useDraftCoverUrl(draft)");
		/** No separate server query here; that decision lives inside the hook. */
		expect(preview).not.toContain("storyQueryOptions");
	});
});
