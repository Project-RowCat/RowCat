import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import type { Rev } from "@rowcat/contracts/sync";
import { compareRev } from "@rowcat/sync";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthoringStore } from "#/lib/local-authoring/store.ts";
import { createChatStore } from "#/lib/local-chat/store.ts";
import { activateLocalDbScope, resetLocalDbScope } from "./db.ts";
import { readSyncState } from "./hlc.ts";
import { SYNC_PROTOCOL_EPOCH } from "./sync-state.ts";

/**
 * Schema migration tests. Types are not enough when the data already sits on users' devices.
 *
 * Breakage here shows up only after deploy, through user reports. A migration that drops a row
 * loses that person's conversation. Folding dirty incorrectly means edits never uploaded never go
 * up. Starting the clock at 0 makes the first edit after migration lose to its own earlier
 * revision. None of these leaves a visible trace on screen.
 *
 * So the tests write rows in the real v2 shape and open them through product code.
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;
const dbName = (viewerId: string): string => `rowcat_chat_${viewerId}`;

afterEach(() => {
	resetLocalDbScope();
});

class LegacyV1Db extends Dexie {
	constructor(name: string) {
		super(name);
		this.version(1).stores({
			rooms: "id, updatedAt, originStoryId",
			messages: "id, roomId, [roomId+createdAt+id]",
		});
	}
}

/** v2-era database: authoring had been added, but the sync axis did not exist yet. */
class LegacyV2Db extends LegacyV1Db {
	constructor(name: string) {
		super(name);
		this.version(2).stores({
			rooms: "id, updatedAt, originStoryId",
			messages: "id, roomId, [roomId+createdAt+id]",
			storyDrafts: "id, updatedAt, publishedStoryId",
			draftCharacters: "id, draftId, [draftId+position]",
			draftLoreEntries: "id, draftId, [draftId+positionIndex]",
			draftStartScenes: "id, draftId, [draftId+position]",
		});
	}
}

/** Replay snapshot in the shape saved under v2. The migration does not look inside it. */
const SEED = StoryChatSeedDto.parse({
	version: 1,
	storyId: "story-1",
	title: "Test story",
	adult: false,
	promptProtected: false,
});

async function writeV2Fixture(
	name: string,
	options: { draftUpdatedAt?: string } = {},
): Promise<void> {
	const legacy = new LegacyV2Db(name);
	await legacy.open();
	expect(legacy.verno).toBe(2);

	await legacy.table("rooms").add({
		id: "room-1",
		originStoryId: "story-1",
		title: "Old conversation",
		adult: false,
		promptProtected: false,
		seed: SEED,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-02T00:00:00.000Z",
		dirty: true,
		serverVersion: 0,
	});
	await legacy.table("messages").bulkAdd([
		{
			id: "msg-1",
			roomId: "room-1",
			role: "user",
			speaker: "",
			content: "Something said before",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			// Record already confirmed by the server. The migration must not mark it dirty.
			dirty: false,
			serverVersion: 4,
		},
		{
			id: "msg-2",
			roomId: "room-1",
			role: "assistant",
			speaker: "",
			content: "Something received before",
			createdAt: "2026-01-01T00:00:01.000Z",
			updatedAt: "2026-01-01T00:00:01.000Z",
			dirty: true,
			serverVersion: 0,
		},
	]);

	await legacy.table("storyDrafts").add({
		id: "draft-1",
		schemaVersion: 1,
		title: "Old manuscript",
		tagline: "",
		description: "",
		tags: ["Tag"],
		orientation: null,
		adult: false,
		visibility: "private",
		promptProtected: false,
		scenario: "Old scenario",
		playGuide: "",
		suggestedPersona: null,
		defaultStartSceneId: "scene-1",
		publishedStoryId: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: options.draftUpdatedAt ?? "2026-01-03T00:00:00.000Z",
		deletedAt: null,
		dirty: true,
		serverVersion: 0,
	});
	await legacy.table("draftCharacters").bulkAdd([
		{
			id: "char-2",
			draftId: "draft-1",
			position: 1,
			name: "Two",
			mode: "structured",
			description: "",
			personality: "",
			speechStyle: "",
			exampleDialogue: "",
			prompt: "",
			libraryCharacterId: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			deletedAt: null,
			dirty: false,
			serverVersion: 2,
		},
		{
			id: "char-1",
			draftId: "draft-1",
			position: 0,
			name: "One",
			mode: "structured",
			description: "",
			personality: "",
			speechStyle: "",
			exampleDialogue: "",
			prompt: "",
			libraryCharacterId: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			deletedAt: null,
			dirty: true,
			serverVersion: 0,
		},
	]);
	await legacy.table("draftLoreEntries").add({
		id: "lore-1",
		draftId: "draft-1",
		positionIndex: 0,
		keys: ["key"],
		content: "Setting",
		constant: false,
		position: "system_bottom",
		order: 0,
		createdAt: "2026-01-01T00:00:00.000Z",
		/**
		 * Corrupt timestamp. If the migration puts NaN into a revision, that record falls outside the
		 * total order.
		 */
		updatedAt: "A value of unknown time",
		deletedAt: null,
		dirty: true,
		serverVersion: 0,
	});
	await legacy.table("draftStartScenes").add({
		id: "scene-1",
		draftId: "draft-1",
		position: 0,
		title: "Dawn",
		content: "The door opens.",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		deletedAt: null,
		dirty: true,
		serverVersion: 0,
	});

	legacy.close();
}

const isValidRev = (rev: Rev | undefined, deviceId: string): boolean =>
	rev !== undefined &&
	Number.isInteger(rev.t) &&
	rev.t >= 0 &&
	Number.isInteger(rev.c) &&
	rev.c >= 0 &&
	rev.d === deviceId;

describe("v2 → v3 migration", () => {
	it("rows of all six stores stay and sync axes are backfilled", async () => {
		const alice = nextViewer("migrate");
		await writeV2Fixture(dbName(alice));

		const db = activateLocalDbScope(alice);
		await db.open();
		// Latest version. If the upgrade chain (v1 through the newest version) breaks, it shows up here
		// first.
		expect(db.verno).toBe(24);

		/**
		 * The two player-save tables introduced in v19. Being empty is the exact correct state here.
		 *
		 * Backfilling empty rows would make every work in that account dirty for no reason. That push
		 * would be a pointless round trip to other devices. v13 and v18 made the same call.
		 */
		expect(await db.runtimePlaythroughs.count()).toBe(0);
		expect(await db.runtimePersistentStates.count()).toBe(0);

		/**
		 * The managed image bindings introduced in v21. Empty is also the correct state here.
		 *
		 * Before this version there was no surface for binding a logical name to an image, so old
		 * projects have no assets at all. There is no value to backfill, and fabricating one would create
		 * a binding the author never made.
		 */
		expect(await db.draftRuntimeAssets.count()).toBe(0);

		const state = await readSyncState(db);
		expect(state).not.toBeNull();
		if (!state) return;
		expect(state.deviceId).not.toBe("");
		expect(await db.syncState.count()).toBe(1);
		expect(state.cursor).toBe(0);
		expect(state.protocolEpoch).toBe(SYNC_PROTOCOL_EPOCH);
		expect(state.initialSyncDone).toBe(false);
		expect(state.lastSyncedAt).toBeNull();
		expect(state.lastError).toBeNull();

		const room = await db.rooms.get("room-1");
		const messages = await db.messages.orderBy("id").toArray();
		const draft = await db.storyDrafts.get("draft-1");
		const lore = await db.draftLoreEntries.get("lore-1");
		const scene = await db.draftStartScenes.get("scene-1");

		expect(room?.title).toBe("Old conversation");
		expect(messages.map((m) => m.content)).toEqual([
			"Something said before",
			"Something received before",
		]);
		expect(lore?.content).toBe("Setting");
		expect(scene?.title).toBe("Dawn");

		expect(room?.dirty).toBe(1);
		expect(messages.map((m) => m.dirty)).toEqual([0, 1]);
		expect(messages[0]?.serverVersion).toBe(4);

		expect(room?.deletedAt).toBeNull();
		expect(messages.every((m) => m.deletedAt === null)).toBe(true);

		for (const record of [room, draft, lore, scene, ...messages])
			expect(isValidRev(record?.rev, state.deviceId)).toBe(true);
		expect(room?.rev.t).toBe(Date.parse("2026-01-02T00:00:00.000Z"));
		expect(lore?.rev).toEqual({ t: 0, c: 0, d: state.deviceId });

		// The draft receives revisions for all five field groups. The persona group was removed in v9.
		expect(Object.keys(draft?.fieldRev ?? {}).sort()).toEqual([
			"body",
			"defaults",
			"meta",
			"publication",
			"rating",
		]);

		/**
		 * Authored body folded (v9). World, progression guide, counterpart and characters are combined
		 * into one prompt. The folding rule belongs to foldLegacyDraftBody in @rowcat/authoring, and that
		 * package's tests pin it down. This test checks only that the migration actually goes through
		 * that function.
		 */
		expect(draft?.prompt).toBe(
			"Old scenario\n\n## 등장인물\n### One\n\n### Two",
		);
		expect(draft).not.toHaveProperty("bodyMode");
		expect(draft).not.toHaveProperty("scenario");
		expect(draft).not.toHaveProperty("playGuide");
		expect(draft).not.toHaveProperty("suggestedPersona");
		expect(draft?.schemaVersion).toBe(2);
		/** The body really changed, so the change must go out. This is where v9 diverges from v8. */
		expect(draft?.dirty).toBe(1);
		expect(draft?.fieldRev.body).toEqual(draft?.rev);

		const backfilled = [room, draft, lore, scene, ...messages];
		for (const record of backfilled)
			expect(state.hlcT).toBeGreaterThanOrEqual(record?.rev.t ?? 0);
		/**
		 * At or after the v3 backfill timestamp. It may not be exactly equal: v9 issued a new revision
		 * for the folded draft, which ticked the clock once more.
		 */
		expect(state.hlcT).toBeGreaterThanOrEqual(
			Date.parse("2026-01-03T00:00:00.000Z"),
		);
		expect(Number.isInteger(state.hlcC)).toBe(true);
	});

	/**
	 * The v5 device-preference table is not a migration target, because there is no old data to move.
	 * Two things are checked: the chain is unbroken and the table really exists, and rows that already
	 * existed were not touched.
	 */
	it("the device preference table is created empty and existing rows are untouched", async () => {
		const alice = nextViewer("migrate");
		await writeV2Fixture(dbName(alice));

		const db = activateLocalDbScope(alice);
		await db.open();

		expect(await db.generationPreferences.count()).toBe(0);
		expect(await db.rooms.count()).toBe(1);
		expect(await db.messages.count()).toBe(2);
		expect(await db.storyDrafts.count()).toBe(1);

		await db.generationPreferences.put({
			key: "global",
			version: 1,
			responseLength: "long",
		});
		expect(await db.generationPreferences.get("global")).toMatchObject({
			responseLength: "long",
		});
	});

	it("migrated drafts keep their children's relations and order", async () => {
		const alice = nextViewer("migrate");
		await writeV2Fixture(dbName(alice));

		const db = activateLocalDbScope(alice);
		const authoring = createAuthoringStore(db);

		const drafts = await authoring.listDrafts();
		expect(drafts.map((d) => d.id)).toEqual(["draft-1"]);
		expect(await authoring.listLore("draft-1")).toHaveLength(1);
		// Results come back in position order, not insertion order.
		expect(
			(await authoring.listStartScenes("draft-1")).map((s) => s.id),
		).toEqual(["scene-1"]);
		expect(drafts[0]?.defaultStartSceneId).toBe("scene-1");
	});

	it("local ids do not change a character after migration", async () => {
		/**
		 * The local id is the future sync id, so the migration must not normalize the id format (for
		 * example by stripping hyphens). If it did, the same record would have one identity on one device
		 * and another on a second device, and the merge would treat them as different records. The legacy
		 * schema kept local and sync ids separately, and this is where that debt sits.
		 */
		const alice = nextViewer("migrate");
		const name = dbName(alice);
		const uuid = "e979c314-e381-42db-8c39-d7210e55ba59";
		const legacy = new LegacyV2Db(name);
		await legacy.open();
		await legacy.table("rooms").add({
			id: uuid,
			originStoryId: null,
			title: "hyphenated id",
			adult: false,
			promptProtected: false,
			seed: SEED,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			dirty: true,
			serverVersion: 0,
		});
		legacy.close();

		const db = activateLocalDbScope(alice);
		expect((await db.rooms.toArray()).map((r) => r.id)).toEqual([uuid]);
	});

	it("v1 data climbs the chain up to v3", async () => {
		const alice = nextViewer("migrate-v1");
		const legacy = new LegacyV1Db(dbName(alice));
		await legacy.open();
		expect(legacy.verno).toBe(1);
		await legacy.table("rooms").add({
			id: "room-1",
			originStoryId: null,
			title: "v1 conversation",
			adult: false,
			promptProtected: false,
			seed: SEED,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			dirty: true,
			serverVersion: 0,
		});
		legacy.close();

		const db = activateLocalDbScope(alice);
		await db.open();
		expect(db.verno).toBe(24);

		const state = await readSyncState(db);
		const room = await db.rooms.get("room-1");
		expect(room?.title).toBe("v1 conversation");
		expect(room?.deletedAt).toBeNull();
		expect(room?.dirty).toBe(1);
		expect(isValidRev(room?.rev, state?.deviceId ?? "")).toBe(true);
		expect(state?.hlcT).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
	});
});

describe("clock after migration", () => {
	it("even with the wall clock behind, the first edit is later than the migrated record", async () => {
		/**
		 * This regression matters most in this file. If the migration starts the clock at 0, then on a
		 * device whose wall clock runs behind, the first edit after migration gets a revision older than
		 * its own previous version. Nothing reads that value yet, so nothing shows. When sync turns on,
		 * that edit silently loses.
		 *
		 * Instead of changing the time, the test plants a row with a future updatedAt. The current wall
		 * clock is behind it, which is the same situation as a device whose clock was set back.
		 */
		const alice = nextViewer("clock");
		const future = "2099-01-01T00:00:00.000Z";
		await writeV2Fixture(dbName(alice), { draftUpdatedAt: future });

		const db = activateLocalDbScope(alice);
		const authoring = createAuthoringStore(db);

		const state = await readSyncState(db);
		expect(state?.hlcT).toBe(Date.parse(future));
		expect(Date.now()).toBeLessThan(Date.parse(future));

		const before = await authoring.getDraft("draft-1");
		const after = await authoring.updateDraft("draft-1", {
			prompt: "Edited after migration",
		});

		if (!before || !after) throw new Error("the draft is gone");
		expect(after.rev.t).toBeGreaterThanOrEqual(Date.parse(future));
		// The wall clock has not yet passed that time, so the counter creates the ordering.
		expect(after.rev.c).toBeGreaterThan(0);
		expect(compareRev(after.rev, before.rev)).toBeGreaterThan(0);
	});
});

describe("account isolation", () => {
	it("each member has their own device id and clock, kept on return", async () => {
		/**
		 * The device id is not derived from the member id, for two reasons. The local databases of two
		 * accounts must behave as two different devices, or their revisions would mix. Coming back to the
		 * same account must yield the same device, so yesterday's and today's edits share a device id.
		 */
		const aliceId = nextViewer("alice");
		const bobId = nextViewer("bob");

		const alice = activateLocalDbScope(aliceId);
		await createChatStore(alice).createRoom({
			originStoryId: null,
			seed: SEED,
		});
		const aliceState = await readSyncState(alice);

		const bob = activateLocalDbScope(bobId);
		await createChatStore(bob).createRoom({ originStoryId: null, seed: SEED });
		const bobState = await readSyncState(bob);

		expect(aliceState?.deviceId).not.toBe(bobState?.deviceId);

		const aliceAgain = activateLocalDbScope(aliceId);
		const again = await readSyncState(aliceAgain);
		expect(again?.deviceId).toBe(aliceState?.deviceId);
		expect(again?.hlcT).toBeGreaterThanOrEqual(aliceState?.hlcT ?? 0);
	});
});

describe("v22 backfill", () => {
	/**
	 * This records a fact that was already true. Before this version no surface bound a sound to a
	 * logical name, so every row in the table is an image, and kind: "image" is an observation, not a
	 * guess. The mobile SQLite v16 makes the same statement. If the two stores did not agree, the same
	 * draft would report a different kind on each device.
	 */
	it("an old row without a kind becomes image and dirty stays", async () => {
		const viewer = nextViewer("asset-kind");
		const name = dbName(viewer);

		/** Writes in the pre-version shape directly. The indexes are the same as v21's. */
		const legacy = new Dexie(name);
		legacy.version(21).stores({
			draftRuntimeAssets: "id, draftId, [draftId+path], [dirty+id]",
		});
		await legacy.open();
		await legacy.table("draftRuntimeAssets").put({
			id: "asset-1",
			draftId: "draft-1",
			path: "characters/sena/smile",
			assetId: "media-A",
			mime: "image/webp",
			width: 640,
			height: 480,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			deletedAt: null,
			dirty: 0,
			serverVersion: 3,
			rev: { t: 1, c: 0, d: "device" },
		});
		legacy.close();

		const db = activateLocalDbScope(viewer);
		await db.open();
		expect(db.verno).toBe(24);

		const asset = await db.draftRuntimeAssets.get("asset-1");
		expect(asset?.kind).toBe("image");
		expect(asset?.width).toBe(640);
		expect(asset?.durationMs).toBeNull();
		/**
		 * The value did not change, only a column was added. Setting dirty here would make this device's
		 * next push upload every asset record, though none of their content changed.
		 */
		expect(asset?.dirty).toBe(0);
		expect(asset?.serverVersion).toBe(3);
	});
});

describe("v24 table cleanup", () => {
	/**
	 * Only the import's record table is removed. The rooms that import wrote are ordinary records and
	 * must remain. Removing them along with the record table would erase that device's conversations.
	 */
	it("the migration log table goes and rooms stay", async () => {
		const viewer = nextViewer("legacy-tables");
		const name = dbName(viewer);

		const previous = new Dexie(name);
		previous.version(23).stores({
			rooms: "id, updatedAt, originStoryId",
			legacyImports: "db",
			legacyMigrations: "db",
			legacyMigrationIds: "[db+key], db",
			legacyMigrationAssets: "[db+key], db",
			legacyMigrationUnits: "[db+unit], db",
		});
		await previous.open();
		await previous.table("rooms").put({
			id: "room-1",
			originStoryId: null,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		await previous
			.table("legacyImports")
			.put({ db: "old", at: "2026-01-01T00:00:00.000Z", records: 1 });
		previous.close();

		const db = activateLocalDbScope(viewer);
		await db.open();
		expect(db.verno).toBe(24);

		const tables = db.backendDB().objectStoreNames;
		for (const table of [
			"legacyImports",
			"legacyMigrations",
			"legacyMigrationIds",
			"legacyMigrationAssets",
			"legacyMigrationUnits",
		])
			expect(tables.contains(table), table).toBe(false);
		expect(await db.rooms.get("room-1")).toBeDefined();
	});
});
