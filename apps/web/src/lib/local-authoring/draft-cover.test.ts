import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createDraftCoverStore, DRAFT_COVER_VERSION } from "./draft-cover.ts";
import { createAuthoringStore } from "./store.ts";

/**
 * The pre-publish cover: a layer that handles the user's images, so types alone are not enough.
 *
 * Everything that breaks here breaks silently. If account isolation fails, the screen still looks
 * normal: someone else's picture is simply in my draft. If the cascade is missed, image bytes that
 * appear on no screen stay on the device forever. If the sync axis is attached by mistake, a
 * multi-MB envelope goes to the server. All three are verified only by opening and closing a real
 * IndexedDB (fake-indexeddb).
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-cover-${++sequence}`;

const open = (viewerId: string) => {
	const db = activateLocalDbScope(viewerId);
	return {
		db,
		drafts: createAuthoringStore(db),
		covers: createDraftCoverStore(db),
	};
};

/** Pretending to be an image is unnecessary. This layer does not judge bytes; the server does. */
const image = (text: string, type = "image/png"): Blob =>
	new Blob([text], { type });

afterEach(() => {
	resetLocalDbScope();
});

describe("pending cover: persistence", () => {
	/**
	 * The core premise of this feature is that the tab is closed and reopened. Publishing may happen
	 * days later.
	 */
	it("a chosen cover stays after reopening", async () => {
		const alice = nextViewer("alice");
		const first = open(alice);
		const draft = await first.drafts.createDraft();
		await first.covers.put(draft.id, image("cover-A"));

		resetLocalDbScope();
		const again = open(alice);

		const found = await again.covers.get(draft.id);
		expect(found).not.toBeNull();
		expect(await found?.blob.text()).toBe("cover-A");
		expect(found?.mime).toBe("image/png");
	});

	it("choosing again replaces it; there is one row", async () => {
		const alice = nextViewer("alice");
		const { db, drafts, covers } = open(alice);
		const draft = await drafts.createDraft();

		await covers.put(draft.id, image("First"));
		await covers.put(draft.id, image("Second"));

		expect(await db.draftCovers.count()).toBe(1);
		expect(await (await covers.get(draft.id))?.blob.text()).toBe("Second");
	});

	/**
	 * The point of this test is the direction of account switching. Each member has a separate
	 * database (db.ts), so isolation should be free. Whether that 'free' actually holds must be
	 * checked by opening it. If it leaks here, a picture Alice chose would appear in Bob's editor.
	 */
	it("another member's cover is not visible", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		const a = open(alice);
		const draft = await a.drafts.createDraft();
		await a.covers.put(draft.id, image("Alice's picture"));

		resetLocalDbScope();
		const b = open(bob);
		// Even when asked with the same draft id (which should not happen), the draft is not in that
		// member's database.
		expect(await b.covers.get(draft.id)).toBeNull();
	});
});

describe("pending cover: not synced", () => {
	/**
	 * The most important assertion in this file.
	 *
	 * If even one sync field attaches to a stored row, that row will eventually be picked up by
	 * outbound collection. At that moment a multi-MB image goes to the server inside an encrypted
	 * envelope. This slice chose not to do exactly that. The whole key set is counted, because
	 * checking only for 'no dirty' would let a later `rev` slip through unnoticed.
	 */
	it("the row has only the six allowed fields", async () => {
		const alice = nextViewer("alice");
		const { db, drafts, covers } = open(alice);
		const draft = await drafts.createDraft();
		await covers.put(draft.id, image("Cover"));

		const row = await db.draftCovers.get(draft.id);
		expect(Object.keys(row ?? {}).sort()).toEqual([
			"blob",
			"draftId",
			"mime",
			"size",
			"updatedAt",
			"version",
		]);
	});

	it.each([
		"dirty",
		"rev",
		"serverVersion",
		"deletedAt",
	])("sync axis `%s` is not in the row", async (field) => {
		const alice = nextViewer("alice");
		const { db, drafts, covers } = open(alice);
		const draft = await drafts.createDraft();
		await covers.put(draft.id, image("Cover"));

		expect(await db.draftCovers.get(draft.id)).not.toHaveProperty(field);
	});

	/**
	 * A row of an unknown version is ignored entirely. Reading half of it and handing it to
	 * `URL.createObjectURL` would crash the whole screen, which is worse than having no cover.
	 */
	it("a row of another version reads as absent", async () => {
		const alice = nextViewer("alice");
		const { db, drafts, covers } = open(alice);
		const draft = await drafts.createDraft();
		await covers.put(draft.id, image("Cover"));

		const row = await db.draftCovers.get(draft.id);
		if (!row) throw new Error("no row");
		await db.draftCovers.put({ ...row, version: DRAFT_COVER_VERSION + 1 });

		expect(await covers.get(draft.id)).toBeNull();
	});
});

describe("pending cover: goes with the draft", () => {
	/**
	 * Forgetting the cascade produces no symptom at all. With no draft there is no screen to open the
	 * cover, and sync does not know this table. A picture the user believes they deleted stays on the
	 * device forever, where nobody can see it.
	 */
	it("deleting the draft deletes its pending cover", async () => {
		const alice = nextViewer("alice");
		const { db, drafts, covers } = open(alice);
		const draft = await drafts.createDraft();
		await covers.put(draft.id, image("Cover"));

		await drafts.deleteDraft(draft.id);

		expect(await covers.get(draft.id)).toBeNull();
		expect(await db.draftCovers.count()).toBe(0);
	});

	/**
	 * A draft is a soft delete (tombstone), but a cover is a hard delete. This asymmetry is
	 * intentional, and this test pins it. Leaving a tombstone in a table no one reads would only leave
	 * image bytes that no one reads.
	 */
	it("the draft stays as a tombstone but the cover row goes", async () => {
		const alice = nextViewer("alice");
		const { db, drafts, covers } = open(alice);
		const draft = await drafts.createDraft();
		await covers.put(draft.id, image("Cover"));

		await drafts.deleteDraft(draft.id);

		const tombstone = await db.storyDrafts.get(draft.id);
		expect(tombstone?.deletedAt).not.toBeNull();
		expect(await db.draftCovers.get(draft.id)).toBeUndefined();
	});

	/**
	 * Must not sweep away the covers of neighboring drafts too. The predicate is the single draft id.
	 */
	it("the neighboring draft's cover is untouched", async () => {
		const alice = nextViewer("alice");
		const { drafts, covers } = open(alice);
		const doomed = await drafts.createDraft();
		const kept = await drafts.createDraft();
		await covers.put(doomed.id, image("To delete"));
		await covers.put(kept.id, image("To keep"));

		await drafts.deleteDraft(doomed.id);

		expect(await covers.get(doomed.id)).toBeNull();
		expect(await (await covers.get(kept.id))?.blob.text()).toBe("To keep");
	});
});
