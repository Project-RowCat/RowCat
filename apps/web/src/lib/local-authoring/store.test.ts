import type { AuthoringStore, StoryDraft } from "@rowcat/authoring";
import {
	buildStoryPublication,
	DRAFT_FIELD_GROUPS,
	defaultRuntimeStarter,
	instantiateRuntimeTemplate,
	runtimeTemplateById,
} from "@rowcat/authoring";
import type { ChatSeed } from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { compareRev } from "@rowcat/sync";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createChatStore } from "#/lib/local-chat/store.ts";
import {
	activateLocalDbScope,
	activeLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createAuthoringStore } from "./store.ts";

/**
 * Tests for the authoring store, which handles the user's persistent data. Types alone are not
 * enough here. Failures in this layer are silent: broken account isolation still looks normal
 * (another user's drafts just appear in the list), lost autosave shows up only after reopening, and
 * a schema upgrade that drops existing chats is found only after release. These must be checked
 * against a real IndexedDB (fake-indexeddb), by opening and closing the database.
 */

/**
 * Each test uses a different member code. Reusing a code leaves drafts from an earlier test in the
 * next test's database. That is normal behavior (logging out does not erase data), not an isolation
 * failure, so tests must use distinct names.
 *
 * For the same reason there is no helper that clears the database: deleting a user's manuscript
 * must never be product code.
 */
let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;

/**
 * Opens the member scope and returns its authoring store, in the same order the app uses right
 * after sign-in.
 */
const open = (viewerId: string): AuthoringStore =>
	createAuthoringStore(activateLocalDbScope(viewerId));

afterEach(() => {
	resetLocalDbScope();
});

describe("persistence", () => {
	it("a draft saves even with an empty title", async () => {
		/**
		 * This is where the legacy app lost data. Saving required a title, so work written body-first,
		 * with the title added later, was lost entirely.
		 */
		const alice = nextViewer("alice");
		const store = open(alice);
		const draft = await store.createDraft();
		const prompt = "A".repeat(3000);
		await store.updateDraft(draft.id, { prompt });

		// Equivalent to closing the tab and reopening it.
		resetLocalDbScope();
		const reopened = open(alice);

		const found = await reopened.getDraft(draft.id);
		expect(found?.title).toBe("");
		expect(found?.prompt).toBe(prompt);
	});

	it("child records keep their order after closing and reopening", async () => {
		const alice = nextViewer("alice");
		const store = open(alice);
		const draft = await store.createDraft({ title: "Draft" });
		await store.createLore(draft.id, { content: "One", keys: ["key"] });
		await store.createLore(draft.id, { content: "Two", keys: ["key"] });
		const scene1 = await store.createStartScene(draft.id, { title: "Dawn" });
		const scene2 = await store.createStartScene(draft.id, { title: "Noon" });
		await store.setDefaultStartScene(draft.id, scene2.id);

		resetLocalDbScope();
		const reopened = open(alice);

		expect((await reopened.listLore(draft.id)).map((l) => l.content)).toEqual([
			"One",
			"Two",
		]);
		expect((await reopened.listStartScenes(draft.id)).map((s) => s.id)).toEqual(
			[scene1.id, scene2.id],
		);
		expect((await reopened.getDraft(draft.id))?.defaultStartSceneId).toBe(
			scene2.id,
		);
	});

	it("signing out does not erase drafts", async () => {
		/**
		 * Logout is the easiest place to get this wrong. Deleting the database under the name of cleanup
		 * would make the user's manuscript vanish when they log back in.
		 */
		const alice = nextViewer("alice");
		const store = open(alice);
		const draft = await store.createDraft({ title: "Manuscript" });

		resetLocalDbScope();
		expect(activeLocalDbScope()).toBeNull();

		const reopened = open(alice);
		expect(await reopened.getDraft(draft.id)).toMatchObject({ id: draft.id });
	});
});

describe("account isolation", () => {
	it("Alice's drafts are hidden from Bob and are still there when she returns", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		const aliceStore = open(alice);
		const draft = await aliceStore.createDraft({ title: "Alice's manuscript" });

		resetLocalDbScope();
		const bobStore = open(bob);
		expect(await bobStore.listDrafts()).toEqual([]);
		expect(await bobStore.getDraft(draft.id)).toBeNull();

		// Bob logs out and Alice logs back in. The bytes were never erased.
		resetLocalDbScope();
		const aliceAgain = open(alice);
		expect((await aliceAgain.listDrafts()).map((d) => d.id)).toEqual([
			draft.id,
		]);
	});
});

describe("soft delete", () => {
	it("a deleted draft leaves lists and reads and hides its children", async () => {
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft to delete" });
		await store.createLore(draft.id, { content: "Setting" });
		await store.createStartScene(draft.id, { title: "Scene" });

		await store.deleteDraft(draft.id);

		expect(await store.listDrafts()).toEqual([]);
		expect(await store.getDraft(draft.id)).toBeNull();
		expect(await store.listLore(draft.id)).toEqual([]);
		expect(await store.listStartScenes(draft.id)).toEqual([]);
		expect(await store.loadPublicationSource(draft.id)).toBeNull();
	});

	it("a deleted child leaves the list and the rest keep their order", async () => {
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });
		const first = await store.createLore(draft.id, { content: "One" });
		await store.createLore(draft.id, { content: "Two" });
		await store.createLore(draft.id, { content: "Three" });

		await store.deleteLore(first.id);

		expect((await store.listLore(draft.id)).map((l) => l.content)).toEqual([
			"Two",
			"Three",
		]);
	});

	it("a deleted draft does not revive; a late autosave cannot pass", async () => {
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });
		await store.deleteDraft(draft.id);

		expect(
			await store.updateDraft(draft.id, { prompt: "Late save" }),
		).toBeNull();
		expect(await store.getDraft(draft.id)).toBeNull();
	});
});

describe("order and default opening", () => {
	it("reordering renumbers in the given order", async () => {
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });
		const a = await store.createLore(draft.id, { content: "A" });
		const b = await store.createLore(draft.id, { content: "B" });
		const c = await store.createLore(draft.id, { content: "C" });

		await store.reorderLore(draft.id, [c.id, a.id, b.id]);

		expect((await store.listLore(draft.id)).map((x) => x.content)).toEqual([
			"C",
			"A",
			"B",
		]);
	});

	it("items missing from the reorder list stay at the end", async () => {
		/**
		 * The list on screen may differ from the store (for example, a draft was added in another tab).
		 */
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });
		const a = await store.createLore(draft.id, { content: "A" });
		const b = await store.createLore(draft.id, { content: "B" });
		const c = await store.createLore(draft.id, { content: "C" });

		await store.reorderLore(draft.id, [b.id, a.id]);

		const contents = (await store.listLore(draft.id)).map((x) => x.content);
		expect(contents).toEqual(["B", "A", "C"]);
		expect(contents).toContain(c.content);
	});

	it("the first start scene becomes the default opening right away", async () => {
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });
		const scene = await store.createStartScene(draft.id, { title: "Dawn" });

		expect((await store.getDraft(draft.id))?.defaultStartSceneId).toBe(
			scene.id,
		);
	});

	it("deleting the default opening moves the choice to the first remaining scene", async () => {
		/**
		 * If the selection is left as is, it points at a scene the draft no longer has, and publishing
		 * that state silently changes the opening to a different scene. Moving the selection in the same
		 * transaction removes that window entirely.
		 */
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });
		const first = await store.createStartScene(draft.id, { title: "Dawn" });
		const second = await store.createStartScene(draft.id, { title: "Noon" });

		await store.deleteStartScene(first.id);

		expect((await store.getDraft(draft.id))?.defaultStartSceneId).toBe(
			second.id,
		);
	});

	it("deleting the last scene clears the choice", async () => {
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });
		const only = await store.createStartScene(draft.id, { title: "Dawn" });

		await store.deleteStartScene(only.id);

		expect((await store.getDraft(draft.id))?.defaultStartSceneId).toBeNull();
	});

	it("another draft's scene cannot be the default opening", async () => {
		const store = open(nextViewer("alice"));
		const mine = await store.createDraft({ title: "My draft" });
		const other = await store.createDraft({ title: "Other draft" });
		const otherScene = await store.createStartScene(other.id, {
			title: "Scene",
		});

		await store.setDefaultStartScene(mine.id, otherScene.id);

		expect((await store.getDraft(mine.id))?.defaultStartSceneId).toBeNull();
	});

	it("editing a child raises the draft's edit time too", async () => {
		/**
		 * The draft list sorts by updatedAt, so editing only children would leave the just-edited draft
		 * lower in the list.
		 */
		const store = open(nextViewer("alice"));
		const older = await store.createDraft({ title: "Earlier" });
		const newer = await store.createDraft({ title: "Later" });
		await store.createLore(older.id, { content: "Setting" });

		expect((await store.listDrafts()).map((d) => d.id)).toEqual([
			older.id,
			newer.id,
		]);
	});
});

describe("publication assembly input", () => {
	it("one read returns the draft and its children together", async () => {
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({
			title: "The Night Library",
			prompt: "A library where books talk to you.",
		});
		await store.createLore(draft.id, {
			keys: ["Librarian"],
			content: "An old librarian",
		});
		const scene = await store.createStartScene(draft.id, {
			title: "Dawn",
			content: "The door opens.",
		});

		const source = await store.loadPublicationSource(draft.id);
		expect(source).not.toBeNull();
		if (!source) return;

		const result = buildStoryPublication(source);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.publication.originDraftId).toBe(draft.id);
		expect(result.publication.play.firstScene).toBe("The door opens.");
		expect(result.publication.play.startScenes).toHaveLength(1);
		expect(result.publication.play.lore).toHaveLength(1);
		expect(scene.id).not.toBe(draft.id);
	});

	it("recording the publication keeps the draft id", async () => {
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });

		const marked = await store.markPublished(draft.id, "story-9");

		expect(marked?.id).toBe(draft.id);
		expect(marked?.publishedStoryId).toBe("story-9");
		expect((await store.getDraft(draft.id))?.publishedStoryId).toBe("story-9");
	});

	it("after publishing the draft stays editable", async () => {
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });
		await store.markPublished(draft.id, "story-9");

		await store.updateDraft(draft.id, { prompt: "Edited after publishing" });

		const after = await store.getDraft(draft.id);
		expect(after?.prompt).toBe("Edited after publishing");
		expect(after?.publishedStoryId).toBe("story-9");
	});

	/**
	 * Deleting a draft deletes only the draft.
	 *
	 * This repository has no server client, so there is no path here that sends a work-deletion
	 * request. That does not keep the rule intact, though. If someone adds a RowCatClient to this
	 * layer, the shortest code becomes 'the draft was deleted, so clean up the published work too.'
	 * This test is meant to stop that change at this point.
	 *
	 * `Published` was added recently and makes this more important: after deleting a draft, the user sees
	 * their work still in the adjacent column, and the screen says so, so that is correct.
	 */
	it("deleting a published draft keeps the story link on the tombstone", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createAuthoringStore(db);
		const draft = await store.createDraft({ title: "Draft" });
		await store.markPublished(draft.id, "story-9");

		await store.deleteDraft(draft.id);

		// Hidden from lookups and lists because the delete is soft (the row remains).
		expect(await store.getDraft(draft.id)).toBeNull();
		expect(await store.listDrafts()).toEqual([]);

		/**
		 * The tombstone keeps the publish link. Clearing it would leave no record of which work the draft
		 * produced, and when sync carries the tombstone to another device, that device's publish link
		 * would be reset to null. The link must only move forward (monotonic). See
		 * packages/authoring/src/sync-codec.ts.
		 */
		const tombstoned = await db.storyDrafts.get(draft.id);
		expect(tombstoned?.publishedStoryId).toBe("story-9");
		expect(tombstoned?.deletedAt).not.toBeNull();
	});
});

describe("revisions", () => {
	/**
	 * Errors here are silent. A wrong group, or siblings sharing one revision, leaves the screen
	 * looking fine, and months later, when two devices meet, a whole manuscript can be lost.
	 */
	const groupsChanged = (before: StoryDraft, after: StoryDraft) =>
		DRAFT_FIELD_GROUPS.filter(
			(group) =>
				compareRev(after.fieldRev[group], before.fieldRev[group]) !== 0,
		);

	it("a draft edit raises only the groups its patch touched", async () => {
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });

		const updated = await store.updateDraft(draft.id, { prompt: "Body" });

		if (!updated) throw new Error("the draft is gone");
		expect(groupsChanged(draft, updated)).toEqual(["body"]);
		expect(compareRev(updated.rev, draft.rev)).toBeGreaterThan(0);
		expect(updated.dirty).toBe(1);
	});

	it("editing a child raises only the draft's revision, not its groups", async () => {
		/**
		 * This is why `rev` and `fieldRev` are separate. A child edit is draft activity, not a change to
		 * authored fields. Bumping the group revisions here would make the next merge overwrite other
		 * devices' edits in fields that did not change.
		 */
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });
		const entry = await store.createLore(draft.id, { content: "Setting" });

		const afterCreate = await store.getDraft(draft.id);
		if (!afterCreate) throw new Error("the draft is gone");
		expect(groupsChanged(draft, afterCreate)).toEqual([]);
		expect(compareRev(afterCreate.rev, draft.rev)).toBeGreaterThan(0);
		// A child and its parent never share a revision.
		expect(compareRev(afterCreate.rev, entry.rev)).toBeGreaterThan(0);

		await store.updateLore(entry.id, { content: "Edited setting" });
		const afterUpdate = await store.getDraft(draft.id);
		if (!afterUpdate) throw new Error("the draft is gone");
		expect(groupsChanged(afterCreate, afterUpdate)).toEqual([]);
		expect(compareRev(afterUpdate.rev, afterCreate.rev)).toBeGreaterThan(0);
	});

	it("the first scene becoming the default opening is a defaults-group edit", async () => {
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });

		await store.createStartScene(draft.id, { title: "Dawn" });

		const after = await store.getDraft(draft.id);
		if (!after) throw new Error("the draft is gone");
		expect(groupsChanged(draft, after)).toEqual(["defaults"]);
	});

	it("publishing raises only the publication group", async () => {
		const store = open(nextViewer("alice"));
		const draft = await store.createDraft({ title: "Draft" });

		const published = await store.markPublished(draft.id, "story-9");

		if (!published) throw new Error("the draft is gone");
		expect(groupsChanged(draft, published)).toEqual(["publication"]);
		expect(published.dirty).toBe(1);
	});

	it("reordering gives each sibling a different revision in result order", async () => {
		/**
		 * Siblings are separate records that sync independently, so they cannot share a revision. If the
		 * issue order followed the order the store returns rows, the same drag would produce a different
		 * arrangement on each run, and two devices doing the same reorder would pick different winners.
		 */
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createAuthoringStore(db);
		const draft = await store.createDraft({ title: "Draft" });
		const a = await store.createLore(draft.id, { content: "A" });
		const b = await store.createLore(draft.id, { content: "B" });
		const c = await store.createLore(draft.id, { content: "C" });

		await store.reorderLore(draft.id, [c.id, a.id, b.id]);

		const ordered = await store.listLore(draft.id);
		const revs = ordered.map((row) => row.rev);
		expect(ordered.map((row) => row.content)).toEqual(["C", "A", "B"]);
		expect(new Set(revs.map((rev) => `${rev.t}:${rev.c}`)).size).toBe(3);
		expect(compareRev(revs[1], revs[0])).toBeGreaterThan(0);
		expect(compareRev(revs[2], revs[1])).toBeGreaterThan(0);
		expect(ordered.every((row) => row.dirty === 1)).toBe(true);
		// The parent is issued after all siblings (it is touched last).
		const parent = await store.getDraft(draft.id);
		expect(compareRev(parent?.rev ?? revs[2], revs[2])).toBeGreaterThan(0);
	});

	it("deleting a draft gives each child a tombstone and revision", async () => {
		/**
		 * Unlike chat, the decision here is to tombstone each child separately. Draft children number in
		 * the dozens, so per-child tombstones add no wire cost. A receiving device that has not yet seen
		 * the parent's tombstone still deletes the children on its own.
		 */
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createAuthoringStore(db);
		const draft = await store.createDraft({ title: "Draft" });
		const entry = await store.createLore(draft.id, { content: "Setting" });

		await store.deleteDraft(draft.id);

		const stored = await db.draftLoreEntries.get(entry.id);
		expect(stored?.deletedAt).not.toBeNull();
		expect(stored?.dirty).toBe(1);
		expect(compareRev(stored?.rev ?? entry.rev, entry.rev)).toBeGreaterThan(0);
	});
});

/** Legacy chat database as of v1, when it held only rooms and messages. */
class LegacyChatDb extends Dexie {
	constructor(name: string) {
		super(name);
		this.version(1).stores({
			rooms: "id, updatedAt, originStoryId",
			messages: "id, roomId, [roomId+createdAt+id]",
		});
	}
}

const seed = (): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
	});

describe("v1 → v3 upgrade", () => {
	it("rooms and messages stored under v1 still read in the latest version", async () => {
		/**
		 * This test matters most in this change. If the physical database name changes, or the v1
		 * declaration is removed while the authoring store is added, chats already on users' devices
		 * disappear. That would only surface after release, through user reports.
		 *
		 * So this test writes directly into a database that mimics the v1 schema, then opens the same
		 * name with product code. If the naming rule (`rowcat_chat_<viewerId>`) changes, this test breaks
		 * immediately.
		 */
		const alice = nextViewer("upgrade");
		const dbName = `rowcat_chat_${alice}`;

		const legacy = new LegacyChatDb(dbName);
		await legacy.open();
		expect(legacy.verno).toBe(1);
		await legacy.table("rooms").add({
			id: "room-1",
			originStoryId: "story-1",
			title: "Old conversation",
			adult: false,
			promptProtected: false,
			seed: seed(),
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			dirty: true,
			serverVersion: 0,
		});
		await legacy.table("messages").add({
			id: "msg-1",
			roomId: "room-1",
			role: "user",
			speaker: "",
			content: "Something said before",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			dirty: true,
			serverVersion: 0,
		});
		legacy.close();

		const db = activateLocalDbScope(alice);
		const chat = createChatStore(db);
		await db.open();
		/**
		 * Dexie upgrades from v1 to the latest version in one pass by following the version chain.
		 * Removing any intermediate declaration (v1, v2, or v3) breaks the chain, and chats already on
		 * users' devices are lost at that moment.
		 */
		expect(db.verno).toBe(24);

		const room = await chat.getRoom("room-1");
		expect(room).toMatchObject({ id: "room-1", title: "Old conversation" });
		const messages = await chat.listRecentMessages("room-1");
		expect(messages.map((m) => m.content)).toEqual(["Something said before"]);
		// Axes missing in v1 were backfilled. Detailed checks live in local-data/migration.test.ts.
		expect(room?.deletedAt).toBeNull();
		expect(room?.dirty).toBe(1);
		expect(room?.rev.t).toBeGreaterThan(0);
	});

	it("chat and authoring both work on the upgraded database", async () => {
		/**
		 * This slice assumes both domains share one connection, because future sync will require a single
		 * transaction across them. If one side blocks the other's upgrade, or the open fails because a
		 * store is missing, this test reveals it.
		 */
		const alice = nextViewer("upgrade");
		const dbName = `rowcat_chat_${alice}`;

		const legacy = new LegacyChatDb(dbName);
		await legacy.open();
		await legacy.table("rooms").add({
			id: "room-1",
			originStoryId: null,
			title: "Old conversation",
			adult: false,
			promptProtected: false,
			seed: seed(),
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			dirty: true,
			serverVersion: 0,
		});
		legacy.close();

		const db = activateLocalDbScope(alice);
		const chat = createChatStore(db);
		const authoring = createAuthoringStore(db);

		const draft = await authoring.createDraft({ title: "New draft" });
		await chat.appendMessage({
			roomId: "room-1",
			role: "user",
			content: "Written after the upgrade",
		});

		expect((await authoring.listDrafts()).map((d) => d.id)).toEqual([draft.id]);
		expect(await chat.listRecentMessages("room-1")).toHaveLength(1);
		expect(await chat.getRoom("room-1")).not.toBeNull();
	});
});

/**
 * Runtime project: turning it on and deleting it must stay separate.
 *
 * Three guarantees here break silently. If enabling runs without creating the files, the studio
 * cannot repair itself. If turning it off and on again overwrites the starter files, the user's
 * code is lost. If turning it off becomes a delete, there is no way to undo it.
 */
describe("runtime", () => {
	it("turning it on creates the project and starter file together", async () => {
		const store = open(nextViewer("runtime"));
		const draft = await store.createDraft();

		expect(await store.getRuntimeProject(draft.id)).toBeNull();

		const project = await store.enableRuntime(draft.id);
		expect(project).toMatchObject({ draftId: draft.id, enabled: true });

		const files = await store.listRuntimeFiles(draft.id);
		expect(files.map((file) => file.path)).toEqual(["src/main.tsx"]);
		expect(files[0].content).toContain("@rowcat/runtime");
	});

	it("code stays after closing and reopening the tab", async () => {
		const viewer = nextViewer("runtime");
		const store = open(viewer);
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		const [entry] = await store.listRuntimeFiles(draft.id);
		await store.updateRuntimeFile(entry.id, { content: "export const x = 1;" });

		resetLocalDbScope();
		const reopened = open(viewer);

		const files = await reopened.listRuntimeFiles(draft.id);
		expect(files[0].content).toBe("export const x = 1;");
		expect(await reopened.getRuntimeProject(draft.id)).toMatchObject({
			enabled: true,
		});
	});

	it("a template's files are all created in one transaction", async () => {
		/**
		 * A half-committed template is a project that does not compile, and the user did not choose that
		 * state (§27). What this test verifies is the result of atomicity: the file count and entry point
		 * match the registry exactly.
		 */
		const template = runtimeTemplateById("visual-novel");
		if (template === null) throw new Error("no template");
		const plan = instantiateRuntimeTemplate(template);

		const store = open(nextViewer("runtime"));
		const draft = await store.createDraft();
		const project = await store.enableRuntime(draft.id, plan);

		expect(project).toMatchObject({ enabled: true, entry: plan.entry });
		const files = await store.listRuntimeFiles(draft.id);
		expect(files.map((file) => file.path)).toEqual(
			plan.files.map((file) => file.path),
		);
		/** The content matches the registry value exactly; the store does not modify it. */
		for (const [index, file] of files.entries())
			expect(file.content).toBe(plan.files[index].content);
	});

	it("without a choice it is the default template", async () => {
		const store = open(nextViewer("runtime"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);

		const files = await store.listRuntimeFiles(draft.id);
		expect(files.map((file) => file.path)).toEqual(
			defaultRuntimeStarter().files.map((file) => file.path),
		);
	});

	it("a template does not overwrite existing files", async () => {
		/**
		 * The gallery appears only on first creation (a screen decision), but the store is the final
		 * guarantee. Whatever path leads here, files that already exist are never overwritten (§28, §29).
		 */
		const messenger = runtimeTemplateById("messenger");
		if (messenger === null) throw new Error("no template");

		const store = open(nextViewer("runtime"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		const [entry] = await store.listRuntimeFiles(draft.id);
		await store.updateRuntimeFile(entry.id, { content: "Code I wrote" });

		await store.enableRuntime(draft.id, instantiateRuntimeTemplate(messenger));

		const files = await store.listRuntimeFiles(draft.id);
		expect(files).toHaveLength(1);
		expect(files[0].content).toBe("Code I wrote");
	});

	it("turning off and on does not pour the starter file again", async () => {
		const store = open(nextViewer("runtime"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		const [entry] = await store.listRuntimeFiles(draft.id);
		await store.updateRuntimeFile(entry.id, { content: "Code I wrote" });

		await store.setRuntimeEnabled(draft.id, false);
		await store.enableRuntime(draft.id);

		const files = await store.listRuntimeFiles(draft.id);
		expect(files).toHaveLength(1);
		expect(files[0].content).toBe("Code I wrote");
	});

	it("turning off is not deleting", async () => {
		const store = open(nextViewer("runtime"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);

		const off = await store.setRuntimeEnabled(draft.id, false);
		expect(off).toMatchObject({ enabled: false });
		/** The files are unchanged. That is all that makes this operation reversible. */
		expect(await store.listRuntimeFiles(draft.id)).toHaveLength(1);
	});

	it("a draft never turned on does not turn on through this path", async () => {
		/**
		 * If there is a path that enables a project without starter files, the draft's studio opens as an
		 * empty explorer and cannot be re-enabled, so there is no way out of that state.
		 */
		const store = open(nextViewer("runtime"));
		const draft = await store.createDraft();
		expect(await store.setRuntimeEnabled(draft.id, true)).toBeNull();
		expect(await store.getRuntimeProject(draft.id)).toBeNull();
	});

	it("does not create a file at the same path twice", async () => {
		const store = open(nextViewer("runtime"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);

		expect(
			await store.createRuntimeFile(draft.id, { path: "src/state.ts" }),
		).not.toBeNull();
		expect(
			await store.createRuntimeFile(draft.id, { path: "src/state.ts" }),
		).toBeNull();
		expect(await store.listRuntimeFiles(draft.id)).toHaveLength(2);
	});

	it("a rename does not overwrite a sibling", async () => {
		const store = open(nextViewer("runtime"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		const other = await store.createRuntimeFile(draft.id, {
			path: "src/state.ts",
			content: "Sibling",
		});
		if (!other) throw new Error("the file must be created");

		await store.updateRuntimeFile(other.id, { path: "src/main.tsx" });

		const files = await store.listRuntimeFiles(draft.id);
		expect(files.map((file) => file.path)).toEqual([
			"src/main.tsx",
			"src/state.ts",
		]);
		expect(files.find((file) => file.path === "src/state.ts")?.content).toBe(
			"Sibling",
		);
	});

	it("comes out in path order", async () => {
		const store = open(nextViewer("runtime"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		for (const path of ["src/z.ts", "lib/a.ts", "src/a.ts"])
			await store.createRuntimeFile(draft.id, { path });

		expect((await store.listRuntimeFiles(draft.id)).map((f) => f.path)).toEqual(
			["lib/a.ts", "src/a.ts", "src/main.tsx", "src/z.ts"],
		);
	});

	it("deleting the draft deletes the project and files too", async () => {
		const viewer = nextViewer("runtime");
		const store = open(viewer);
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		await store.createRuntimeFile(draft.id, { path: "src/state.ts" });

		await store.deleteDraft(draft.id);

		expect(await store.getRuntimeProject(draft.id)).toBeNull();
		expect(await store.listRuntimeFiles(draft.id)).toEqual([]);

		/**
		 * The tombstone must remain. A hard delete gives no way to propagate the deletion to other
		 * devices, and those devices would bring back the files they still know about at the next sync.
		 */
		/** Reopening the active scope for the same member returns the same connection. */
		const db = activateLocalDbScope(viewer);
		const files = await db.draftRuntimeFiles
			.where("draftId")
			.equals(draft.id)
			.toArray();
		expect(files).toHaveLength(2);
		expect(files.every((file) => file.deletedAt !== null)).toBe(true);
		expect(files.every((file) => file.dirty === 1)).toBe(true);
	});

	it("projects are split per account", async () => {
		const alice = open(nextViewer("alice"));
		const draft = await alice.createDraft();
		await alice.enableRuntime(draft.id);

		resetLocalDbScope();
		const bob = open(nextViewer("bob"));
		expect(await bob.getRuntimeProject(draft.id)).toBeNull();
		expect(await bob.listRuntimeFiles(draft.id)).toEqual([]);
	});

	it("editing a file does not raise the draft's authoring group revisions", async () => {
		/**
		 * Changing code does not change the title or prompt, so no group revision is bumped here. Bumping
		 * it would let the next merge overwrite other devices' edits in fields that did not change.
		 */
		const store = open(nextViewer("runtime"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		const before = await store.getDraft(draft.id);
		if (!before) throw new Error("the draft must exist");

		const [entry] = await store.listRuntimeFiles(draft.id);
		await store.updateRuntimeFile(entry.id, { content: "x" });

		const after = await store.getDraft(draft.id);
		if (!after) throw new Error("the draft must exist");
		for (const group of DRAFT_FIELD_GROUPS)
			expect(compareRev(after.fieldRev[group], before.fieldRev[group])).toBe(0);
		/**
		 * Activity time moves forward. It is the list's sort key, so the just-edited draft must rise to
		 * the top.
		 */
		expect(compareRev(after.rev, before.rev)).toBeGreaterThan(0);
	});
});

/**
 * Managed image bindings: binding and deleting are separate operations.
 *
 * Four guarantees here break silently. Two identical names stored means `asset("a")` cannot say
 * which image it refers to. A replacement that leaves the dimensions at old values makes the list
 * show false data. A removal that deletes anything beyond the draft breaks already-published works.
 * If publish assembly leaves this list out, the next publish deletes the work's images.
 */
describe("managed runtime images", () => {
	const bind = (index: number) =>
		({
			path: `characters/sena/${index}`,
			kind: "image",
			assetId: `media-${index}`,
			mime: "image/webp",
			width: 100 + index,
			height: 200 + index,
		}) as const;

	/**
	 * A sound file lives in the same name space as images. The test checks that its kind is stored and
	 * that it flows through to publishing.
	 */
	const bindAudio = (index: number) =>
		({
			path: `audio/bgm/${index}`,
			kind: "audio",
			assetId: `media-audio-${index}`,
			mime: "audio/mpeg",
			durationMs: 10_000 + index,
		}) as const;

	it("binding lists it with its dimensions", async () => {
		const store = open(nextViewer("runtime-asset"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);

		expect(await store.listRuntimeAssets(draft.id)).toEqual([]);
		const created = await store.createRuntimeAsset(draft.id, bind(1));
		expect(created).toMatchObject({
			draftId: draft.id,
			path: "characters/sena/1",
			assetId: "media-1",
			mime: "image/webp",
			width: 101,
			height: 201,
		});
		expect(
			(await store.listRuntimeAssets(draft.id)).map((asset) => asset.path),
		).toEqual(["characters/sena/1"]);
	});

	/**
	 * The list is sorted by path, not by creation order, because each device must produce the same
	 * order.
	 */
	it("the list is in path order", async () => {
		const store = open(nextViewer("runtime-asset"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		await store.createRuntimeAsset(draft.id, {
			...bind(1),
			path: "ui/heart",
		});
		await store.createRuntimeAsset(draft.id, {
			...bind(2),
			path: "backgrounds/library",
		});
		expect(
			(await store.listRuntimeAssets(draft.id)).map((asset) => asset.path),
		).toEqual(["backgrounds/library", "ui/heart"]);
	});

	/**
	 * The store is the final authority on duplicates. The screen already filters them, but that check
	 * uses the list this tab holds, and another tab may bind the same name in the meantime.
	 */
	it("the same name cannot be bound twice", async () => {
		const store = open(nextViewer("runtime-asset"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		await store.createRuntimeAsset(draft.id, bind(1));
		expect(
			await store.createRuntimeAsset(draft.id, {
				...bind(2),
				path: "characters/sena/1",
			}),
		).toBeNull();
		expect(await store.listRuntimeAssets(draft.id)).toHaveLength(1);
	});

	it("renaming keeps the image", async () => {
		const store = open(nextViewer("runtime-asset"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		const created = await store.createRuntimeAsset(draft.id, bind(1));
		if (!created) throw new Error("the asset was not created");

		await store.updateRuntimeAsset(created.id, {
			path: "characters/sena/happy",
		});
		const [asset] = await store.listRuntimeAssets(draft.id);
		expect(asset).toMatchObject({
			path: "characters/sena/happy",
			assetId: "media-1",
			width: 101,
		});
	});

	/**
	 * Replacement moves the identity and the dimensions together. If only `assetId` changes and the
	 * dimensions keep their old values, the list shows false data, and nobody notices until the image
	 * is opened. The name stays the same.
	 */
	it("replacing moves identity and dimensions together; the name stays", async () => {
		const store = open(nextViewer("runtime-asset"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		const created = await store.createRuntimeAsset(draft.id, bind(1));
		if (!created) throw new Error("the asset was not created");

		await store.updateRuntimeAsset(created.id, {
			assetId: "media-next",
			mime: "image/webp",
			width: 640,
			height: 480,
		});
		const [asset] = await store.listRuntimeAssets(draft.id);
		expect(asset).toMatchObject({
			path: "characters/sena/1",
			assetId: "media-next",
			width: 640,
			height: 480,
		});
		/**
		 * It is the same record. Do not delete and recreate it, because that would shift `createdAt`.
		 */
		expect(asset.id).toBe(created.id);
		expect(asset.createdAt).toBe(created.createdAt);
	});

	/**
	 * A sound lives in the same name space: its kind is stored and the other axis stays empty.
	 * `durationMs` is kept, and `width` is `null` as a pair. Filling the dimensions with 0 would make
	 * the list show `0×0`, which reads as a fault rather than information.
	 */
	it("sounds stand in the same list with a duration; dimensions are empty", async () => {
		const store = open(nextViewer("runtime-asset"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);

		await store.createRuntimeAsset(draft.id, bindAudio(1));
		await store.createRuntimeAsset(draft.id, bind(1));
		const assets = await store.listRuntimeAssets(draft.id);
		expect(assets.map((asset) => `${asset.path}:${asset.kind}`)).toEqual([
			"audio/bgm/1:audio",
			"characters/sena/1:image",
		]);
		expect(assets[0]).toMatchObject({
			kind: "audio",
			mime: "audio/mpeg",
			durationMs: 10_001,
			width: null,
			height: null,
		});
		expect(assets[1]).toMatchObject({
			kind: "image",
			durationMs: null,
			width: 101,
		});
	});

	/** There is one name space, so a sound cannot take an image's name. */
	it("an image and a sound cannot share a name", async () => {
		const store = open(nextViewer("runtime-asset"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);

		await store.createRuntimeAsset(draft.id, bind(1));
		expect(
			await store.createRuntimeAsset(draft.id, {
				...bindAudio(1),
				path: "characters/sena/1",
			}),
		).toBeNull();
		expect((await store.listRuntimeAssets(draft.id)).length).toBe(1);
	});

	it("renames are blocked on duplicates too, except for itself", async () => {
		const store = open(nextViewer("runtime-asset"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		const first = await store.createRuntimeAsset(draft.id, bind(1));
		await store.createRuntimeAsset(draft.id, bind(2));
		if (!first) throw new Error("the asset was not created");

		await store.updateRuntimeAsset(first.id, { path: "characters/sena/2" });
		expect(
			(await store.listRuntimeAssets(draft.id)).map((asset) => asset.path),
		).toEqual(["characters/sena/1", "characters/sena/2"]);

		/** Updating to the asset's own name passes (this is the shape of a case-only rename). */
		await store.updateRuntimeAsset(first.id, { path: "characters/sena/1" });
		expect(
			(await store.listRuntimeAssets(draft.id)).map((asset) => asset.path),
		).toEqual(["characters/sena/1", "characters/sena/2"]);
	});

	it("removal only unbinds it from this draft", async () => {
		const store = open(nextViewer("runtime-asset"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		const created = await store.createRuntimeAsset(draft.id, bind(1));
		if (!created) throw new Error("the asset was not created");

		await store.deleteRuntimeAsset(created.id);
		expect(await store.listRuntimeAssets(draft.id)).toEqual([]);
		/** The file is unchanged. Removing an image is not the same as deleting code. */
		expect(await store.listRuntimeFiles(draft.id)).toHaveLength(1);
	});

	/** Turning the runtime off does not delete. Files and assets follow the same rule. */
	it("turning the runtime off keeps the bindings", async () => {
		const store = open(nextViewer("runtime-asset"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		await store.createRuntimeAsset(draft.id, bind(1));

		await store.setRuntimeEnabled(draft.id, false);
		expect(await store.listRuntimeAssets(draft.id)).toHaveLength(1);
	});

	/**
	 * Publish assembly reads this list. If it is left out, the next publish deletes that work's
	 * images.
	 */
	it("the publication source carries the bindings", async () => {
		const store = open(nextViewer("runtime-asset"));
		const draft = await store.createDraft({ title: "Draft with an image" });
		await store.enableRuntime(draft.id);
		await store.createRuntimeAsset(draft.id, bind(1));

		const source = await store.loadPublicationSource(draft.id);
		expect(source?.runtime?.assets.map((asset) => asset.path)).toEqual([
			"characters/sena/1",
		]);
	});

	/** Deleting a draft tombstones its bindings along with it, as children. */
	it("deleting the draft takes the bindings", async () => {
		const store = open(nextViewer("runtime-asset"));
		const draft = await store.createDraft();
		await store.enableRuntime(draft.id);
		await store.createRuntimeAsset(draft.id, bind(1));

		await store.deleteDraft(draft.id);
		expect(await store.listRuntimeAssets(draft.id)).toEqual([]);
	});
});
