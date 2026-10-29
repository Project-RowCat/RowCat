import { describe, expect, it } from "vitest";
import {
	createDraftLoreEntryRecord,
	createDraftStartSceneRecord,
	createStoryDraftRecord,
	markAuthoringDeleted,
	type StoryDraft,
} from "./model.ts";
import { buildPlaytestSnapshot } from "./playtest.ts";
import {
	buildStoryPublication,
	prepareStoryPublication,
	type StoryPublicationSource,
} from "./publication.ts";

/**
 * Playtest snapshots must go through the same normalization as publishing. The worst case is a work
 * that behaves differently once published than it did in testing, discovered only after it is
 * already in the catalog. The test compares two results by value. It checks that the same input
 * gives the same output, not that the code looks alike.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };
const stamp = (id: string) => ({ id, now: NOW, rev: REV });

function baseDraft(overrides: Partial<StoryDraft> = {}): StoryDraft {
	return {
		...createStoryDraftRecord(
			{ title: "The Night Library", prompt: "A library where books talk." },
			stamp("draft-1"),
		),
		...overrides,
	};
}

const lore = (
	id: string,
	input: Partial<Parameters<typeof createDraftLoreEntryRecord>[0]> = {},
) =>
	createDraftLoreEntryRecord(
		{ draftId: "draft-1", positionIndex: 0, ...input },
		stamp(id),
	);

const scene = (
	id: string,
	input: Partial<Parameters<typeof createDraftStartSceneRecord>[0]> = {},
) =>
	createDraftStartSceneRecord(
		{ draftId: "draft-1", position: 0, ...input },
		stamp(id),
	);

const source = (over: Partial<StoryPublicationSource> = {}) => ({
	draft: over.draft ?? baseDraft(),
	lore: over.lore ?? [],
	startScenes: over.startScenes ?? [],
	sceneImages: over.sceneImages ?? [],
});

/**
 * Runtime fields that both paths must produce identically. Listed by hand, so a newly added field
 * fails this test instead of passing silently. Comparing whole objects with toEqual would not say
 * which field diverged.
 */
const RUNTIME_FIELDS = [
	"scenario",
	"firstScene",
	"playGuide",
	"persona",
	"characters",
	"lore",
	"startScenes",
	"sceneImages",
] as const;

describe("the same normalization as publication", () => {
	it("runtime fields equal the publish request by value", () => {
		const input = source({
			draft: baseDraft({ prompt: "  a body with surrounding whitespace  " }),
			lore: [
				lore("lore-1", {
					positionIndex: 1,
					keys: ["  librarian ", "", "librarian", "cat"],
					content: "  The librarian is a cat.  ",
					constant: false,
					order: 3,
				}),
				lore("lore-2", {
					positionIndex: 0,
					content: "The library opens only at night.",
					constant: true,
				}),
			],
			startScenes: [
				scene("scene-b", {
					position: 1,
					title: " Rooftop ",
					content: " The rooftop. ",
				}),
				scene("scene-a", {
					position: 0,
					title: "",
					content: "  The entrance.  ",
				}),
			],
		});

		const built = buildStoryPublication(input);
		if (!built.ok) throw new Error("this draft should be publishable");
		const snapshot = buildPlaytestSnapshot(input);

		for (const field of RUNTIME_FIELDS)
			expect(snapshot.seed[field]).toEqual(built.publication.play[field]);
	});

	it("deleted children drop out the same way on both sides", () => {
		const input = source({
			lore: [
				lore("lore-1", { content: "alive", constant: true }),
				markAuthoringDeleted(
					lore("lore-2", { content: "deleted", constant: true }),
					NOW,
					REV,
				),
			],
			startScenes: [
				scene("scene-a", { position: 0, content: "alive" }),
				markAuthoringDeleted(
					scene("scene-b", { position: 1, content: "deleted" }),
					NOW,
					REV,
				),
			],
		});

		const built = buildStoryPublication(input);
		if (!built.ok) throw new Error("this draft should be publishable");
		const snapshot = buildPlaytestSnapshot(input);

		expect(snapshot.seed.lore).toEqual(built.publication.play.lore);
		expect(snapshot.seed.startScenes).toEqual(
			built.publication.play.startScenes,
		);
		/** A deleted scene is also absent from the selectable list. */
		expect(snapshot.startScenes.map((item) => item.id)).toEqual(["scene-a"]);
	});

	it("sorting and lore key normalization are the same", () => {
		const input = source({
			lore: [
				lore("lore-z", { positionIndex: 2, content: "three", constant: true }),
				lore("lore-a", {
					positionIndex: 0,
					keys: [" A ", "a", "A"],
					content: "one",
				}),
				lore("lore-m", { positionIndex: 1, content: "two", constant: true }),
			],
			startScenes: [
				scene("scene-3", { position: 2, content: "three" }),
				scene("scene-1", { position: 0, content: "one" }),
				scene("scene-2", { position: 1, content: "two" }),
			],
		});

		const built = buildStoryPublication(input);
		if (!built.ok) throw new Error("this draft should be publishable");
		const snapshot = buildPlaytestSnapshot(input);

		expect(snapshot.seed.lore.map((entry) => entry.content)).toEqual([
			"one",
			"two",
			"three",
		]);
		expect(snapshot.seed.lore).toEqual(built.publication.play.lore);
		/**
		 * Case is not folded; only whitespace and duplicates are cleaned. This is the same rule as
		 * publishing.
		 */
		expect(snapshot.seed.lore[0]?.keys).toEqual(["A", "a"]);

		expect(snapshot.seed.startScenes).toEqual(
			built.publication.play.startScenes,
		);
		/** The selectable list lines up ids in the same order as the normalized scenes. */
		expect(snapshot.startScenes.map((item) => item.id)).toEqual([
			"scene-1",
			"scene-2",
			"scene-3",
		]);
	});

	it("the default opening resolves the same, even when the chosen scene vanished", () => {
		const input = source({
			draft: baseDraft({ defaultStartSceneId: "missing-scene" }),
			startScenes: [
				scene("scene-1", { position: 0, content: "first scene" }),
				scene("scene-2", { position: 1, content: "second scene" }),
			],
		});

		const prepared = prepareStoryPublication(input);
		const snapshot = buildPlaytestSnapshot(input);

		// Both fall back to the first scene. This is a fallback, not a recovery of the selection.
		expect(snapshot.seed.firstScene).toBe(prepared.publication.play.firstScene);
		expect(snapshot.seed.firstScene).toBe("first scene");
		expect(snapshot.startSceneId).toBe("scene-1");
		/** Publish validation still catches that mismatch itself. The test does not soften it. */
		expect(prepared.defaultStartSceneResolved).toBe(false);
	});
});

describe("playback-only opening scene", () => {
	const input = source({
		draft: baseDraft({ defaultStartSceneId: "scene-1" }),
		startScenes: [
			scene("scene-1", {
				position: 0,
				title: "Entrance",
				content: "The entrance.",
			}),
			scene("scene-2", {
				position: 1,
				title: "Rooftop",
				content: "The rooftop.",
			}),
		],
	});

	it("only the opening changes and the other runtime fields stay", () => {
		const base = buildPlaytestSnapshot(input);
		const overridden = buildPlaytestSnapshot(input, {
			startSceneId: "scene-2",
		});

		expect(base.seed.firstScene).toBe("The entrance.");
		expect(overridden.seed.firstScene).toBe("The rooftop.");
		expect(overridden.startSceneId).toBe("scene-2");

		for (const field of RUNTIME_FIELDS) {
			if (field === "firstScene") continue;
			expect(overridden.seed[field]).toEqual(base.seed[field]);
		}
		/** The candidate list itself is unchanged. The chosen scene is not removed from it. */
		expect(overridden.seed.startScenes).toEqual(base.seed.startScenes);
	});

	it("does not change the draft", () => {
		const before = JSON.stringify(input);
		buildPlaytestSnapshot(input, { startSceneId: "scene-2" });
		expect(JSON.stringify(input)).toBe(before);
	});

	it("pointing at a missing scene falls back to the default opening without throwing", () => {
		const snapshot = buildPlaytestSnapshot(input, {
			startSceneId: "deleted-scene",
		});
		expect(snapshot.seed.firstScene).toBe("The entrance.");
		expect(snapshot.startSceneId).toBe("scene-1");
	});
});

/**
 * Playtest opens even when publish readiness is incomplete. That is why normalization is separate
 * from validation. Title, description and tags are catalog requirements. Running the scenario
 * before filling them in is exactly what this feature is for.
 */
describe("before publish readiness", () => {
	it("builds a snapshot from a draft with neither title nor prompt", () => {
		const input = source({
			draft: baseDraft({ title: "", prompt: "" }),
		});

		expect(buildStoryPublication(input).ok).toBe(false);

		const snapshot = buildPlaytestSnapshot(input);
		expect(snapshot.title).toBe("Untitled");
		expect(snapshot.seed.scenario).toBe("");
	});
});

/**
 * Does not invent a work id. storyId is the provenance of a published work and does not exist for a
 * draft. Filling it with a value such as `draft:<id>` would corrupt the contract's meaning, so the
 * snapshot seed omits the field entirely.
 */
describe("identity", () => {
	it("the seed carries no story identity", () => {
		const snapshot = buildPlaytestSnapshot(source());
		expect(Object.keys(snapshot.seed).sort()).toEqual(
			[...RUNTIME_FIELDS].sort(),
		);
		expect(snapshot.draftId).toBe("draft-1");
	});
});

/**
 * Confirms that publish behavior did not change. A refactor that split normalization from
 * validation must not soften validation. A valid draft produces the same request, and a blocked
 * draft still produces none.
 */
describe("normalization separated from validation", () => {
	it("both functions build the same request for a passing draft", () => {
		const input = source({
			lore: [lore("lore-1", { content: "setting", constant: true })],
			startScenes: [scene("scene-1", { position: 0, content: "scene" })],
		});
		const built = buildStoryPublication(input);
		if (!built.ok) throw new Error("this draft should be publishable");
		expect(built.publication).toEqual(
			prepareStoryPublication(input).publication,
		);
	});

	it("a blocked draft still builds no request", () => {
		const input = source({ draft: baseDraft({ title: "  " }) });
		const built = buildStoryPublication(input);
		expect(built.ok).toBe(false);
		expect(built.publication).toBeNull();
		// Normalization still produces a value, and that is the value this test uses.
		expect(prepareStoryPublication(input).publication.metadata.title).toBe("");
	});
});
