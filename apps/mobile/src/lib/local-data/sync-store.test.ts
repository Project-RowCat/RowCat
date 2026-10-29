import type { AuthoringStore } from "@rowcat/authoring";
import type { ChatRoom, ChatStore } from "@rowcat/chat";
import type { SyncStore } from "@rowcat/sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../test/fixtures.ts";
import { tombstoneEntry, wireEntry } from "../../test/inbound.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
	type NodeDriverHooks,
} from "../../test/sqlite-node.ts";
import { syncCodecRegistry } from "../local-sync/registry.ts";
import type { LocalScopeController } from "./activation.ts";
import type { DraftCoverStore } from "./draft-cover-store.ts";
import type { MobileDatabase } from "./sqlite.ts";
import { createSqliteSyncStore } from "./sync-store.ts";

/**
 * SQLite `SyncStore` tests. Every test here pins the commit boundary.
 *
 * Breakage here produces no symptom on screen: a cursor that advanced past its page, an edit lost
 * while waiting for a response, a deleted room's memory coming back. All of it surfaces only after
 * two devices meet, and then as user-written text disappearing.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let chat: ChatStore;
let authoring: AuthoringStore;
let sync: SyncStore;
let draftCover: DraftCoverStore;
let db: MobileDatabase;

/** Driver hook that reproduces a failure in the middle of a transaction. Tests turn it on and off. */
const hooks: NodeDriverHooks = {};
let failOn: ((sql: string) => boolean) | null = null;
hooks.beforeStatement = (sql) => {
	if (failOn?.(sql)) throw new Error("The disk died");
};

beforeEach(async () => {
	failOn = null;
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
		hooks,
	);
	const scope = await controller.activate("alice");
	chat = scope.stores.chat;
	authoring = scope.stores.authoring;
	sync = scope.stores.sync;
	draftCover = scope.stores.draftCover;
	db = scope.db;
});

afterEach(async () => {
	failOn = null;
	await controller.release();
	temp.dispose();
});

const newRoom = (title = "Room") =>
	chat.createRoom({ originStoryId: null, seed: seed(title), title });

describe("Status", () => {
	it("the first read creates the state row and the cursor is 0", async () => {
		const state = await sync.readState();
		expect(state.cursor).toBe(0);
		expect(state.initialSyncDone).toBe(false);
		expect(state.protocolEpoch).toBe(1);
		expect(state.deviceId).not.toBe("");
	});

	it("recording a result doesn't touch records", async () => {
		const room = await newRoom();
		await sync.recordOutcome({ syncedAt: "2026-01-01T00:00:00.000Z" });
		await sync.recordOutcome({ error: "network" });
		const state = await sync.readState();
		expect(state.lastSyncedAt).toBe("2026-01-01T00:00:00.000Z");
		expect(state.lastError).toBe("network");
		expect((await chat.getRoom(room.id))?.title).toBe(room.title);
	});

	it("preparing a full resync doesn't delete local data", async () => {
		const room = await newRoom();
		await sync.applyPull({
			entries: [],
			cursor: 42,
			markInitialSyncDone: true,
		});
		await sync.resetCursor();

		const state = await sync.readState();
		expect(state.cursor).toBe(0);
		expect(state.protocolEpoch).toBe(2);
		expect(state.initialSyncDone).toBe(false);
		// Local changes the server does not have are kept: a resync is not a wipe.
		expect(await chat.getRoom(room.id)).not.toBeNull();
	});
});

describe("outbound collection", () => {
	it("cuts by window and continues scanning with a cursor", async () => {
		const room = await newRoom();
		for (let i = 0; i < 5; i++)
			await chat.appendMessage({
				roomId: room.id,
				role: "user",
				content: `m${i}`,
			});

		const seen: string[] = [];
		let after = null as { type: string; id: string } | null;
		for (let page = 0; page < 10; page++) {
			const batch = await sync.collectOutbound({ limit: 2, after });
			seen.push(...batch.records.map((record) => record.id));
			after = batch.next;
			if (!after) break;
		}
		// One room and five messages make six records, with no duplicates or omissions.
		expect(seen).toHaveLength(6);
		expect(new Set(seen).size).toBe(6);
	});

	it("doesn't skip when dirty drops mid-scan", async () => {
		/**
		 * An `OFFSET` cursor would silently lose a record here: confirming the first window with a push
		 * clears its dirty flags and shifts the second window's offset. A key cursor does not shift.
		 */
		const room = await newRoom();
		const messages = [];
		for (let i = 0; i < 4; i++)
			messages.push(
				await chat.appendMessage({
					roomId: room.id,
					role: "user",
					content: `m${i}`,
				}),
			);

		const first = await sync.collectOutbound({ limit: 2 });
		await sync.commitPush(
			first.records.map((record, index) => ({
				id: record.id,
				type: record.type,
				version: index + 1,
				rev: record.rev,
			})),
		);

		const rest: string[] = [];
		let after = first.next;
		while (after) {
			const batch = await sync.collectOutbound({ limit: 2, after });
			rest.push(...batch.records.map((r) => r.id));
			after = batch.next;
		}
		const collected = new Set([...first.records.map((r) => r.id), ...rest]);
		expect(collected.size).toBe(5);
		for (const message of messages)
			expect(collected.has(message.id)).toBe(true);
	});

	it("a full scan includes rows that aren't dirty", async () => {
		const room = await newRoom();
		const [record] = (await sync.collectOutbound({ limit: 10 })).records;
		await sync.commitPush([
			{ id: record.id, type: record.type, version: 1, rev: record.rev },
		]);

		expect((await sync.collectOutbound({ limit: 10 })).records).toHaveLength(0);
		const all = await sync.collectOutbound({ limit: 10, all: true });
		expect(all.records.map((r) => r.id)).toEqual([room.id]);
	});

	it("tombstones go out without a payload — nothing to encrypt", async () => {
		const room = await newRoom();
		await chat.deleteRoom(room.id);
		const batch = await sync.collectOutbound({ limit: 10 });
		const outbound = batch.records.find((r) => r.id === room.id);
		expect(outbound?.deleted).toBe(true);
		expect(outbound?.payload).toBeNull();
	});

	it("parents go out before children", async () => {
		const room = await newRoom();
		await chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hi",
		});
		await authoring.createDraft();
		const batch = await sync.collectOutbound({ limit: 50 });
		expect(batch.records.map((r) => r.type)).toEqual([
			"chat.room",
			"chat.message",
			"authoring.draft",
		]);
	});
});

describe("push confirmation", () => {
	it("with an unchanged revision it drops dirty and writes the server version", async () => {
		const room = await newRoom();
		const [record] = (await sync.collectOutbound({ limit: 10 })).records;

		await sync.commitPush([
			{ id: record.id, type: record.type, version: 7, rev: record.rev },
		]);

		const row = await db.first<{ dirty: number; server_version: number }>(
			"SELECT dirty, server_version FROM chat_room WHERE id = ?",
			[room.id],
		);
		expect(row).toEqual({ dirty: 0, server_version: 7 });
	});

	it("edits made while a push is out **stay dirty**", async () => {
		/**
		 * The rule this test guards is the most expensive one in this file:
		 *
		 * ```text
		 * edit A → push starts → edit B → response arrives → dirty cleared unconditionally
		 * → edit B is never pushed.
		 * ```
		 */
		const room = await newRoom("Initially");
		const [record] = (await sync.collectOutbound({ limit: 10 })).records;

		await chat.renameRoom(room.id, "Later");

		await sync.commitPush([
			{ id: record.id, type: record.type, version: 3, rev: record.rev },
		]);

		const row = await db.first<{ dirty: number; server_version: number }>(
			"SELECT dirty, server_version FROM chat_room WHERE id = ?",
			[room.id],
		);
		// serverVersion advances unconditionally: the next push must send it as baseVersion.
		expect(row).toEqual({ dirty: 1, server_version: 3 });
	});

	it("confirming a vanished record passes quietly", async () => {
		await expect(
			sync.commitPush([
				{
					id: "missing-record",
					type: "chat.room",
					version: 1,
					rev: { t: 1, c: 0, d: "x" },
				},
			]),
		).resolves.toBeUndefined();
	});
});

describe("pull application", () => {
	const remoteRoom = (id: string, title: string, rev: number): ChatRoom => ({
		id,
		originStoryId: null,
		title,
		adult: false,
		promptProtected: false,
		seed: seed(title),
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: `2026-01-0${rev}T00:00:00.000Z`,
		deletedAt: null,
		dirty: 0,
		serverVersion: 0,
		rev: { t: rev, c: 0, d: "remote" },
	});

	it("creates never-seen records and advances the cursor", async () => {
		const result = await sync.applyPull({
			entries: [
				wireEntry({
					type: "chat.room",
					record: remoteRoom("r1", "Remote", 1),
					version: 4,
				}),
			],
			cursor: 11,
		});

		expect(result.applied).toBe(1);
		expect((await chat.getRoom("r1"))?.title).toBe("Remote");
		expect((await sync.readState()).cursor).toBe(11);

		const row = await db.first<{ dirty: number; server_version: number }>(
			"SELECT dirty, server_version FROM chat_room WHERE id = ?",
			["r1"],
		);
		expect(row).toEqual({ dirty: 0, server_version: 4 });
	});

	it("ignores unknown items but advances the cursor", async () => {
		const result = await sync.applyPull({
			entries: [
				{ kind: "ignored", reason: "unknown_type" },
				{ kind: "ignored", reason: "decrypt_failed" },
			],
			cursor: 5,
		});
		expect(result).toMatchObject({ applied: 0, ignored: 2 });
		// Blocking here would halt this device's sync forever on that one record.
		expect((await sync.readState()).cursor).toBe(5);
	});

	it("an old version doesn't roll back content and sets dirty", async () => {
		await sync.applyPull({
			entries: [
				wireEntry({
					type: "chat.room",
					record: remoteRoom("r1", "New version", 5),
					version: 2,
				}),
			],
			cursor: 1,
		});

		const result = await sync.applyPull({
			entries: [
				wireEntry({
					type: "chat.room",
					record: remoteRoom("r1", "old version", 2),
					version: 3,
				}),
			],
			cursor: 2,
		});

		expect(result.conflicts).toBe(1);
		expect((await chat.getRoom("r1"))?.title).toBe("New version");
		const row = await db.first<{ dirty: number }>(
			"SELECT dirty FROM chat_room WHERE id = ?",
			["r1"],
		);
		expect(row?.dirty).toBe(1);
	});

	it("already deleted locals don't revive and our tombstone stays dirty", async () => {
		const room = await newRoom("My room");
		await chat.deleteRoom(room.id);

		const result = await sync.applyPull({
			entries: [
				wireEntry({
					type: "chat.room",
					record: remoteRoom(room.id, "Remote revived it", 9),
					version: 8,
				}),
			],
			cursor: 3,
		});

		expect(await chat.getRoom(room.id)).toBeNull();
		expect(result.conflicts).toBe(1);
		const row = await db.first<{ dirty: number; server_version: number }>(
			"SELECT dirty, server_version FROM chat_room WHERE id = ?",
			[room.id],
		);
		expect(row).toEqual({ dirty: 1, server_version: 8 });
	});

	it("a room tombstone deletes messages and memories together — without raising dirty on each", async () => {
		const room = await newRoom();
		const message = await chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hi",
		});
		const memory = await chat.createMemory({
			roomId: room.id,
			content: "Memory",
		});
		await sync.commitPush(
			(await sync.collectOutbound({ limit: 50 })).records.map((r, i) => ({
				id: r.id,
				type: r.type,
				version: i + 1,
				rev: r.rev,
			})),
		);

		await sync.applyPull({
			entries: [
				tombstoneEntry({
					type: "chat.room",
					id: room.id,
					version: 20,
					serverUpdatedAt: "2026-02-02T00:00:00.000Z",
				}),
			],
			cursor: 9,
		});

		expect(await chat.getRoom(room.id)).toBeNull();
		const rows = await db.all<{
			id: string;
			deleted_at: string;
			dirty: number;
		}>(
			`SELECT id, deleted_at, dirty FROM chat_message WHERE id = ?
			 UNION ALL SELECT id, deleted_at, dirty FROM chat_memory WHERE id = ?`,
			[message.id, memory.id],
		);
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			// The deletion time is the **server time**; if each receiving device wrote its own, they would
			// diverge.
			expect(row.deleted_at).toBe("2026-02-02T00:00:00.000Z");
			expect(row.dirty).toBe(0);
		}
	});

	it("a tombstone for a never-seen record creates no row", async () => {
		await sync.applyPull({
			entries: [
				tombstoneEntry({
					type: "chat.room",
					id: "never-seen",
					version: 1,
					serverUpdatedAt: "2026-02-02T00:00:00.000Z",
				}),
			],
			cursor: 4,
		});
		const row = await db.first("SELECT id FROM chat_room WHERE id = ?", [
			"never-seen",
		]);
		expect(row).toBeNull();
	});

	it("a tombstone for a never-seen room deletes children that arrived first too — a new device's bootstrap", async () => {
		/**
		 * Child rows are deleted without their own tombstones: the server keeps their ciphertext as live
		 * rows, and a new device's bootstrap receives them **before** the room tombstone (lower seq).
		 * Skipping the tombstone because no room row exists would leave the deleted conversation's
		 * plaintext on this device only.
		 */
		const room = await newRoom("A deleted room");
		const message = await chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "A deleted line",
		});
		const memory = await chat.createMemory({
			roomId: room.id,
			content: "A deleted memory",
		});
		const character = await chat.createCharacter({
			roomId: room.id,
			name: "A deleted character",
		});
		// This device has never seen anything: records arrive only from the server.
		for (const table of [
			"chat_room",
			"chat_message",
			"chat_memory",
			"chat_character",
		])
			await db.run(`DELETE FROM ${table}`, []);

		await sync.applyPull({
			entries: [
				wireEntry({ type: "chat.message", record: message, version: 2 }),
				wireEntry({ type: "chat.memory", record: memory, version: 3 }),
				wireEntry({ type: "chat.character", record: character, version: 4 }),
				tombstoneEntry({
					type: "chat.room",
					id: room.id,
					version: 5,
					serverUpdatedAt: "2026-02-02T00:00:00.000Z",
				}),
			],
			cursor: 5,
		});

		expect(
			await db.first("SELECT id FROM chat_room WHERE id = ?", [room.id]),
		).toBeNull();
		const rows = await db.all<{ deleted_at: string | null; dirty: number }>(
			`SELECT deleted_at, dirty FROM chat_message WHERE room_id = ?
			 UNION ALL SELECT deleted_at, dirty FROM chat_memory WHERE room_id = ?
			 UNION ALL SELECT deleted_at, dirty FROM chat_character WHERE room_id = ?`,
			[room.id, room.id, room.id],
		);
		expect(rows).toHaveLength(3);
		for (const row of rows) {
			expect(row.deleted_at).toBe("2026-02-02T00:00:00.000Z");
			// Raising dirty here would push the deleted room's content back to the server.
			expect(row.dirty).toBe(0);
		}
	});

	it("a pending cover of a draft deleted remotely loses both row and file — the file after commit", async () => {
		const draft = await authoring.createDraft();
		await draftCover.stage(draft.id, {
			uri: "file:///picked.jpg",
			mimeType: "image/jpeg",
		});
		const removed: string[] = [];
		const store = createSqliteSyncStore(db, syncCodecRegistry, {
			dirName: "covers-alice",
			files: {
				remove: (dirName, fileName) => removed.push(`${dirName}/${fileName}`),
				candidates: (draftId) => [`${draftId}.png`],
			},
		});
		const tombstone = tombstoneEntry({
			type: "authoring.draft",
			id: draft.id,
			version: 7,
			serverUpdatedAt: "2026-02-02T00:00:00.000Z",
		});

		// If the transaction fails late, the row and the file both stay; a deleted file cannot be
		// restored.
		failOn = (sql) => sql.includes("INSERT INTO sync_state");
		await expect(
			store.applyPull({ entries: [tombstone], cursor: 7 }),
		).rejects.toThrow();
		failOn = null;
		expect(removed).toEqual([]);
		expect(
			await db.first(
				"SELECT draft_id FROM authoring_draft_cover WHERE draft_id = ?",
				[draft.id],
			),
		).not.toBeNull();

		await store.applyPull({ entries: [tombstone], cursor: 7 });
		expect(
			await db.first(
				"SELECT draft_id FROM authoring_draft_cover WHERE draft_id = ?",
				[draft.id],
			),
		).toBeNull();
		// The name is read from the row, not guessed from the candidates (.png).
		expect(removed).toEqual([`covers-alice/${draft.id}.jpg`]);
	});

	it("spreads duplicate order values from concurrent reordering only locally", async () => {
		const draft = await authoring.createDraft();
		const a = await authoring.createStartScene(draft.id, { title: "a" });
		const b = await authoring.createStartScene(draft.id, { title: "Me" });
		const metaOf = (id: string) =>
			db.first<{ dirty: number; rev_t: number; rev_c: number; rev_d: string }>(
				"SELECT dirty, rev_t, rev_c, rev_d FROM authoring_scene WHERE id = ?",
				[id],
			);
		const before = await metaOf(a.id);

		// The remote moved b to position 0, so both now sit at 0.
		await sync.applyPull({
			entries: [
				wireEntry({
					type: "authoring.scene",
					record: { ...b, position: 0, rev: { t: 99, c: 0, d: "remote" } },
					version: 5,
				}),
			],
			cursor: 6,
		});

		const ordered = await authoring.listStartScenes(draft.id);
		expect(ordered.map((s) => s.position)).toEqual([0, 1]);
		expect(new Set(ordered.map((s) => s.id))).toEqual(new Set([a.id, b.id]));

		/**
		 * `a` was not on this page, yet its position may have shifted (normalization). Its revision and
		 * dirty flag must not change: if they did, two devices would push each other's normalization back
		 * and forth forever. This is representation cleanup, not a user edit.
		 */
		expect(await metaOf(a.id)).toEqual(before);
	});
});

describe("atomicity", () => {
	/**
	 * This section is the reason this adapter exists.
	 *
	 * A page carries conversations and authoring together. If each domain had its own database, this
	 * check could not be written, and the failure would reach the user as a cursor that advanced while
	 * its records did not arrive, so those records would never come back.
	 */
	const crossDomainPage = () => ({
		entries: [
			wireEntry({
				type: "chat.room",
				record: {
					id: "room-x",
					originStoryId: null,
					title: "Remote room",
					adult: false,
					promptProtected: false,
					seed: seed("Remote room"),
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					deletedAt: null,
					dirty: 0 as const,
					serverVersion: 0,
					rev: { t: 1, c: 0, d: "remote" },
				},
				version: 1,
			}),
			wireEntry({
				type: "chat.message",
				record: {
					id: "message-x",
					roomId: "room-x",
					role: "user" as const,
					speaker: "",
					content: "Remote message",
					createdAt: "2026-01-01T00:00:01.000Z",
					updatedAt: "2026-01-01T00:00:01.000Z",
					deletedAt: null,
					dirty: 0 as const,
					serverVersion: 0,
					rev: { t: 2, c: 0, d: "remote" },
				},
				version: 2,
			}),
			wireEntry({
				type: "authoring.draft",
				record: {
					...(structuredClone(EMPTY_DRAFT) as typeof EMPTY_DRAFT),
					id: "draft-x",
					title: "Remote draft",
				},
				version: 3,
			}),
		],
		cursor: 77,
	});

	it("three domains of one page commit together", async () => {
		await sync.applyPull(crossDomainPage());

		expect((await chat.getRoom("room-x"))?.title).toBe("Remote room");
		expect(
			(await chat.listRecentMessages("room-x")).map((m) => m.content),
		).toEqual(["Remote message"]);
		expect((await authoring.getDraft("draft-x"))?.title).toBe("Remote draft");
		expect((await sync.readState()).cursor).toBe(77);
	});

	it("a late transaction failure leaves **nothing** and the cursor stays", async () => {
		// Fail at the draft write, the last domain in the page.
		failOn = (sql) => sql.includes("INSERT INTO authoring_draft");

		await expect(sync.applyPull(crossDomainPage())).rejects.toThrow();

		expect(await chat.getRoom("room-x")).toBeNull();
		expect(await chat.listRecentMessages("room-x")).toEqual([]);
		expect(await authoring.getDraft("draft-x")).toBeNull();
		expect((await sync.readState()).cursor).toBe(0);
	});

	it("receiving the same page again applies as is — retrying is safe", async () => {
		failOn = (sql) => sql.includes("INSERT INTO authoring_draft");
		await expect(sync.applyPull(crossDomainPage())).rejects.toThrow();

		failOn = null;
		const result = await sync.applyPull(crossDomainPage());

		expect(result.applied).toBe(3);
		expect(await chat.getRoom("room-x")).not.toBeNull();
		expect(await authoring.getDraft("draft-x")).not.toBeNull();
		expect((await sync.readState()).cursor).toBe(77);
	});
});

/** Minimal shape of a remote draft; every field the codec requires must be present. */
const EMPTY_DRAFT = {
	id: "draft-x",
	schemaVersion: 2 as const,
	title: "",
	tagline: "",
	description: "",
	tags: [] as string[],
	orientation: null,
	adult: false,
	visibility: "private" as const,
	promptProtected: false,
	prompt: "",
	defaultStartSceneId: null,
	publishedStoryId: null,
	fieldRev: {
		meta: { t: 1, c: 0, d: "remote" },
		rating: { t: 1, c: 0, d: "remote" },
		body: { t: 1, c: 0, d: "remote" },
		defaults: { t: 1, c: 0, d: "remote" },
		publication: { t: 1, c: 0, d: "remote" },
	},
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	deletedAt: null,
	dirty: 0 as const,
	serverVersion: 0,
	rev: { t: 1, c: 0, d: "remote" },
};
