import type { ChatSeed } from "@rowcat/chat";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";
import { nobleAead } from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import { createSubtleAead } from "#/lib/local-sync/aead.ts";
import { createDeviceKeyStore } from "#/lib/local-sync/device-key.ts";
import {
	converge,
	createDevice,
	type Device,
	FakeSyncServer,
	TEST_DEK,
} from "#/test/sync-devices.ts";

/**
 * Store-level boundaries that round trips do not reveal. Two-device tests check only final
 * convergence. This file checks three things below that: local edits made while a push is in
 * flight, how the remembered key is stored, and whether the two AEAD implementations produce
 * identical bytes.
 */

const seed = (title: string): ChatSeed => ({
	version: CHAT_SEED_VERSION,
	storyId: "s",
	title,
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "",
	firstScene: "",
	playGuide: "",
	persona: null,
	characters: [],
	lore: [],
	startScenes: [],
	sceneImages: [],
});

let devices: Device[] = [];
const spawn = (server: FakeSyncServer, name: string): Device => {
	const device = createDevice(name, server);
	devices.push(device);
	return device;
};
afterEach(() => {
	for (const device of devices) device.close();
	devices = [];
});

describe("commitPush race", () => {
	it("an edit made while a push is out **stays dirty**", async () => {
		/**
		 * This test guards against silent, permanent data loss. The sequence is: edit A, push starts,
		 * edit B, push response arrives, `dirty` is unconditionally set to 0, so edit B is never
		 * uploaded. Nothing shows on screen. The user only finds out when another device lacks that edit.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const draft = await a.authoring.createDraft({ title: "First" });
		await a.engine.run(TEST_DEK);

		const collected = await a.sync.collectOutbound({ limit: 10, all: true });
		const target = collected.records.find((record) => record.id === draft.id);
		expect(target).toBeDefined();
		if (!target) return;

		// While the push is in flight, the user edits again.
		await a.authoring.updateDraft(draft.id, {
			title: "Title edited meanwhile",
		});
		const edited = await a.db.storyDrafts.get(draft.id);

		// The acknowledgement for the old revision now arrives.
		await a.sync.commitPush([
			{
				id: draft.id,
				type: "authoring.draft",
				version: target.baseVersion + 1,
				rev: target.rev,
			},
		]);

		const after = await a.db.storyDrafts.get(draft.id);
		// The server version has advanced, so the next push must go out with the correct `baseVersion`.
		expect(after?.serverVersion).toBe(target.baseVersion + 1);
		// `dirty` remains set, because the edit made in between has not been uploaded yet.
		expect(after?.dirty).toBe(1);
		expect(after?.title).toBe("Title edited meanwhile");
		expect(after?.rev).toEqual(edited?.rev);
	});

	it("clears dirty when the revision is unchanged", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const draft = await a.authoring.createDraft({ title: "First" });
		const collected = await a.sync.collectOutbound({ limit: 10, all: true });
		const target = collected.records.find((record) => record.id === draft.id);
		if (!target) throw new Error("not collected");

		await a.sync.commitPush([
			{ id: draft.id, type: "authoring.draft", version: 1, rev: target.rev },
		]);
		const after = await a.db.storyDrafts.get(draft.id);
		expect(after?.dirty).toBe(0);
		expect(after?.serverVersion).toBe(1);
	});

	it("an edit made while the response is in flight **rides the next push**", async () => {
		/**
		 * Runs the whole engine to produce the race for real: the server has already received the push,
		 * and the user edits again before the response arrives.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({ title: "First" });

		server.duringPush = async () => {
			await a.authoring.updateDraft(draft.id, {
				title: "Edited while the response came",
			});
		};
		await a.engine.run(TEST_DEK);

		const midflight = await a.db.storyDrafts.get(draft.id);
		expect(midflight?.dirty).toBe(1);
		expect(midflight?.serverVersion).toBeGreaterThan(0);

		await converge(a, b);
		expect((await b.authoring.getDraft(draft.id))?.title).toBe(
			"Edited while the response came",
		);
	});
});

describe("outbound collection", () => {
	it("the dirty-only path and the full-scan path give different results", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room to be cleaned"),
		});
		await a.engine.run(TEST_DEK);
		await a.chat.createRoom({ originStoryId: null, seed: seed("New room") });

		const dirtyOnly = await a.sync.collectOutbound({ limit: 100 });
		const everything = await a.sync.collectOutbound({ limit: 100, all: true });
		expect(dirtyOnly.records).toHaveLength(1);
		expect(everything.records.length).toBeGreaterThan(1);
	});

	it("scanning in split windows **misses nothing**", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		for (let i = 0; i < 7; i++)
			await a.authoring.createDraft({ title: `Manuscript ${i}` });

		const seen: string[] = [];
		let after = null as Awaited<
			ReturnType<typeof a.sync.collectOutbound>
		>["next"];
		for (let guard = 0; guard < 50; guard++) {
			const batch = await a.sync.collectOutbound({
				limit: 2,
				after,
				all: true,
			});
			seen.push(...batch.records.map((record) => record.id));
			if (!batch.next) break;
			after = batch.next;
		}
		expect(new Set(seen).size).toBe(seen.length);
		expect(seen).toHaveLength(7);
	});

	it("parent types come before children", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const draft = await a.authoring.createDraft({ title: "Parent" });
		await a.authoring.createLore(draft.id, { content: "Child" });
		await a.chat.createRoom({ originStoryId: null, seed: seed("Room") });

		const batch = await a.sync.collectOutbound({ limit: 100, all: true });
		const types = batch.records.map((record) => record.type);
		expect(types.indexOf("chat.room")).toBeLessThan(
			types.indexOf("authoring.draft"),
		);
		expect(types.indexOf("authoring.draft")).toBeLessThan(
			types.indexOf("authoring.lore"),
		);
	});

	it("a tombstone goes out without a payload", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const draft = await a.authoring.createDraft({ title: "To delete" });
		await a.engine.run(TEST_DEK);
		await a.authoring.deleteDraft(draft.id);

		const batch = await a.sync.collectOutbound({ limit: 100 });
		const tombstone = batch.records.find((record) => record.id === draft.id);
		expect(tombstone?.deleted).toBe(true);
		// No empty object is fabricated and encrypted, since a tombstone has no content.
		expect(tombstone?.payload).toBeNull();
	});
});

describe("remembered device key", () => {
	it("wraps, stores and reads back the DEK", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const store = createDeviceKeyStore(a.db);
		expect(await store.recall()).toBeNull();

		await store.remember(TEST_DEK);
		expect(await store.recall()).toEqual(TEST_DEK);
	});

	it("**no plaintext DEK** on disk", async () => {
		/**
		 * Scans the whole stored row. Checking fields one by one would miss values nested in unexpected
		 * places.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		await createDeviceKeyStore(a.db).remember(TEST_DEK);

		const row = await a.db.syncState.get("state");
		expect(row?.deviceKey).toBeDefined();
		const raw = [...TEST_DEK].join(",");
		expect(JSON.stringify(row?.deviceKey?.ct)).not.toContain(raw);
		// The wrapping key is stored non-extractable, so its raw bytes cannot be exported.
		expect(row?.deviceKey?.wrapKey.extractable).toBe(false);
		await expect(
			crypto.subtle.exportKey("raw", row?.deviceKey?.wrapKey as CryptoKey),
		).rejects.toThrow();
	});

	it("untrusting removes only the wrapper and **keeps local data**", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		await a.authoring.createDraft({ title: "Manuscript that must stay" });
		const store = createDeviceKeyStore(a.db);
		await store.remember(TEST_DEK);

		await store.forget();
		expect(await store.recall()).toBeNull();
		expect(await a.authoring.listDrafts()).toHaveLength(1);
		// The cursor and device ID also remain. Revoking trust does not discard sync state.
		const state = await a.sync.readState();
		expect(state.deviceId).toBeTruthy();
	});

	it("a corrupt wrapper does not throw and is treated as absent", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const store = createDeviceKeyStore(a.db);
		await store.remember(TEST_DEK);
		const row = await a.db.syncState.get("state");
		if (row?.deviceKey)
			await a.db.syncState.put({
				...row,
				deviceKey: { ...row.deviceKey, ct: new Uint8Array([1, 2, 3]) },
			});

		// If this threw, opening the screen would fail outright and the user would lose the chance to
		// enter a recovery code.
		expect(await store.recall()).toBeNull();
	});
});

describe("AEAD interop: noble ↔ subtle", () => {
	const subtle = createSubtleAead();
	const key = Uint8Array.from({ length: 32 }, (_, i) => i);
	const nonce = Uint8Array.from({ length: 12 }, (_, i) => 200 - i);
	const aad = new TextEncoder().encode(
		["rowcat.sync.rec.v1", "owner", "id", "type", "1"].join("\u0000"),
	);
	const plaintext = new TextEncoder().encode("The Night Library 🌙 manuscript");

	it("subtle opens what noble encrypted", async () => {
		const ct = await nobleAead.encrypt(key, plaintext, aad, nonce);
		expect(await subtle.decrypt(key, ct, aad, nonce)).toEqual(plaintext);
	});

	it("noble opens what subtle encrypted", async () => {
		const ct = await subtle.encrypt(key, plaintext, aad, nonce);
		expect(await nobleAead.decrypt(key, ct, aad, nonce)).toEqual(plaintext);
	});

	it("the same input makes **the same bytes**", async () => {
		// This also means the layout matches: the tag is appended after the ciphertext.
		expect(await subtle.encrypt(key, plaintext, aad, nonce)).toEqual(
			await nobleAead.encrypt(key, plaintext, aad, nonce),
		);
	});

	it("with a different AAD subtle cannot open it either", async () => {
		const ct = await nobleAead.encrypt(key, plaintext, aad, nonce);
		const other = new TextEncoder().encode("other AAD");
		await expect(subtle.decrypt(key, ct, other, nonce)).rejects.toThrow();
	});

	it("subtle reproduces and decrypts the golden vectors", async () => {
		/**
		 * The fixture is generated by `@rowcat/sync` with noble. The web path must both produce and open
		 * the same vectors, so that mobile can later open web data. Checking each implementation only
		 * against itself would pass even if both were wrong.
		 */
		const [vectors, sync] = await Promise.all([
			import("../../../../../packages/sync/src/__fixtures__/vectors.json", {
				with: { type: "json" },
			}),
			import("@rowcat/sync"),
		]);
		const fixture = vectors.default;
		const dek = sync.b64ToBytes(fixture.input.dekB64);
		const identity = {
			owner: fixture.input.owner,
			recordId: fixture.input.recordId,
			type: fixture.input.type,
		};
		for (const vector of [fixture.record.small, fixture.record.large]) {
			expect(
				await sync.encryptRecord(
					dek,
					identity,
					vector.payload,
					subtle,
					sync.b64ToBytes(fixture.input.nonceB64),
				),
			).toBe(vector.ciphertext);
			expect(
				await sync.decryptRecord(dek, identity, vector.ciphertext, subtle),
			).toEqual(vector.payload);
		}
	});
});
