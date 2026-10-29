import type { AuthoringStore } from "@rowcat/authoring";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController } from "./activation.ts";
import type { MobileDatabase } from "./sqlite.ts";

/**
 * The SQLite `AuthoringStore` — **the same behaviour matrix** as the web adapter.
 *
 * The two most quietly broken things on the authoring side: a child is edited but the parent's
 * activity time does not move (a draft just touched stays at its old place in the list), and the
 * per-group revision (`fieldRev`) does not move (the winner of concurrent edits becomes per record
 * rather than per field). Neither shows any symptom on screen.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let authoring: AuthoringStore;
let db: MobileDatabase;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	const scope = await controller.activate("alice");
	authoring = scope.stores.authoring;
	db = scope.db;
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

describe("Drafts", () => {
	it("can be created with no values and read back", async () => {
		const draft = await authoring.createDraft();
		expect(await authoring.getDraft(draft.id)).toEqual(draft);
		expect(draft.title).toBe("");
		expect(draft.visibility).toBe("private");
		expect(draft.dirty).toBe(1);
	});

	it("the list is most recently edited first", async () => {
		const first = await authoring.createDraft({ title: "First" });
		const second = await authoring.createDraft({ title: "Second" });
		expect((await authoring.listDrafts()).map((d) => d.id)).toEqual([
			second.id,
			first.id,
		]);

		await authoring.updateDraft(first.id, { title: "First (edited)" });
		expect((await authoring.listDrafts()).map((d) => d.id)).toEqual([
			first.id,
			second.id,
		]);
	});

	it("array fields survive a JSON round trip", async () => {
		const draft = await authoring.createDraft({
			tags: ["fantasy", "noir"],
			orientation: "male",
		});
		const read = await authoring.getDraft(draft.id);
		expect(read?.tags).toEqual(["fantasy", "noir"]);
		expect(read?.orientation).toBe("male");
	});

	it("edits raise only the revision of **the group the field belongs to**", async () => {
		const draft = await authoring.createDraft();
		const updated = await authoring.updateDraft(draft.id, { title: "Title" });

		// The meta group bumps.
		expect(updated?.fieldRev.meta).not.toEqual(draft.fieldRev.meta);
		// Groups that were not touched stay as they are — this is the basis of field-level merge.
		expect(updated?.fieldRev.body).toEqual(draft.fieldRev.body);
		expect(updated?.fieldRev.rating).toEqual(draft.fieldRev.rating);
	});

	it("soft deletion finishes children too in the same transaction", async () => {
		const draft = await authoring.createDraft();
		const entry = await authoring.createLore(draft.id, { content: "Lore" });
		await authoring.createStartScene(draft.id, { title: "Scene" });

		await authoring.deleteDraft(draft.id);

		expect(await authoring.getDraft(draft.id)).toBeNull();
		expect(await authoring.listDrafts()).toEqual([]);
		expect(await authoring.listLore(draft.id)).toEqual([]);
		expect(await authoring.listStartScenes(draft.id)).toEqual([]);

		/**
		 * Draft children **each receive their own tombstone** — this differs from the conversation
		 * cascade. A room is covered by one tombstone for its whole subtree, but there is no such
		 * convention here.
		 */
		const row = await db.first<{ deleted_at: string | null; dirty: number }>(
			"SELECT deleted_at, dirty FROM authoring_lore WHERE id = ?",
			[entry.id],
		);
		expect(row?.deleted_at).not.toBeNull();
		expect(row?.dirty).toBe(1);
	});

	it("a late edit to a deleted draft doesn't revive it", async () => {
		const draft = await authoring.createDraft();
		await authoring.deleteDraft(draft.id);
		expect(
			await authoring.updateDraft(draft.id, { title: "Revive" }),
		).toBeNull();
		expect(await authoring.getDraft(draft.id)).toBeNull();
	});

	it("the publish link doesn't change the draft id", async () => {
		const draft = await authoring.createDraft({ title: "Manuscript" });
		const published = await authoring.markPublished(draft.id, "story-9");
		expect(published?.id).toBe(draft.id);
		expect(published?.publishedStoryId).toBe("story-9");
		expect(published?.fieldRev.publication).not.toEqual(
			draft.fieldRev.publication,
		);
		// Publication does not consume the draft — it must remain editable.
		expect(
			await authoring.updateDraft(draft.id, { title: "Edit" }),
		).not.toBeNull();
	});
});

describe("child", () => {
	it("creating appends to the end of the list and raises the parent's activity time", async () => {
		const draft = await authoring.createDraft();
		const before = (await authoring.getDraft(draft.id))?.updatedAt;
		const first = await authoring.createStartScene(draft.id, { title: "a" });
		const second = await authoring.createStartScene(draft.id, { title: "Me" });

		expect(
			(await authoring.listStartScenes(draft.id)).map((s) => s.id),
		).toEqual([first.id, second.id]);
		expect((await authoring.getDraft(draft.id))?.updatedAt).not.toBe(before);
	});

	it("position numbers count tombstones and aren't reused", async () => {
		const draft = await authoring.createDraft();
		const first = await authoring.createStartScene(draft.id);
		await authoring.deleteStartScene(first.id);
		const second = await authoring.createStartScene(draft.id);
		expect(second.position).toBe(1);
	});

	it("reordering is one transaction, and items not in the list stay at the end", async () => {
		const draft = await authoring.createDraft();
		const a = await authoring.createStartScene(draft.id, { title: "a" });
		const b = await authoring.createStartScene(draft.id, { title: "Me" });
		const c = await authoring.createStartScene(draft.id, { title: "c" });

		await authoring.reorderStartScenes(draft.id, [c.id, a.id, "missing-id"]);

		const ordered = await authoring.listStartScenes(draft.id);
		expect(ordered.map((x) => x.id)).toEqual([c.id, a.id, b.id]);
		expect(ordered.map((x) => x.position)).toEqual([0, 1, 2]);
	});

	it("lore's list order and injection position are different axes", async () => {
		const draft = await authoring.createDraft();
		const entry = await authoring.createLore(draft.id, {
			keys: ["key"],
			content: "Content",
			position: "system_top",
			order: 5,
			constant: true,
		});
		const [read] = await authoring.listLore(draft.id);
		expect(read).toEqual(entry);
		expect(read.positionIndex).toBe(0);
		expect(read.position).toBe("system_top");
		expect(read.order).toBe(5);
		expect(read.constant).toBe(true);
		expect(read.keys).toEqual(["key"]);
	});

	it("the first scene becomes the default opening, and deleting it moves the selection", async () => {
		const draft = await authoring.createDraft();
		const first = await authoring.createStartScene(draft.id, { title: "one" });
		expect((await authoring.getDraft(draft.id))?.defaultStartSceneId).toBe(
			first.id,
		);

		const second = await authoring.createStartScene(draft.id, { title: "two" });
		// A scene that was already chosen as the default is not displaced by a new scene.
		expect((await authoring.getDraft(draft.id))?.defaultStartSceneId).toBe(
			first.id,
		);

		await authoring.deleteStartScene(first.id);
		expect((await authoring.getDraft(draft.id))?.defaultStartSceneId).toBe(
			second.id,
		);

		await authoring.deleteStartScene(second.id);
		expect(
			(await authoring.getDraft(draft.id))?.defaultStartSceneId,
		).toBeNull();
	});

	it("another draft's scene can't be the default opening", async () => {
		const mine = await authoring.createDraft();
		const other = await authoring.createDraft();
		const scene = await authoring.createStartScene(other.id);

		await authoring.setDefaultStartScene(mine.id, scene.id);
		expect((await authoring.getDraft(mine.id))?.defaultStartSceneId).toBeNull();
	});

	it("deleted children don't appear in lookups and late edits don't revive them", async () => {
		const draft = await authoring.createDraft();
		const lore = await authoring.createLore(draft.id, { content: "Lore" });
		await authoring.deleteLore(lore.id);
		await authoring.updateLore(lore.id, { content: "Revive" });

		expect(await authoring.listLore(draft.id)).toEqual([]);
		const row = await db.first<{ content: string; deleted_at: string | null }>(
			"SELECT content, deleted_at FROM authoring_lore WHERE id = ?",
			[lore.id],
		);
		expect(row?.content).toBe("Lore");
		expect(row?.deleted_at).not.toBeNull();
	});

	it("the publish source comes in one consistent read", async () => {
		const draft = await authoring.createDraft({ title: "Manuscript" });
		await authoring.createLore(draft.id, { content: "Lore" });
		await authoring.createStartScene(draft.id, { title: "Scene" });

		const source = await authoring.loadPublicationSource(draft.id);
		expect(source?.draft.id).toBe(draft.id);
		expect(source?.lore).toHaveLength(1);
		expect(source?.startScenes).toHaveLength(1);

		await authoring.deleteDraft(draft.id);
		expect(await authoring.loadPublicationSource(draft.id)).toBeNull();
	});

	/**
	 * Managed assets — **images and sounds live in one name space, and the opposite axis is empty.**
	 *
	 * The reason this round trip is checked as a value here, even though this app has no studio, is
	 * sync. An asset bound on a Mac arrives on this device, and this device's next push must send it
	 * back unchanged — if any one column folds, that push uploads a version **without the asset**.
	 */
	it("sound assets round-trip with their duration — dimensions are empty", async () => {
		const draft = await authoring.createDraft({ title: "Manuscript" });
		await authoring.enableRuntime(draft.id);

		await authoring.createRuntimeAsset(draft.id, {
			path: "audio/bgm/main",
			kind: "audio",
			assetId: "media-B",
			mime: "audio/mpeg",
			durationMs: 102_000,
		});
		await authoring.createRuntimeAsset(draft.id, {
			path: "characters/sena/smile",
			kind: "image",
			assetId: "media-A",
			mime: "image/webp",
			width: 640,
			height: 480,
		});

		const assets = await authoring.listRuntimeAssets(draft.id);
		expect(assets.map((asset) => `${asset.path}:${asset.kind}`)).toEqual([
			"audio/bgm/main:audio",
			"characters/sena/smile:image",
		]);
		expect(assets[0]).toMatchObject({
			durationMs: 102_000,
			width: null,
			height: null,
		});
		expect(assets[1]).toMatchObject({ width: 640, durationMs: null });
	});

	/**
	 * Rows must still be readable while the v16 backfill has died midway on the device — if one row
	 * with an empty `kind` makes that draft's assets disappear entirely, the next push deletes them.
	 */
	it("rows with an empty kind read as image", async () => {
		const draft = await authoring.createDraft({ title: "Manuscript" });
		await authoring.enableRuntime(draft.id);
		await db.run(
			`INSERT INTO authoring_runtime_asset (
				id, draft_id, path, kind, asset_id, mime, width, height, duration_ms,
				created_at, updated_at, deleted_at, dirty, server_version,
				rev_t, rev_c, rev_d
			) VALUES ('legacy', ?, 'characters/sena/smile', '', 'media-A',
				'image/webp', 640, 480, NULL, 'a', 'a', NULL, 1, 0, 1, 0, 'd')`,
			[draft.id],
		);

		const [asset] = await authoring.listRuntimeAssets(draft.id);
		expect(asset?.kind).toBe("image");
		expect(asset?.width).toBe(640);
	});
});
