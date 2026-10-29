import {
	createStoryDraftRecord,
	prepareStoryPublication,
	type StoryDraft,
} from "@rowcat/authoring";
import type { Story, Viewer } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import { storyCardView } from "#/features/gallery/story-card-view.ts";
import { draftCardView } from "./card-view.ts";

/**
 * **Is the preview card the same as the real gallery card?** The claim this screen makes is one
 * thing: 'when published, it looks like this'. If that is wrong, the symptom is nasty. A creator
 * puts a word on the card they believe is visible, publishes, and only then sees it cut off. So the
 * assertion is not 'similar'. It compares the values produced by the two paths. One path builds the
 * card values from the draft (the editor), and the other from the work the server would return once
 * the draft is published (the gallery). The whole objects are compared.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

const viewer = {
	id: "member-1",
	nickname: "NightLibrarian",
} as unknown as Viewer;

function draftOf(overrides: Partial<StoryDraft> = {}): StoryDraft {
	return {
		...createStoryDraftRecord(
			{
				title: "The Night Library",
				description: "A library where the books talk.",
				tags: ["fantasy", "cat"],
				orientation: "all",
				prompt: "A library that opens only at night.",
			},
			{ id: "draft-1", now: NOW, rev: REV },
		),
		...overrides,
	};
}

/**
 * The work the gallery would receive once this draft is published. It imitates what the server
 * does: the authored content is exactly the publish request (`prepareStoryPublication`), while
 * identity, aggregates, and timestamps are filled in by the server. Visibility is stored as
 * requested (`services/story/index.ts`, `visibility: row.visibility`).
 */
function publishedStory(draft: StoryDraft, coverUrl: string | null): Story {
	const { metadata } = prepareStoryPublication({
		draft,
		lore: [],
		startScenes: [],
		sceneImages: [],
	}).publication;

	return {
		id: "story-from-server",
		title: metadata.title,
		description: metadata.description,
		author: "",
		coverUrl,
		orientation: metadata.orientation,
		adult: metadata.adult,
		visibility: metadata.visibility,
		promptProtected: metadata.promptProtected,
		tags: metadata.tags,
		favorites: 0,
		creator: { id: viewer.id, nickname: viewer.nickname },
		/**
		 * A freshly published, normal work. It has an owner and a playback payload, so the server
		 * projection returns true.
		 */
		playMode: "chat",
		createdAt: NOW,
		updatedAt: NOW,
		sizeBytes: 0,
	};
}

const bothViews = (draft: StoryDraft, coverUrl: string | null = null) => ({
	preview: draftCardView(draft, { coverUrl, viewer }),
	gallery: storyCardView(publishedStory(draft, coverUrl)),
});

describe("the same values as the gallery card", () => {
	it("for an ordinary draft the two cards are identical", () => {
		const { preview, gallery } = bothViews(draftOf(), "/v2/stories/x/cover");
		expect(preview).toEqual(gallery);
	});

	/**
	 * Normalization goes through **the same function as publishing**. If it diverged here, the title
	 * and tags shown in the preview would differ from the values that actually get stored.
	 */
	it("title whitespace and duplicate or empty tags fold by the same rule as publishing", () => {
		const { preview, gallery } = bothViews(
			draftOf({
				title: "  The Night Library  ",
				tags: [" fantasy ", "", "fantasy", "cat"],
			}),
		);

		expect(preview.title).toBe("The Night Library");
		expect(preview.tags).toEqual(["fantasy", "cat"]);
		expect(preview).toEqual(gallery);
	});

	it("the adult marker and orientation carry over as is", () => {
		const { preview, gallery } = bothViews(
			draftOf({ adult: true, orientation: "female" }),
		);
		expect(preview.adult).toBe(true);
		expect(preview.orientation).toBe("female");
		expect(preview).toEqual(gallery);
	});
});

/**
 * The visibility badge rule is **the domain's predicate**, not this screen's judgment. All four
 * values are checked because of `archived`. The publish screen cannot select it, so nobody checks
 * it by hand, and a mistake that folds only that value would go unnoticed. Since `unlisted` was
 * added, **two values carry a badge**. This group guards against regressions where the preview and
 * the gallery use different words.
 */
describe("visibility badge", () => {
	it.each([
		["private", "Private"],
		["unlisted", "Link only"],
		["public", null],
		/**
		 * Archiving is not a publish destination. The publish request folds it into private
		 * (`prepareStoryMetadata`). The preview goes through the same folding, since it shows what
		 * publishing will look like, and it uses the same word as the publish button's `Publish privately`.
		 */
		["archived", "Private"],
	] as const)("visibility=%s → badge %s", (visibility, expected) => {
		const draft = draftOf({ visibility });
		const { preview, gallery } = bothViews(draft);
		expect(preview.visibilityLabel).toBe(expected);
		expect(preview.visibilityLabel).toBe(gallery.visibilityLabel);
	});
});

describe("byline", () => {
	/**
	 * The gallery shows the **creator account's nickname**, not the author name written on the work.
	 * So the preview also uses the logged-in member's nickname.
	 */
	it("uses the current member's nickname", () => {
		expect(draftCardView(draftOf(), { coverUrl: null, viewer }).byline).toBe(
			"NightLibrarian",
		);
	});

	/**
	 * The viewer has not been read yet. **No name is invented.** A brief blank is more honest than
	 * drawing a name that does not exist. This is the same axis as not showing 'unknown' for a deleted
	 * creator.
	 */
	it("leaves it empty when the viewer is unknown", () => {
		expect(
			draftCardView(draftOf(), { coverUrl: null, viewer: null }).byline,
		).toBe("");
	});
});

/**
 * **The work's identity is not invented.** The card value has no work id at all. If it had one, the
 * draft would have to fill that slot, and a value made that way would corrupt the meaning of
 * `Story.id`, the identity of the published work.
 */
describe("identity", () => {
	it("the card value's key set has no story id", () => {
		expect(
			Object.keys(draftCardView(draftOf(), { coverUrl: null, viewer })).sort(),
		).toEqual([
			"adult",
			"byline",
			"coverUrl",
			"orientation",
			"tags",
			"title",
			"visibilityLabel",
		]);
	});
});

/**
 * The preview **only reads the draft**. If the draft changed here, opening the preview would edit
 * the manuscript.
 */
describe("draft", () => {
	it("does not change the draft", () => {
		const draft = draftOf({ title: "  spaces  ", tags: [" a ", "a"] });
		const before = JSON.stringify(draft);
		draftCardView(draft, { coverUrl: null, viewer });
		expect(JSON.stringify(draft)).toBe(before);
	});
});
