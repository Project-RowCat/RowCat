import type { ChatSeed } from "@rowcat/chat";
import { CHAT_SEED_VERSION, SYNC_ERROR_CODE } from "@rowcat/contracts";
import type { SyncController } from "@rowcat/sync";
import {
	createSyncController,
	generatePairingCode,
	generatePairingKeyPair,
	nobleAead,
	normalizePairingCode,
	pairingCodeHash,
	sealPairingDek,
} from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import { nowIso } from "#/lib/local-data/clock.ts";
import { createDeviceKeyStore } from "#/lib/local-sync/device-key.ts";
import { syncCodecRegistry } from "#/lib/local-sync/registry.ts";
import {
	createDevice,
	createFakeTransport,
	type Device,
	FakeAccountServer,
	FakeSyncServer,
} from "#/test/sync-devices.ts";

/**
 * Pairing: two devices, no React.
 *
 * The question this file answers: can a new device see the previous device's conversations and
 * drafts without the user ever typing the recovery code? It also checks what must hold along the
 * way. A wrong key is not remembered. An approval that arrives after the account changed does not
 * sit in another account's store. A consumed code is never used again.
 *
 * Server-side rules (expiry, approval races, owner isolation) are checked separately against real
 * Postgres (apps/api/src/routes/me/sync-pairing.test.ts). The doubles here exist to run the client.
 * They are not the server's specification.
 */

const OWNER = "0123456789abcdef0123456789abcdef";

const seed = (title: string): ChatSeed => ({
	version: CHAT_SEED_VERSION,
	storyId: "story-1",
	title,
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "Scenario",
	firstScene: "",
	playGuide: "",
	persona: null,
	characters: [],
	lore: [],
	startScenes: [],
	sceneImages: [],
});

let devices: Device[] = [];

interface Harness {
	device: Device;
	controller: SyncController;
	/** Whether this device still belongs to the active scope. Simulates account switching. */
	setOwned(owned: boolean): void;
}

function spawn(
	name: string,
	records: FakeSyncServer,
	account: FakeAccountServer,
): Harness {
	let owned = true;
	const device = createDevice(name, records, { ownsStore: () => owned });
	devices.push(device);
	let tick = 0;
	const controller = createSyncController({
		owner: OWNER,
		registry: syncCodecRegistry,
		store: device.sync,
		transport: createFakeTransport(records, account),
		aead: nobleAead,
		deviceKey: createDeviceKeyStore(device.db),
		clock: {
			nowIso: () => nowIso(),
			nowMs: () => {
				tick += 1000;
				return tick;
			},
		},
		ownsStore: () => owned,
	});
	return {
		device,
		controller,
		setOwned: (next) => {
			owned = next;
		},
	};
}

afterEach(() => {
	for (const device of devices) device.close();
	devices = [];
});

/** While the new device waits, the trusted device enters the code and approves. */
async function approveOn(trusted: SyncController, code: string): Promise<void> {
	await trusted.approvePairing(code);
}

describe("pairing: a new device without the recovery code", () => {
	it("A's conversations, drafts and memories arrive at B as is", async () => {
		const records = new FakeSyncServer();
		const account = new FakeAccountServer();
		const a = spawn("a", records, account);
		const b = spawn("b", records, account);

		const issued = await a.controller.setup();
		expect(issued).not.toBeNull();
		const room = await a.device.chat.createRoom({
			originStoryId: null,
			seed: seed("The Night Library"),
		});
		await a.device.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Talking to the librarian",
		});
		await a.device.chat.createMemory({
			roomId: room.id,
			content: "The librarian's name is Yuri",
		});
		await a.device.authoring.createDraft({ title: "First draft" });
		await a.controller.syncNow();

		await b.controller.inspect();
		expect(b.controller.snapshot().state).toBe("locked");
		expect(b.controller.snapshot().trusted).toBe(false);

		const session = await b.controller.startPairing();
		expect(session.code).toMatch(
			/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/,
		);
		// No approval yet. Polling waits quietly and returns 'pending' instead of failing.
		expect(await session.poll()).toBe("pending");

		await approveOn(a.controller, session.code);
		expect(await session.poll()).toBe("paired");

		expect(b.controller.snapshot().trusted).toBe(true);
		expect(b.controller.snapshot().state).toBe("ready");
		expect(account.pairings.size).toBe(0);

		await b.controller.syncNow();
		const rooms = await b.device.chat.listRooms();
		expect(rooms.map((row) => row.title)).toEqual(["The Night Library"]);
		expect(
			(await b.device.chat.listRecentMessages(room.id)).map(
				(row) => row.content,
			),
		).toEqual(["Talking to the librarian"]);
		expect(
			(await b.device.chat.listMemories(room.id)).map((row) => row.content),
		).toEqual(["The librarian's name is Yuri"]);
		expect(
			(await b.device.authoring.listDrafts()).map((row) => row.title),
		).toEqual(["First draft"]);

		/**
		 * The recovery code is never used. B never calls unlock(). This is the slice's core product
		 * promise.
		 */
		expect(issued?.recoveryCode).toBeTruthy();
	});

	it("after pairing it converges both ways", async () => {
		const records = new FakeSyncServer();
		const account = new FakeAccountServer();
		const a = spawn("a", records, account);
		const b = spawn("b", records, account);
		await a.controller.setup();
		await b.controller.inspect();

		const session = await b.controller.startPairing();
		await approveOn(a.controller, session.code);
		expect(await session.poll()).toBe("paired");

		// Data created on B also reaches A. Pairing only distributes the key. It does not create the
		// direction of sync.
		const room = await b.device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room B opened"),
		});
		await b.controller.syncNow();
		await a.controller.syncNow();
		expect((await a.device.chat.listRooms()).map((r) => r.id)).toContain(
			room.id,
		);
	});

	it("pairing changes neither the keyring nor the DEK", async () => {
		const records = new FakeSyncServer();
		const account = new FakeAccountServer();
		const a = spawn("a", records, account);
		const b = spawn("b", records, account);
		await a.controller.setup();
		const keyringBefore = account.keyring;
		const authKeyBefore = account.authKey;

		await b.controller.inspect();
		const session = await b.controller.startPairing();
		await approveOn(a.controller, session.code);
		await session.poll();

		/**
		 * Not one character may change. If it did, a third device that is offline right now would
		 * silently fall out of the account, and nobody would learn that until that device turned back on.
		 */
		expect(account.keyring).toBe(keyringBefore);
		expect(account.authKey).toBe(authKeyBefore);
		expect(a.controller.snapshot().trusted).toBe(true);
	});
});

describe("pairing: refusals and boundaries", () => {
	it("a wrong key **is not remembered**", async () => {
		const records = new FakeSyncServer();
		const account = new FakeAccountServer();
		const a = spawn("a", records, account);
		const b = spawn("b", records, account);
		await a.controller.setup();
		await b.controller.inspect();

		const session = await b.controller.startPairing();
		/**
		 * The attacker (or a mistaken device) uploads a different DEK, sealed correctly with the code.
		 * The envelope opens, because the code and the public key match. The key still cannot open this
		 * account's keyring, so it must be rejected.
		 */
		const normalizedCode = normalizePairingCode(session.code);
		const codeHash = pairingCodeHash(OWNER, normalizedCode);
		const relayed = account.readPairing(codeHash);
		const { payload } = await sealPairingDek({
			owner: OWNER,
			normalizedCode,
			newPublicKey: relayed.newPublicKey,
			dek: new Uint8Array(32).fill(7),
			aead: nobleAead,
		});
		account.approvePairing({ codeHash, payload });

		await expect(session.poll()).rejects.toMatchObject({
			name: "PairingKeyRejectedError",
			code: SYNC_ERROR_CODE.pairingKeyRejected,
		});

		expect(b.controller.snapshot().trusted).toBe(false);
		expect(await createDeviceKeyStore(b.device.db).recall()).toBeNull();
		// The server was actually asked to verify the key. Trust is not granted just because the envelope
		// opened.
		expect(account.verifyCalls).toBeGreaterThan(0);
	});

	it("an envelope with a different code does not open", async () => {
		const records = new FakeSyncServer();
		const account = new FakeAccountServer();
		const a = spawn("a", records, account);
		const b = spawn("b", records, account);
		await a.controller.setup();
		await b.controller.inspect();

		const session = await b.controller.startPairing();
		const codeHash = pairingCodeHash(OWNER, normalizePairingCode(session.code));
		const relayed = account.readPairing(codeHash);
		// The server plants, into that session, an envelope sealed under a different code.
		const { payload } = await sealPairingDek({
			owner: OWNER,
			normalizedCode: normalizePairingCode(generatePairingCode()),
			newPublicKey: relayed.newPublicKey,
			dek: new Uint8Array(32).fill(3),
			aead: nobleAead,
		});
		account.approvePairing({ codeHash, payload });

		await expect(session.poll()).rejects.toThrow();
		expect(b.controller.snapshot().trusted).toBe(false);
	});

	it("even if the server swaps the public key, the new device cannot open it", async () => {
		const records = new FakeSyncServer();
		const account = new FakeAccountServer();
		const a = spawn("a", records, account);
		const b = spawn("b", records, account);
		await a.controller.setup();
		await b.controller.inspect();

		const session = await b.controller.startPairing();
		const codeHash = pairingCodeHash(OWNER, normalizePairingCode(session.code));
		/**
		 * The strongest move a man-in-the-middle server can make is to swap in its own public key for the
		 * new device, so the trusted device seals the DEK to the server's key. It would then obtain the
		 * DEK, but it does not: without the code it does not know, it cannot derive K.
		 */
		const attacker = generatePairingKeyPair();
		const row = account.pairings.get(codeHash);
		expect(row).toBeDefined();
		if (row) row.newPub = attacker.publicKey;

		await approveOn(a.controller, session.code);
		// The new device cannot open it with its own private key, because the envelope was sealed to the
		// attacker's key.
		await expect(session.poll()).rejects.toThrow();
		expect(b.controller.snapshot().trusted).toBe(false);
	});

	it("a locked device cannot approve", async () => {
		const records = new FakeSyncServer();
		const account = new FakeAccountServer();
		const a = spawn("a", records, account);
		const b = spawn("b", records, account);
		const c = spawn("c", records, account);
		await a.controller.setup();
		await b.controller.inspect();
		await c.controller.inspect();

		const session = await c.controller.startPairing();
		/**
		 * B is logged in but has no key, so there is nothing to hand over. Approval itself must be
		 * impossible. If this check lived only in the UI, it would leak the day another entry point
		 * appears.
		 */
		await expect(b.controller.approvePairing(session.code)).rejects.toThrow(
			SYNC_ERROR_CODE.locked,
		);
	});

	it("a consumed code is not reused", async () => {
		const records = new FakeSyncServer();
		const account = new FakeAccountServer();
		const a = spawn("a", records, account);
		const b = spawn("b", records, account);
		await a.controller.setup();
		await b.controller.inspect();

		const session = await b.controller.startPairing();
		await approveOn(a.controller, session.code);
		expect(await session.poll()).toBe("paired");

		// The relay is closed, so the same code can no longer do anything.
		await expect(
			a.controller.approvePairing(session.code),
		).rejects.toMatchObject({ code: SYNC_ERROR_CODE.pairingNotFound });
		await expect(session.poll()).rejects.toMatchObject({
			code: SYNC_ERROR_CODE.pairingNotFound,
		});
	});

	it("cancelling closes only the relay; keyring and trust stay", async () => {
		const records = new FakeSyncServer();
		const account = new FakeAccountServer();
		const a = spawn("a", records, account);
		const b = spawn("b", records, account);
		await a.controller.setup();
		await b.controller.inspect();

		const session = await b.controller.startPairing();
		await session.cancel();
		expect(account.pairings.size).toBe(0);
		expect(account.keyring).not.toBeNull();
		expect(a.controller.snapshot().trusted).toBe(true);
		expect(b.controller.snapshot().trusted).toBe(false);
	});
});

describe("pairing: account switch", () => {
	it("an approval arriving after the scope changed **is not remembered**", async () => {
		/**
		 * Scenario: Alice leaves pairing open and logs out, then Bob logs in. A poll still in flight
		 * picks up Alice's envelope. If that key landed in Bob's local storage, Bob would decrypt Alice's
		 * data.
		 *
		 * The defense is the ownership check that already exists (ownsStore). Pairing must not add a
		 * second check of its own.
		 */
		const records = new FakeSyncServer();
		const account = new FakeAccountServer();
		const a = spawn("a", records, account);
		const b = spawn("b", records, account);
		await a.controller.setup();
		await b.controller.inspect();

		const session = await b.controller.startPairing();
		await approveOn(a.controller, session.code);

		b.setOwned(false);

		expect(await session.poll()).toBe("pending");
		expect(b.controller.snapshot().trusted).toBe(false);
		expect(await createDeviceKeyStore(b.device.db).recall()).toBeNull();
		// The relay is not closed either, since nothing consumed it.
		expect(account.pairings.size).toBe(1);
	});
});
