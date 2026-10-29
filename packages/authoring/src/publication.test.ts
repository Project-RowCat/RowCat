import { STORY_PUBLISH_LIMITS } from "@rowcat/contracts/publication";
import { describe, expect, it } from "vitest";
import {
	createDraftLoreEntryRecord,
	createDraftSceneImageRecord,
	createDraftStartSceneRecord,
	createStoryDraftRecord,
	markAuthoringDeleted,
	type StoryDraft,
} from "./model.ts";
import {
	buildStoryPublication,
	prepareStoryPublication,
} from "./publication.ts";
import { PUBLICATION_ISSUE_CODE } from "./validation.ts";

/**
 * Tests for publication assembly. The output is a value that cannot be undone, so the result is
 * pinned exactly. The result is stored on the server, then copied into users' device rooms where it
 * can stay for months. A small mismatch in assembly would carry through every story already
 * published.
 */

const NOW = "2026-01-01T00:00:00.000Z";
/**
 * The assembler does not read revisions. This value only fills the slot needed to build a record.
 */
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };
const stamp = (id: string) => ({ id, now: NOW, rev: REV });

/** Minimal draft that passes validation. A title and a prompt are enough. */
function baseDraft(overrides: Partial<StoryDraft> = {}): StoryDraft {
	return {
		...createStoryDraftRecord(
			{ title: "The Night Library", prompt: "A library where books talk." },
			stamp("draft-1"),
		),
		...overrides,
	};
}

const build = (source: {
	draft?: StoryDraft;
	lore?: ReturnType<typeof createDraftLoreEntryRecord>[];
	startScenes?: ReturnType<typeof createDraftStartSceneRecord>[];
	sceneImages?: ReturnType<typeof createDraftSceneImageRecord>[];
}) =>
	buildStoryPublication({
		draft: source.draft ?? baseDraft(),
		lore: source.lore ?? [],
		startScenes: source.startScenes ?? [],
		sceneImages: source.sceneImages ?? [],
	});

describe("draft identity", () => {
	it("the publish request carries the draft id as provenance and mints no story id", () => {
		const result = build({});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.publication.originDraftId).toBe("draft-1");
		/**
		 * The server creates the story id. If the client made one up, the id in the play payload could
		 * differ from the id on the real row. Once they differ, nothing can say which is true.
		 */
		expect(result.publication).not.toHaveProperty("storyId");
		expect(result.publication.play).not.toHaveProperty("storyId");
		expect(result.publication.play).not.toHaveProperty("version");
		// Rating and protection status also live only in metadata. The server decides them and injects
		// them into the snapshot.
		expect(result.publication.play).not.toHaveProperty("adult");
		expect(result.publication.play).not.toHaveProperty("promptProtected");
	});

	it("an already published draft sends the same provenance id", () => {
		/**
		 * This is the basis for idempotency. The server uses this value to check which story an update
		 * request belongs to.
		 */
		const result = build({
			draft: baseDraft({ publishedStoryId: "story-9" }),
		});
		expect(result.ok && result.publication.originDraftId).toBe("draft-1");
	});
});

describe("story body", () => {
	const lore = createDraftLoreEntryRecord(
		{
			draftId: "draft-1",
			positionIndex: 0,
			keys: ["library"],
			content: "setting",
		},
		stamp("lore-1"),
	);
	const scene = createDraftStartSceneRecord(
		{
			draftId: "draft-1",
			position: 0,
			title: "Dawn",
			content: "The door opens.",
		},
		stamp("scene-1"),
	);

	it("the single prompt goes to the world slot", () => {
		const result = build({
			draft: baseDraft({
				prompt: "You are the night library's librarian. Greet the visitor.",
			}),
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.publication.play.scenario).toBe(
			"You are the night library's librarian. Greet the visitor.",
		);
	});

	it("play guide, counterpart and characters **always** go out empty", () => {
		/**
		 * The three fields stay in the contract, because published stories' play snapshots have that
		 * shape. The authoring tool no longer creates them. Pinning this here stops someone from
		 * refilling them later just because the contract has room.
		 */
		const result = build({ draft: baseDraft({ prompt: "body" }) });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.publication.play.playGuide).toBe("");
		expect(result.publication.play.persona).toBeNull();
		expect(result.publication.play.characters).toEqual([]);
	});

	it("lore and opening scenes ride as is without folding", () => {
		const result = build({ lore: [lore], startScenes: [scene] });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.publication.play.lore).toHaveLength(1);
		expect(result.publication.play.startScenes).toHaveLength(1);
		expect(result.publication.play.firstScene).toBe("The door opens.");
	});

	it("an empty prompt is blocked in that screen's words", () => {
		/**
		 * The check runs against the wire name (`play.scenario`), but the editor has no field with that
		 * name. If the message pointed at a place not on screen, the user could not fix it.
		 */
		const result = build({ draft: baseDraft({ prompt: "   " }) });
		expect(result.ok).toBe(false);
		if (result.ok) return;

		const issue = result.issues.find((i) => i.field === "scenario");
		expect(issue?.code).toBe(PUBLICATION_ISSUE_CODE.required);
		expect(issue?.message).toBe("Please enter a prompt.");
	});
});

describe("deletion and order", () => {
	const scene = (id: string, position: number) =>
		createDraftStartSceneRecord(
			{ draftId: "draft-1", position, title: id, content: "content" },
			stamp(id),
		);

	it("deleted children do not ride in the publication", () => {
		const result = build({
			startScenes: [
				scene("alive", 0),
				markAuthoringDeleted(scene("deleted", 1), NOW, REV),
			],
		});
		expect(
			result.ok && result.publication.play.startScenes.map((s) => s.title),
		).toEqual(["alive"]);
	});

	it("opening scenes ride in position order", () => {
		const result = build({
			startScenes: [scene("second", 1), scene("first", 0)],
		});
		expect(
			result.ok && result.publication.play.startScenes.map((s) => s.title),
		).toEqual(["first", "second"]);
	});

	it("lore rides in list order (positionIndex) and keeps its injection position", () => {
		const lore = (id: string, positionIndex: number, content: string) =>
			createDraftLoreEntryRecord(
				{
					draftId: "draft-1",
					positionIndex,
					content,
					keys: [id],
					position: "system_top",
					order: 5,
				},
				stamp(id),
			);
		const result = build({
			lore: [lore("b", 1, "later"), lore("a", 0, "earlier")],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.publication.play.lore.map((l) => l.content)).toEqual([
			"earlier",
			"later",
		]);
		expect(result.publication.play.lore[0]).toMatchObject({
			position: "system_top",
			order: 5,
		});
	});
});

describe("normalization", () => {
	it("tags are trimmed and deduplicated while keeping their written order", () => {
		const result = build({
			draft: baseDraft({ tags: [" fantasy ", "romance", "fantasy", "  "] }),
		});
		expect(result.ok && result.publication.metadata.tags).toEqual([
			"fantasy",
			"romance",
		]);
	});

	it("a draft stored as archived rides folded to private", () => {
		/**
		 * Imported data or another device can carry `archived`. Sending it as-is gets a 403 from the
		 * server, but the screen already shows `Publish as private`, so every press would get the same rejection.
		 */
		const archived = build({ draft: baseDraft({ visibility: "archived" }) });
		expect(archived.ok && archived.publication.metadata.visibility).toBe(
			"private",
		);
		for (const visibility of ["public", "unlisted", "private"] as const) {
			const result = build({ draft: baseDraft({ visibility }) });
			expect(result.ok && result.publication.metadata.visibility).toBe(
				visibility,
			);
		}
	});

	it("lore keywords follow the same rule but keep their case", () => {
		/**
		 * Trigger matching already ignores case. Folding case here would only change what the screen
		 * shows.
		 */
		const entry = createDraftLoreEntryRecord(
			{
				draftId: "draft-1",
				positionIndex: 0,
				content: "content",
				keys: [" Library ", "library", "Library", ""],
			},
			stamp("lore-1"),
		);
		const result = build({ lore: [entry] });
		expect(result.ok && result.publication.play.lore[0]?.keys).toEqual([
			"Library",
			"library",
		]);
	});

	it("always-on lore passes without keywords", () => {
		const entry = createDraftLoreEntryRecord(
			{
				draftId: "draft-1",
				positionIndex: 0,
				content: "content",
				constant: true,
			},
			stamp("lore-1"),
		);
		expect(build({ lore: [entry] }).ok).toBe(true);
	});

	it("lore with neither keywords nor always-on is blocked", () => {
		const entry = createDraftLoreEntryRecord(
			{ draftId: "draft-1", positionIndex: 0, content: "content" },
			stamp("lore-1"),
		);
		const result = build({ lore: [entry] });
		expect(result.ok).toBe(false);
		expect(result.issues.map((i) => i.code)).toContain(
			PUBLICATION_ISSUE_CODE.loreNeverTriggers,
		);
	});
});

describe("choosing the opening", () => {
	const scene = (id: string, position: number, content: string) =>
		createDraftStartSceneRecord(
			{ draftId: "draft-1", position, title: id, content },
			stamp(id),
		);

	it("the chosen scene's body becomes the opening", () => {
		const result = build({
			draft: baseDraft({ defaultStartSceneId: "s2" }),
			startScenes: [
				scene("s1", 0, "first scene"),
				scene("s2", 1, "second scene"),
			],
		});
		expect(result.ok && result.publication.play.firstScene).toBe(
			"second scene",
		);
	});

	it("without a choice the first scene becomes the opening", () => {
		const result = build({
			startScenes: [
				scene("s2", 1, "second scene"),
				scene("s1", 0, "first scene"),
			],
		});
		expect(result.ok && result.publication.play.firstScene).toBe("first scene");
	});

	it("with no scenes the opening is an empty string", () => {
		const result = build({});
		expect(result.ok && result.publication.play.firstScene).toBe("");
	});

	it("recovers when the chosen scene vanished, and reports the fact", () => {
		/**
		 * Silently falling back to the first scene would leave the same mismatch in the next edit. This
		 * signal lets the editor rewrite the selection.
		 */
		const result = build({
			draft: baseDraft({ defaultStartSceneId: "vanished-scene" }),
			startScenes: [scene("s1", 0, "first scene")],
		});
		expect(result.ok).toBe(false);
		expect(result.issues.map((i) => i.code)).toContain(
			PUBLICATION_ISSUE_CODE.unresolvedDefaultStartScene,
		);
	});

	it("the opening equals the same scene's body in the list exactly", () => {
		/**
		 * When a scene picker is added later, it must be able to tell which entry is the current opening.
		 */
		const result = build({
			startScenes: [scene("s1", 0, "  first scene  ")],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.publication.play.firstScene).toBe(
			result.publication.play.startScenes[0]?.content,
		);
	});
});

describe("validation", () => {
	it("blocks an empty title", () => {
		const result = build({ draft: baseDraft({ title: "   " }) });
		expect(result.ok).toBe(false);
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				field: "title",
				code: PUBLICATION_ISSUE_CODE.required,
			}),
		);
	});

	it("blocks an empty prompt", () => {
		const result = build({ draft: baseDraft({ prompt: "" }) });
		expect(result.ok).toBe(false);
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				field: "scenario",
				code: PUBLICATION_ISSUE_CODE.required,
			}),
		);
	});

	it("builds no request at all when blocked", () => {
		/**
		 * If a partial assembly came back alongside the error, callers would build a 'send it anyway'
		 * path.
		 */
		const result = build({ draft: baseDraft({ title: "" }) });
		expect(result.publication).toBeNull();
	});

	it("blocks values over the cap by the contract's own standard", () => {
		const result = build({
			draft: baseDraft({ title: "x".repeat(STORY_PUBLISH_LIMITS.title + 1) }),
		});
		expect(result.ok).toBe(false);
		expect(result.issues.map((i) => i.code)).toContain(
			PUBLICATION_ISSUE_CODE.tooLong,
		);
	});

	it("publishes with empty description, tags and opening", () => {
		/**
		 * Adding required fields would block the common habit of publishing first and polishing later.
		 */
		expect(build({}).ok).toBe(true);
	});
});

describe("scene images", () => {
	const sceneImage = (
		id: string,
		input: Partial<Parameters<typeof createDraftSceneImageRecord>[0]> = {},
	) =>
		createDraftSceneImageRecord(
			{ draftId: "draft-1", position: 0, ...input },
			stamp(id),
		);

	it("the draft's scene images ride in the publish payload", () => {
		const result = build({
			sceneImages: [
				sceneImage("img-1", { trigger: "night", assetId: "media-1" }),
			],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.publication.play.sceneImages).toEqual([
			{ trigger: "night", assetId: "media-1" },
		]);
	});

	it("an empty array without scene images: old drafts still publish", () => {
		const result = build({});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.publication.play.sceneImages).toEqual([]);
	});

	it("rides in position order", () => {
		const result = build({
			sceneImages: [
				sceneImage("img-2", {
					position: 1,
					trigger: "dawn",
					assetId: "media-2",
				}),
				sceneImage("img-1", {
					position: 0,
					trigger: "night",
					assetId: "media-1",
				}),
			],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.publication.play.sceneImages.map((i) => i.trigger)).toEqual([
			"night",
			"dawn",
		]);
	});

	it("trims the trigger's whitespace: publication and matching must see the same value", () => {
		const result = build({
			sceneImages: [
				sceneImage("img-1", { trigger: "  night  ", assetId: " media-1 " }),
			],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.publication.play.sceneImages).toEqual([
			{ trigger: "night", assetId: "media-1" },
		]);
	});

	it("deleted entries do not ride", () => {
		const removed = markAuthoringDeleted(
			sceneImage("img-1", { trigger: "night", assetId: "media-1" }),
			"2026-01-02T00:00:00.000Z",
			{ t: 2, c: 0, d: "device" },
		);
		const result = build({ sceneImages: [removed] });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.publication.play.sceneImages).toEqual([]);
	});

	it("entries without a trigger or picture drop out, and the fact comes out as an issue", () => {
		const result = build({
			sceneImages: [
				sceneImage("img-1", { trigger: "night", assetId: "" }),
				sceneImage("img-2", { position: 1, trigger: "", assetId: "media-2" }),
			],
		});
		expect(result.ok).toBe(false);
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				field: "sceneImages",
				code: PUBLICATION_ISSUE_CODE.incompleteSceneImage,
			}),
		);
	});

	it("duplicate triggers keep only the first, and the fact comes out as an issue", () => {
		const result = build({
			sceneImages: [
				sceneImage("img-1", { trigger: "night", assetId: "media-1" }),
				sceneImage("img-2", {
					position: 1,
					trigger: "NIGHT",
					assetId: "media-2",
				}),
			],
		});
		expect(result.ok).toBe(false);
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				field: "sceneImages",
				code: PUBLICATION_ISSUE_CODE.duplicateSceneTrigger,
			}),
		);
		/** Even when validation fails, the normalized result must behave the same as at play time. */
		expect(
			prepareStoryPublication({
				draft: baseDraft(),
				lore: [],
				startScenes: [],
				sceneImages: [
					sceneImage("img-1", { trigger: "night", assetId: "media-1" }),
					sceneImage("img-2", {
						position: 1,
						trigger: "NIGHT",
						assetId: "media-2",
					}),
				],
			}).publication.play.sceneImages,
		).toEqual([{ trigger: "night", assetId: "media-1" }]);
	});
});
