import type { PullRecord, PushItem } from "@rowcat/contracts/sync";
import type { SyncTransport } from "@rowcat/sync";
import { b64ToBytes, verifyKeyringProof } from "@rowcat/sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type {
	LocalScopeController,
	MobileLocalScope,
} from "../local-data/activation.ts";
import type {
	MobileLifecycleSource,
	MobileNetworkSource,
} from "./auto-sync.ts";
import { createMobileSyncRuntime, type MobileSyncRuntime } from "./runtime.ts";

/**
 * Runs the real sync runtime assembly. Only the server is faked (an in-memory relay): the
 * controller, engine, keyring, pairing envelope and codecs are the shared packages' real
 * implementations, and the store is real SQLite. Passing here means setup, recovery code, pairing
 * and convergence between two devices actually run through this app's assembly.
 */

const ALICE = "alice-viewer-id";

/** Sources that never emit signals. This file covers the controller path only; signals are in `auto-sync.test.ts`. */
const idleLifecycle: MobileLifecycleSource = {
	current: () => "active",
	subscribe: () => () => {},
};
const idleNetwork: MobileNetworkSource = {
	current: () => true,
	subscribe: () => () => {},
};

/**
 * Fake server: one owner's keyring, records and pairing relay. Errors use the real server's `{
 * status, code }` shape, which is what `syncFailureOf` reads. Proof verification is the shared
 * package's server entry point (`verifyKeyringProof`); no second verifier is written here.
 */
function createFakeSyncServer() {
	let keyring: { value: string; authKey: string } | null = null;
	const rows = new Map<
		string,
		{
			type: string;
			ciphertext: string | null;
			envelope: number;
			version: number;
			seq: number;
			deleted: boolean;
		}
	>();
	let seq = 0;
	const pairings = new Map<
		string,
		{ newPublicKey: string; payload: string | null; expiresAt: string }
	>();

	const transport: SyncTransport = {
		async getKeyring() {
			return { keyring: keyring?.value ?? null };
		},
		async setupKeyring(input) {
			if (keyring) throw { status: 409, code: "sync_keyring_exists" };
			keyring = { value: input.keyring, authKey: input.authKey };
			return { keyring: input.keyring };
		},
		async rewrapKeyring(input) {
			if (!keyring) throw { status: 404, code: "sync_keyring_missing" };
			if (
				!verifyKeyringProof(
					b64ToBytes(keyring.authKey),
					input.keyring,
					input.proof,
				)
			)
				throw { status: 403, code: "sync_keyring_proof_invalid" };
			keyring = { value: input.keyring, authKey: keyring.authKey };
			return { keyring: input.keyring };
		},
		async resetKeyring() {
			keyring = null;
		},
		async verifyKeyring(input) {
			if (!keyring) throw { status: 404, code: "sync_keyring_missing" };
			return verifyKeyringProof(
				b64ToBytes(keyring.authKey),
				input.keyring,
				input.proof,
			);
		},
		async pull(input) {
			const records: PullRecord[] = [...rows.entries()]
				.filter(([, row]) => row.seq > input.since)
				.sort(([, a], [, b]) => a.seq - b.seq)
				.map(([id, row]) => ({
					id,
					type: row.type as PullRecord["type"],
					ciphertext: row.ciphertext,
					envelope: row.envelope,
					version: row.version,
					seq: row.seq,
					deleted: row.deleted,
					serverUpdatedAt: new Date(0).toISOString(),
				}));
			return { records, cursor: seq, hasMore: false };
		},
		async push(input) {
			const conflicts = input.items
				.filter((item: PushItem) => {
					const current = rows.get(item.id)?.version ?? 0;
					return item.baseVersion !== current;
				})
				.map((item: PushItem) => ({
					id: item.id,
					serverVersion: rows.get(item.id)?.version ?? 0,
				}));
			if (conflicts.length > 0) return { ok: false, cursor: seq, conflicts };
			for (const item of input.items) {
				const current = rows.get(item.id)?.version ?? 0;
				rows.set(item.id, {
					type: item.type,
					ciphertext: item.ciphertext,
					envelope: item.envelope,
					version: current + 1,
					seq: ++seq,
					deleted: item.deleted,
				});
			}
			return { ok: true, cursor: seq, conflicts: [] };
		},
		async startPairing(input) {
			if (pairings.has(input.codeHash))
				throw { status: 409, code: "sync_pairing_exists" };
			const session = {
				newPublicKey: input.newPublicKey,
				payload: null,
				expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
			};
			pairings.set(input.codeHash, session);
			return { ...session };
		},
		async readPairing(input) {
			const session = pairings.get(input.codeHash);
			if (!session) throw { status: 404, code: "sync_pairing_not_found" };
			return { ...session };
		},
		async approvePairing(input) {
			const session = pairings.get(input.codeHash);
			if (!session) throw { status: 404, code: "sync_pairing_not_found" };
			if (session.payload !== null)
				throw { status: 409, code: "sync_pairing_already_approved" };
			session.payload = input.payload;
		},
		async cancelPairing(input) {
			pairings.delete(input.codeHash);
		},
	};

	return { transport, rowCount: () => rows.size };
}

interface Device {
	temp: ReturnType<typeof createTempDirectory>;
	controller: LocalScopeController;
	scope: MobileLocalScope;
	runtime: MobileSyncRuntime;
	ownsFlag: { value: boolean };
}

let devices: Device[] = [];

async function openDevice(
	server: ReturnType<typeof createFakeSyncServer>,
	viewerId = ALICE,
): Promise<Device> {
	const temp = createTempDirectory();
	const controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	const scope = await controller.activate(viewerId);
	const ownsFlag = { value: true };
	const runtime = createMobileSyncRuntime({
		scope,
		/** Same ownership axis as the product: instance identity. Tests flip `ownsFlag` to simulate a switch. */
		ownsScope: (candidate) =>
			ownsFlag.value && controller.current() === candidate,
		transport: server.transport,
		lifecycle: idleLifecycle,
		network: idleNetwork,
	});
	const device = { temp, controller, scope, runtime, ownsFlag };
	devices.push(device);
	return device;
}

beforeEach(() => {
	devices = [];
});

afterEach(async () => {
	for (const device of devices) {
		device.runtime.autoSync.stop();
		await device.controller.release();
		device.temp.dispose();
	}
});

describe("Settings", () => {
	it("setup issues a recovery code once and becomes trusted", async () => {
		const server = createFakeSyncServer();
		const device = await openDevice(server);

		const issued = await device.runtime.controller.setup();
		expect(issued).not.toBeNull();
		expect(issued?.recoveryCode.length).toBeGreaterThan(10);

		const snapshot = device.runtime.controller.snapshot();
		expect(snapshot.trusted).toBe(true);
		expect(snapshot.state).toBe("ready");
		/** The device remembered the key; auto-unlock on the next launch relies on it. */
		expect(await device.scope.stores.deviceKey.recall()).not.toBeNull();
	});

	it("the side that lost the setup race doesn't invent a code and goes to locked", async () => {
		const server = createFakeSyncServer();
		const first = await openDevice(server);
		const second = await openDevice(server);

		await first.runtime.controller.setup();
		const lost = await second.runtime.controller.setup();

		expect(lost).toBeNull();
		const snapshot = second.runtime.controller.snapshot();
		expect(snapshot.state).toBe("locked");
		expect(snapshot.trusted).toBe(false);
		/** The losing side's key material was discarded; using it with the winning keyring would fork the account. */
		expect(await second.scope.stores.deviceKey.recall()).toBeNull();
	});
});

describe("Recovery code", () => {
	it("the right code unlocks, and a wrong code remembers nothing", async () => {
		const server = createFakeSyncServer();
		const first = await openDevice(server);
		const issued = await first.runtime.controller.setup();
		const code = issued?.recoveryCode ?? "";

		const second = await openDevice(server);
		await second.runtime.controller.inspect();
		expect(second.runtime.controller.snapshot().state).toBe("locked");

		/** Wrong code: throws, stays locked, no key remembered. */
		await expect(
			second.runtime.controller.unlock("RCAT-0000-0000-0000-0000-0000-0000"),
		).rejects.toThrow();
		expect(second.runtime.controller.snapshot().state).toBe("locked");
		expect(await second.scope.stores.deviceKey.recall()).toBeNull();

		/** Correct code: becomes trusted and the key is remembered. */
		await second.runtime.controller.unlock(code);
		expect(second.runtime.controller.snapshot().trusted).toBe(true);
		expect(await second.scope.stores.deviceKey.recall()).toEqual(
			await first.scope.stores.deviceKey.recall(),
		);
	});

	it("after reissuing the old code dies and only the new one lives — key and data stay", async () => {
		const server = createFakeSyncServer();
		const first = await openDevice(server);
		const original =
			(await first.runtime.controller.setup())?.recoveryCode ?? "";

		const rotated = await first.runtime.controller.rotateRecoveryCode();
		expect(rotated.recoveryCode).not.toBe(original);

		const second = await openDevice(server);
		await second.runtime.controller.inspect();
		await expect(second.runtime.controller.unlock(original)).rejects.toThrow();
		await second.runtime.controller.unlock(rotated.recoveryCode);
		expect(second.runtime.controller.snapshot().trusted).toBe(true);
	});
});

describe("Stop trusting this device", () => {
	it("forgets only the key — local conversations and server data stay", async () => {
		const server = createFakeSyncServer();
		const device = await openDevice(server);
		await device.runtime.controller.setup();
		await device.scope.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("A remaining room"),
			title: "A remaining room",
		});
		await device.runtime.controller.syncNow();
		const serverRows = server.rowCount();
		expect(serverRows).toBeGreaterThan(0);

		await device.runtime.controller.forgetDevice();

		expect(device.runtime.controller.snapshot().state).toBe("locked");
		expect(await device.scope.stores.deviceKey.recall()).toBeNull();
		/** Local conversations remain: forgetting trust is not deletion. */
		expect(
			(await device.scope.stores.chat.listRooms()).map((r) => r.title),
		).toEqual(["A remaining room"]);
		/** Server ciphertext is untouched too. */
		expect(server.rowCount()).toBe(serverRows);
	});
});

describe("device pairing", () => {
	it("a trusted device's approval opens the new device, and the conversation really crosses over", async () => {
		const server = createFakeSyncServer();
		const first = await openDevice(server);
		await first.runtime.controller.setup();
		await first.scope.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("A room that crosses over"),
			title: "A room that crosses over",
		});
		await first.runtime.controller.syncNow();

		const second = await openDevice(server);
		await second.runtime.controller.inspect();
		const session = await second.runtime.controller.startPairing();
		expect(await session.poll()).toBe("pending");

		await first.runtime.controller.approvePairing(session.code);
		expect(await session.poll()).toBe("paired");
		expect(second.runtime.controller.snapshot().trusted).toBe(true);

		/** Same byte format: the ciphertext the first device uploaded opens on the second device. */
		await second.runtime.controller.syncNow();
		expect(
			(await second.scope.stores.chat.listRooms()).map((r) => r.title),
		).toEqual(["A room that crosses over"]);
	});

	it("a locked device can't approve — signing in alone can't hand over the key", async () => {
		const server = createFakeSyncServer();
		const first = await openDevice(server);
		await first.runtime.controller.setup();

		const locked = await openDevice(server);
		await locked.runtime.controller.inspect();
		const pairing = await openDevice(server);
		await pairing.runtime.controller.inspect();
		const session = await pairing.runtime.controller.startPairing();

		await expect(
			locked.runtime.controller.approvePairing(session.code),
		).rejects.toThrow();
		expect(await session.poll()).toBe("pending");
	});

	it("losing the scope while polling remembers nothing", async () => {
		const server = createFakeSyncServer();
		const first = await openDevice(server);
		await first.runtime.controller.setup();

		const second = await openDevice(server);
		await second.runtime.controller.inspect();
		const session = await second.runtime.controller.startPairing();
		await first.runtime.controller.approvePairing(session.code);

		/** The approval arrived, then the account changed (e.g. sign-out) before it was consumed. */
		second.ownsFlag.value = false;
		expect(await session.poll()).toBe("pending");
		expect(await second.scope.stores.deviceKey.recall()).toBeNull();
		expect(second.runtime.controller.snapshot().trusted).toBe(false);
	});
});

describe("ownership", () => {
	it("manual sync of a runtime that lost its scope doesn't run", async () => {
		const server = createFakeSyncServer();
		const device = await openDevice(server);
		await device.runtime.controller.setup();
		device.runtime.autoSync.start();

		device.ownsFlag.value = false;
		const outcome = await device.runtime.autoSync.runManualSync();
		expect(outcome.status).toBe("skipped");
	});

	it("re-signing in as the same member doesn't revive the old runtime either — the decision axis is the instance", async () => {
		const server = createFakeSyncServer();
		const device = await openDevice(server);
		await device.runtime.controller.setup();
		device.runtime.autoSync.start();

		/** Alice, sign out, Alice again: the member id is the same; only the scope instance changes. */
		await device.controller.release();
		const reopened = await device.controller.activate(ALICE);
		expect(reopened).not.toBe(device.scope);

		/** The old runtime does not belong to the new scope, so no run is created. */
		const outcome = await device.runtime.autoSync.runManualSync();
		expect(outcome.status).toBe("skipped");
	});
});
