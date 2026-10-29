import { SYNC_ERROR_CODE } from "@rowcat/contracts";
import type { DeviceKeyStore, SyncStore, SyncTransport } from "@rowcat/sync";
import {
	b64ToBytes,
	createSyncController,
	deriveAuthKey,
	nobleAead,
	proveKeyring,
	unlockWithRecovery,
	verifyKeyringProof,
} from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import { createDeviceKeyStore } from "#/lib/local-sync/device-key.ts";
import { syncCodecRegistry } from "#/lib/local-sync/registry.ts";
import {
	createDevice,
	type Device,
	FakeSyncServer,
} from "#/test/sync-devices.ts";

/**
 * Controller: the lock state machine. The tests check keys, not records.
 *
 * The most costly case is a setup race. Two devices both see 'sync is not set up' and each creates
 * a key. If the losing device keeps using its own key, the data it uploads cannot be opened on any
 * device.
 */

const OWNER = "0123456789abcdef0123456789abcdef";

/**
 * In-memory fake server that also handles the keyring. It imitates the real server's
 * first-writer-only rule and its proof verification.
 */
class FakeKeyServer {
	keyring: string | null = null;
	authKey: Uint8Array | null = null;
	/**
	 * Makes the next request fail with a network error. This must stay distinct from a confirmed
	 * mismatch.
	 */
	failNext = false;
	/**
	 * Fails only the possession check. The keyring lookup succeeds, but the proof of possession cannot
	 * be verified.
	 */
	failVerifyNext = false;
	verifyCalls = 0;

	private guard(): void {
		if (!this.failNext) return;
		this.failNext = false;
		throw Object.assign(new Error("network failure"), {
			status: 0,
			code: "offline",
		});
	}

	transport(): SyncTransport {
		const unsupported = (): never => {
			throw new Error("this harness covers only the keyring paths");
		};
		return {
			getKeyring: async () => {
				this.guard();
				return { keyring: this.keyring };
			},
			setupKeyring: async (input) => {
				this.guard();
				if (this.keyring !== null)
					throw Object.assign(new Error("already exists"), {
						status: 409,
						code: SYNC_ERROR_CODE.keyringExists,
					});
				this.keyring = input.keyring;
				this.authKey = b64ToBytes(input.authKey);
				return { keyring: this.keyring };
			},
			rewrapKeyring: async (input) => {
				this.guard();
				if (
					!this.authKey ||
					!verifyKeyringProof(this.authKey, input.keyring, input.proof)
				)
					throw Object.assign(new Error("proof mismatch"), {
						status: 403,
						code: SYNC_ERROR_CODE.keyringProofInvalid,
					});
				this.keyring = input.keyring;
				return { keyring: this.keyring };
			},
			resetKeyring: async () => {
				this.guard();
				this.keyring = null;
				this.authKey = null;
			},
			verifyKeyring: async (input) => {
				this.guard();
				if (this.failVerifyNext) {
					this.failVerifyNext = false;
					throw Object.assign(new Error("network failure"), {
						status: 0,
						code: "offline",
					});
				}
				this.verifyCalls += 1;
				return (
					this.authKey !== null &&
					verifyKeyringProof(this.authKey, input.keyring, input.proof)
				);
			},
			pull: async (input) => ({
				records: [],
				cursor: input.since,
				hasMore: false,
			}),
			push: async () => ({ ok: true, cursor: 0, conflicts: [] }),
			/*
			 * This fake models only the keyring. Its pairing methods throw rather than pass silently, so a
			 * call that reaches the pairing path fails loudly. Tests of pairing set up their own harness in
			 * `lib/local-sync/pairing-devices.test.ts`.
			 */
			startPairing: unsupported,
			readPairing: unsupported,
			approvePairing: unsupported,
			cancelPairing: unsupported,
		};
	}
}

let devices: Device[] = [];
const spawn = (name: string): Device => {
	const device = createDevice(name, new FakeSyncServer());
	devices.push(device);
	return device;
};
afterEach(() => {
	for (const device of devices) device.close();
	devices = [];
});

/**
 * Time is injected, so the test owns the clock. With `Date.now()`, tests running in the same
 * millisecond would be indistinguishable, and a case where clocks disagree could not be reproduced.
 */
let tick = 0;
const advance = (): number => {
	tick += 1000;
	return tick;
};
const clock = {
	nowIso: () => new Date(1_700_000_000_000 + advance()).toISOString(),
	nowMs: () => tick,
};

function controllerFor(
	device: Device,
	server: FakeKeyServer,
	options: { deviceKey?: DeviceKeyStore; ownsStore?: () => boolean } = {},
) {
	return createSyncController({
		owner: OWNER,
		registry: syncCodecRegistry,
		store: device.sync as SyncStore,
		transport: server.transport(),
		aead: nobleAead,
		deviceKey: options.deviceKey ?? createDeviceKeyStore(device.db),
		clock,
		...(options.ownsStore ? { ownsStore: options.ownsStore } : {}),
	});
}

describe("setup", () => {
	it("the first device creates the keyring and hands out the recovery code **once**", async () => {
		const server = new FakeKeyServer();
		const a = spawn("a");
		const controller = controllerFor(a, server);

		await controller.inspect();
		expect(controller.snapshot().state).toBe("disabled");

		const issued = await controller.setup();
		expect(issued?.recoveryCode).toMatch(/^RCAT-/);
		expect(controller.snapshot().state).toBe("ready");
		expect(controller.snapshot().trusted).toBe(true);
		expect(server.keyring).not.toBeNull();
		// Setup also finishes the bootstrap sync. After that, the manual button runs routine sync.
		expect(controller.snapshot().initialSyncDone).toBe(true);
	});

	it("**the loser of a concurrent setup discards its own key and locks**", async () => {
		/**
		 * This test is the reason this file exists. If the loser keeps using its DEK, the data that
		 * device uploads becomes an account that neither the winning key nor the losing key can fully
		 * open.
		 */
		const server = new FakeKeyServer();
		const a = spawn("a");
		const b = spawn("b");
		const first = controllerFor(a, server);
		const second = controllerFor(b, server);

		await first.inspect();
		await second.inspect();
		expect(first.snapshot().state).toBe("disabled");
		expect(second.snapshot().state).toBe("disabled");

		const winner = await first.setup();
		expect(winner).not.toBeNull();
		const winningKeyring = server.keyring;

		const loser = await second.setup();
		// The losing side receives no recovery code, because a code from the losing run could not open
		// any data.
		expect(loser).toBeNull();
		expect(second.snapshot().state).toBe("locked");
		expect(second.snapshot().trusted).toBe(false);
		expect(server.keyring).toBe(winningKeyring);

		if (!winner) return;
		await second.unlock(winner.recoveryCode);
		expect(second.snapshot().state).toBe("ready");
	});
});

describe("unlock", () => {
	it("opens with the recovery code and trusts this device", async () => {
		const server = new FakeKeyServer();
		const a = spawn("a");
		const b = spawn("b");
		const issued = await controllerFor(a, server).setup();
		if (!issued) throw new Error("setup failed");

		const second = controllerFor(b, server);
		await second.inspect();
		expect(second.snapshot().state).toBe("locked");

		await second.unlock(issued.recoveryCode);
		expect(second.snapshot().state).toBe("ready");
		expect(second.snapshot().trusted).toBe(true);
		if (!server.keyring) throw new Error("no keyring");
		expect(
			await unlockWithRecovery(
				OWNER,
				server.keyring,
				issued.recoveryCode,
				nobleAead,
			),
		).toBeDefined();
	});

	it("a wrong code throws and the state stays locked", async () => {
		const server = new FakeKeyServer();
		const a = spawn("a");
		const b = spawn("b");
		await controllerFor(a, server).setup();
		const second = controllerFor(b, server);
		await second.inspect();

		await expect(
			second.unlock("RCAT-0000-0000-0000-0000-0000-0000-0000"),
		).rejects.toThrow();
		expect(second.snapshot().state).toBe("locked");
		expect(second.snapshot().trusted).toBe(false);
	});
});

describe("remembered device", () => {
	it("reopening unlocks automatically after the proof", async () => {
		const server = new FakeKeyServer();
		const a = spawn("a");
		const deviceKey = createDeviceKeyStore(a.db);
		await controllerFor(a, server, { deviceKey }).setup();

		// A new controller stands in for a page reload. The in-memory DEK is gone and only the wrapper
		// remains.
		const reopened = controllerFor(a, server, { deviceKey });
		await reopened.inspect();
		expect(reopened.snapshot().state).toBe("ready");
		expect(reopened.snapshot().trusted).toBe(true);
		// The keyring is verified against the server, not trusted as stored.
		expect(server.verifyCalls).toBeGreaterThan(0);
	});

	it("a definite proof mismatch discards the wrapper and locks", async () => {
		const server = new FakeKeyServer();
		const a = spawn("a");
		const deviceKey = createDeviceKeyStore(a.db);
		await controllerFor(a, server, { deviceKey }).setup();

		// Another device has replaced the key. This is the cross-account or stale-material case.
		server.authKey = deriveAuthKey(
			Uint8Array.from({ length: 32 }, () => 9),
			OWNER,
		);

		const reopened = controllerFor(a, server, { deviceKey });
		await reopened.inspect();
		expect(reopened.snapshot().state).toBe("locked");
		expect(reopened.snapshot().trusted).toBe(false);
		expect(await deviceKey.recall()).toBeNull();
	});

	it("**a network failure does not erase trust**", async () => {
		/**
		 * Folding a confirmed mismatch and 'could not verify' into one result would force a user who
		 * failed once offline (for example, on a plane) to hunt for the recovery code again. The local
		 * data is already on this device, so locking while offline gains nothing.
		 */
		const server = new FakeKeyServer();
		const a = spawn("a");
		const deviceKey = createDeviceKeyStore(a.db);
		await controllerFor(a, server, { deviceKey }).setup();

		const reopened = controllerFor(a, server, { deviceKey });
		server.failVerifyNext = true;
		await reopened.inspect();
		expect(reopened.snapshot().state).toBe("ready");
		expect(await deviceKey.recall()).not.toBeNull();
	});

	it("with no keyring on the server the remaining wrapper is stale and discarded", async () => {
		const server = new FakeKeyServer();
		const a = spawn("a");
		const deviceKey = createDeviceKeyStore(a.db);
		await controllerFor(a, server, { deviceKey }).setup();
		// The server has no keyring matching this wrapper. A wrapper with no matching keyring cannot open
		// any data.
		server.keyring = null;
		server.authKey = null;

		const reopened = controllerFor(a, server, { deviceKey });
		await reopened.inspect();
		expect(reopened.snapshot().state).toBe("disabled");
		expect(await deviceKey.recall()).toBeNull();
	});

	it("forgetting the device changes **local state only**", async () => {
		const server = new FakeKeyServer();
		const a = spawn("a");
		const deviceKey = createDeviceKeyStore(a.db);
		await a.authoring.createDraft({ title: "a manuscript that must remain" });
		const controller = controllerFor(a, server, { deviceKey });
		await controller.setup();
		const keyringBefore = server.keyring;

		await controller.forgetDevice();
		expect(controller.snapshot().state).toBe("locked");
		expect(controller.snapshot().trusted).toBe(false);
		expect(await deviceKey.recall()).toBeNull();
		expect(server.keyring).toBe(keyringBefore);
		expect(await a.authoring.listDrafts()).toHaveLength(1);
		expect(await controller.syncNow()).toBeNull();
	});

	/**
	 * Reset is the exit for an account that is locked with no key. The server keyring is deleted and
	 * this device forgets its key, but local data stays. Setting up again starts over with a new key.
	 */
	it("reset erases the server data and the key, keeps local data, and can be set up again", async () => {
		const server = new FakeKeyServer();
		const a = spawn("a");
		const deviceKey = createDeviceKeyStore(a.db);
		await a.authoring.createDraft({ title: "a manuscript that must remain" });
		const controller = controllerFor(a, server, { deviceKey });
		await controller.setup();
		const keyringBefore = server.keyring;

		await controller.reset();
		expect(controller.snapshot().state).toBe("disabled");
		expect(controller.snapshot().trusted).toBe(false);
		expect(server.keyring).toBeNull();
		expect(await deviceKey.recall()).toBeNull();
		expect(await a.authoring.listDrafts()).toHaveLength(1);
		expect((await a.sync.readState()).initialSyncDone).toBe(false);

		const issued = await controller.setup();
		expect(issued?.recoveryCode).toBeTruthy();
		expect(server.keyring).not.toBeNull();
		expect(server.keyring).not.toBe(keyringBefore);
		expect(controller.snapshot().trusted).toBe(true);
	});
});

describe("recovery code rotation", () => {
	it("the DEK is unchanged and the old code becomes invalid", async () => {
		const server = new FakeKeyServer();
		const a = spawn("a");
		const controller = controllerFor(a, server);
		const first = await controller.setup();
		if (!first) throw new Error("setup failed");
		const authKeyBefore = server.authKey;

		const rotated = await controller.rotateRecoveryCode();
		expect(rotated.recoveryCode).not.toBe(first.recoveryCode);
		// An unchanged `auth_key` means the DEK is unchanged too.
		expect(server.authKey).toBe(authKeyBefore);

		if (!server.keyring) throw new Error("no keyring");
		await expect(
			unlockWithRecovery(OWNER, server.keyring, first.recoveryCode, nobleAead),
		).rejects.toThrow();
		expect(
			await unlockWithRecovery(
				OWNER,
				server.keyring,
				rotated.recoveryCode,
				nobleAead,
			),
		).toBeDefined();
	});

	it("a locked device cannot rotate", async () => {
		const server = new FakeKeyServer();
		const a = spawn("a");
		const b = spawn("b");
		await controllerFor(a, server).setup();
		const locked = controllerFor(b, server);
		await locked.inspect();
		await expect(locked.rotateRecoveryCode()).rejects.toThrow();
	});

	it("the server rejects a replacement without proof", async () => {
		const server = new FakeKeyServer();
		const a = spawn("a");
		await controllerFor(a, server).setup();
		if (!server.keyring || !server.authKey) throw new Error("no keyring");
		const foreign = proveKeyring(
			deriveAuthKey(
				Uint8Array.from({ length: 32 }, () => 3),
				OWNER,
			),
			server.keyring,
		);
		await expect(
			server
				.transport()
				.rewrapKeyring({ keyring: server.keyring, proof: foreign }),
		).rejects.toThrow();
	});
});

describe("account switch", () => {
	it("does not write locally after ownership moved", async () => {
		const server = new FakeKeyServer();
		const a = spawn("a");
		let owns = true;
		const controller = controllerFor(a, server, { ownsStore: () => owns });
		await controller.setup();

		owns = false;
		// Without ownership, sync ends quietly. That is not an error.
		const result = await controller.syncNow();
		expect(result?.abandoned ?? true).toBe(true);
	});
});
