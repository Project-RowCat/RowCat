import { describe, expect, it } from "vitest";
import {
	AUTHORING_SCHEMA_VERSION,
	compareDraftsByRecency,
	createDraftLoreEntryRecord,
	createDraftStartSceneRecord,
	createStoryDraftRecord,
	DRAFT_FIELD_GROUPS,
	type DraftFieldGroup,
	draftDisplayTitle,
	draftPatchFieldGroups,
	isLiveRecord,
	markAuthoringDeleted,
	markAuthoringUpdate,
	markDraftFieldUpdate,
	markDraftPublished,
	resolveDefaultStartScene,
	type StoryDraft,
	type StoryDraftPatch,
	sortLore,
	sortStartScenes,
	touchDraftActivity,
} from "./model.ts";

/**
 * Model tests pin the meaning of persisted user data, and breakage here is silent. A changed
 * default only affects new drafts, and a changed sort order makes lists differ per render. If a
 * publish link overwrote the draft id, that draft could no longer be opened.
 */

const rev = (t: number, c = 0, d = "device-a") => ({ t, c, d });

/** Creation revision. The test supplies the value the store would normally take from the clock. */
const CREATED_REV = rev(1_767_225_600_000);

const stamp = (
	id: string,
	now = "2026-01-01T00:00:00.000Z",
	revision = CREATED_REV,
) => ({ id, now, rev: revision });

describe("draft defaults", () => {
	it("a draft made with no input is empty and private", () => {
		const draft = createStoryDraftRecord(undefined, stamp("draft-1"));

		expect(draft).toMatchObject({
			id: "draft-1",
			schemaVersion: AUTHORING_SCHEMA_VERSION,
			title: "",
			tagline: "",
			description: "",
			tags: [],
			orientation: null,
			adult: false,
			/**
			 * If public were the default, an unfinished work could reach the catalog by mistake. Making a
			 * work public cannot be undone, since someone may already have seen it.
			 */
			visibility: "private",
			promptProtected: false,
			prompt: "",
			defaultStartSceneId: null,
			publishedStoryId: null,
			deletedAt: null,
			dirty: 1,
			serverVersion: 0,
			rev: CREATED_REV,
		});
		expect(draft.createdAt).toBe(draft.updatedAt);
		// No per-group history exists yet. All five groups start at the revision where the record was
		// created.
		expect(draft.fieldRev).toEqual({
			meta: CREATED_REV,
			rating: CREATED_REV,
			body: CREATED_REV,
			defaults: CREATED_REV,
			publication: CREATED_REV,
		});
	});

	it("copies arrays received as input", () => {
		/**
		 * Keeping the caller's reference would let later edits to that array change an already stored
		 * record. The stored value and the in-memory value would diverge, one of the hardest bugs to
		 * find.
		 */
		const tags = ["fantasy"];
		const draft = createStoryDraftRecord({ tags }, stamp("draft-1"));

		tags.push("added");

		expect(draft.tags).toEqual(["fantasy"]);
	});

	it("is built even with an empty title", () => {
		/**
		 * This is exactly where legacy lost data. It saved only when a title existed, so text written
		 * body-first with the title added later was lost entirely.
		 */
		const draft = createStoryDraftRecord(
			{ prompt: "a long world" },
			stamp("draft-1"),
		);
		expect(draft.title).toBe("");
		expect(draft.prompt).toBe("a long world");
	});
});

describe("child defaults", () => {
	it("lore holds an order axis and an injection position separately", () => {
		const lore = createDraftLoreEntryRecord(
			{ draftId: "draft-1", positionIndex: 3 },
			stamp("lore-1"),
		);
		expect(lore.positionIndex).toBe(3);
		expect(lore.position).toBe("system_bottom");
		expect(lore.order).toBe(0);
	});

	it("opening scenes have a parent and a position", () => {
		const scene = createDraftStartSceneRecord(
			{ draftId: "draft-1", position: 1, title: "Dawn" },
			stamp("scene-1"),
		);
		expect(scene).toMatchObject({
			draftId: "draft-1",
			position: 1,
			title: "Dawn",
			content: "",
		});
	});
});

describe("edit marks", () => {
	it("a local edit raises time and revision and marks dirty again but leaves the server version alone", () => {
		const draft = {
			...createStoryDraftRecord(undefined, stamp("draft-1")),
			dirty: 0 as const,
			serverVersion: 7,
		};
		const next = rev(1_767_225_600_001);

		const updated = markAuthoringUpdate(
			draft,
			"2026-02-02T00:00:00.000Z",
			next,
		);

		expect(updated.updatedAt).toBe("2026-02-02T00:00:00.000Z");
		expect(updated.dirty).toBe(1);
		expect(updated.rev).toEqual(next);
		expect(updated.serverVersion).toBe(7);
	});

	it("a second deletion does not push the first deletion time into the future", () => {
		const scene = createDraftStartSceneRecord(
			{ draftId: "draft-1", position: 0 },
			stamp("scene-1"),
		);
		const first = markAuthoringDeleted(
			scene,
			"2026-01-02T00:00:00.000Z",
			rev(1_767_225_600_001),
		);
		const second = markAuthoringDeleted(
			first,
			"2026-03-03T00:00:00.000Z",
			rev(1_767_225_600_002),
		);

		expect(second.deletedAt).toBe("2026-01-02T00:00:00.000Z");
		expect(second.updatedAt).toBe("2026-03-03T00:00:00.000Z");
		// Deleting again still advances the revision. That is a new version of this record.
		expect(second.rev).toEqual(rev(1_767_225_600_002));
		expect(isLiveRecord(second)).toBe(false);
	});
});

describe("a draft's group revisions", () => {
	/**
	 * This block is the quietest part of this slice. A group set wrong or missing still looks fine on
	 * screen. Later, when two devices sync, unchanged fields can overwrite the other device's edits,
	 * or a just-edited field can revert to an old value.
	 */
	const draft = () => createStoryDraftRecord(undefined, stamp("draft-1"));
	const NEXT = rev(1_767_225_600_050);
	const at = "2026-02-02T00:00:00.000Z";

	const changed = (before: StoryDraft, after: StoryDraft): DraftFieldGroup[] =>
		DRAFT_FIELD_GROUPS.filter(
			(group) => after.fieldRev[group] !== before.fieldRev[group],
		);

	it("only groups the patch touched rise", () => {
		const base = draft();

		expect(
			changed(base, markDraftFieldUpdate(base, { title: "Title" }, at, NEXT)),
		).toEqual(["meta"]);
		expect(
			changed(base, markDraftFieldUpdate(base, { prompt: "body" }, at, NEXT)),
		).toEqual(["body"]);
		expect(
			changed(base, markDraftFieldUpdate(base, { adult: true }, at, NEXT)),
		).toEqual(["rating"]);
		expect(
			changed(
				base,
				markDraftFieldUpdate(
					base,
					{ defaultStartSceneId: "scene-1" },
					at,
					NEXT,
				),
			),
		).toEqual(["defaults"]);
	});

	it("when one patch touches several groups, the same revision attaches to them", () => {
		const base = draft();
		const next = markDraftFieldUpdate(
			base,
			{ title: "Title", tags: ["tag"], prompt: "body" },
			at,
			NEXT,
		);

		expect(changed(base, next)).toEqual(["meta", "body"]);
		expect(next.fieldRev.meta).toEqual(NEXT);
		expect(next.fieldRev.body).toEqual(NEXT);
		expect(next.rev).toEqual(NEXT);
	});

	it("child activity raises only the record revision and touches no group", () => {
		const base = draft();
		const touched = touchDraftActivity(base, at, NEXT);

		expect(changed(base, touched)).toEqual([]);
		expect(touched.rev).toEqual(NEXT);
		expect(touched.updatedAt).toBe(at);
		expect(touched.dirty).toBe(1);
	});

	it("publishing raises only the publication group", () => {
		const base = draft();
		const published = markDraftPublished(base, "story-9", at, NEXT);

		expect(changed(base, published)).toEqual(["publication"]);
		expect(published.rev).toEqual(NEXT);
	});

	it("the patch field → group table misses no field", () => {
		const everything: Required<StoryDraftPatch> = {
			title: "",
			tagline: "",
			description: "",
			tags: [],
			orientation: null,
			adult: false,
			visibility: "private",
			promptProtected: false,
			prompt: "",
			defaultStartSceneId: null,
		};

		expect(draftPatchFieldGroups(everything)).toEqual([
			"meta",
			"rating",
			"body",
			"defaults",
		]);
		expect(draftPatchFieldGroups({})).toEqual([]);
	});
});

describe("publish link", () => {
	it("the draft id stays separate from the published story id", () => {
		/**
		 * The temptation to merge these two ids recurs, since after publishing the work id looks more
		 * real. Merging would change the draft URL at publish time and leave unpublished drafts with no
		 * identity.
		 */
		const draft = createStoryDraftRecord(undefined, stamp("draft-1"));
		const published = markDraftPublished(
			draft,
			"story-9",
			"2026-02-02T00:00:00.000Z",
			rev(1_767_225_600_003),
		);

		expect(published.id).toBe("draft-1");
		expect(published.publishedStoryId).toBe("story-9");
		expect(published.updatedAt).toBe("2026-02-02T00:00:00.000Z");
	});
});

describe("sorting", () => {
	const scene = (id: string, position: number) =>
		createDraftStartSceneRecord({ draftId: "d", position }, stamp(id));

	it("equal positions split by id into a total order", () => {
		const items = [scene("b", 0), scene("a", 0), scene("c", -1)];
		expect(sortStartScenes(items).map((s) => s.id)).toEqual(["c", "a", "b"]);
	});

	it("sorting does not touch the input array", () => {
		const items = [scene("b", 1), scene("a", 0)];
		sortStartScenes(items);
		expect(items.map((s) => s.id)).toEqual(["b", "a"]);
	});

	it("lore sorts by positionIndex (not by injection position)", () => {
		const lore = [
			createDraftLoreEntryRecord(
				{ draftId: "d", positionIndex: 1, position: "system_top" },
				stamp("late"),
			),
			createDraftLoreEntryRecord(
				{ draftId: "d", positionIndex: 0, position: "before_history" },
				stamp("early"),
			),
		];
		expect(sortLore(lore).map((l) => l.id)).toEqual(["early", "late"]);
	});

	it("the draft list is by most recent edit", () => {
		const older = createStoryDraftRecord(
			undefined,
			stamp("a", "2026-01-01T00:00:00.000Z"),
		);
		const newer = createStoryDraftRecord(
			undefined,
			stamp("b", "2026-02-01T00:00:00.000Z"),
		);
		expect(
			[older, newer].sort(compareDraftsByRecency).map((d) => d.id),
		).toEqual(["b", "a"]);
	});
});

describe("choosing the default opening", () => {
	const scene = (id: string, position: number) =>
		createDraftStartSceneRecord({ draftId: "d", position }, stamp(id));

	it("uses the chosen scene as is", () => {
		const scenes = sortStartScenes([scene("s1", 0), scene("s2", 1)]);
		expect(resolveDefaultStartScene("s2", scenes)?.id).toBe("s2");
	});

	it("falls back to the first scene without a choice", () => {
		const scenes = sortStartScenes([scene("s2", 1), scene("s1", 0)]);
		expect(resolveDefaultStartScene(null, scenes)?.id).toBe("s1");
	});

	it("falls back to the first scene when the chosen scene vanished", () => {
		const scenes = sortStartScenes([scene("s1", 0)]);
		expect(resolveDefaultStartScene("vanished-scene", scenes)?.id).toBe("s1");
	});

	it("null with no scenes", () => {
		expect(resolveDefaultStartScene("s1", [])).toBeNull();
	});
});

describe("display", () => {
	it("an empty title reads as 'Untitled' in the list", () => {
		const draft = createStoryDraftRecord({ title: "   " }, stamp("draft-1"));
		expect(draftDisplayTitle(draft)).toBe("Untitled");
	});
});
