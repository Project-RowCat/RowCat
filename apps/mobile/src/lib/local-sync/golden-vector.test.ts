import type { ChatRoom } from "@rowcat/chat";
import { SYNC_ENVELOPE_VERSION } from "@rowcat/contracts/sync";
import {
	b64ToBytes,
	bytesToB64,
	decryptRecord,
	encryptRecord,
	nobleAead,
	recordAad,
	unlockWithRecovery,
} from "@rowcat/sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
/**
 * **The golden vector is read-only.** If this test breaks, the fix belongs in the mobile adapter,
 * not in the fixture this file points at. Changing those values would make ciphertext already on
 * the server unopenable.
 *
 * The relative path is used because that fixture belongs to **another package**. A copy brought
 * into mobile would no longer be the same vector, and on the day the two copies diverge this test
 * would keep passing while compatibility is lost.
 */
import vectors from "../../../../../packages/sync/src/__fixtures__/vectors.json" with {
	type: "json",
};
import { seed } from "../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController } from "../local-data/activation.ts";
import { syncCodecRegistry } from "./registry.ts";

/**
 * Golden vector → shared crypto/codec → **mobile SQLite** → product state.
 *
 * What mobile has to prove is not "our SQLite runs" but **that mobile opens ciphertext the web
 * produced, and that the opened value reaches the same product state**. So this uses the vector
 * that locks the protocol itself, not a mobile-specific fixture.
 *
 * Mobile uses `nobleAead` (the counterpart of the web's `crypto.subtle` adapter). The two
 * implementations share the same byte format, and the first section below re-confirms that
 * equivalence in this runtime. Hermes has no WebCrypto, so the pure JS path is the **only** path.
 */

const OWNER = vectors.input.owner;
const IDENTITY = {
	owner: OWNER,
	recordId: vectors.input.recordId,
	type: vectors.input.type,
};
const DEK = b64ToBytes(vectors.input.dekB64);
const NONCE = b64ToBytes(vectors.input.nonceB64);

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;

beforeEach(() => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

describe("envelope spec", () => {
	it("the envelope version and AAD composition are unchanged", () => {
		expect(SYNC_ENVELOPE_VERSION).toBe(1);
		expect(bytesToB64(recordAad({ ...IDENTITY, envelopeVersion: 1 }))).toBe(
			vectors.record.aadB64,
		);
	});

	it.each([
		["short (uncompressed) vector", vectors.record.small],
		["long (DEFLATE) vector", vectors.record.large],
	])("noble AEAD opens %s", async (_label, vector) => {
		expect(
			await decryptRecord(DEK, IDENTITY, vector.ciphertext, nobleAead),
		).toEqual(vector.payload);
	});

	it.each([
		["short (uncompressed) vector", vectors.record.small],
		["long (DEFLATE) vector", vectors.record.large],
	])("rebuilds %s's ciphertext bytes exactly", async (_label, vector) => {
		expect(
			await encryptRecord(DEK, IDENTITY, vector.payload, nobleAead, NONCE),
		).toBe(vector.ciphertext);
	});

	it("the recovery code returns that DEK", async () => {
		const unlocked = await unlockWithRecovery(
			OWNER,
			vectors.keyring.keyring,
			vectors.keyring.recoveryCode,
			nobleAead,
		);
		expect(bytesToB64(unlocked)).toBe(vectors.input.dekB64);
	});
});

describe("vector → SQLite", () => {
	/**
	 * The fixture's `data` is a **minimal fragment** that exists to lock the protocol (just `{ title
	 * }`), so it does not pass the `chat.room` codec's validation. That is the first check in this
	 * section: such a record is **ignored and the cursor must still advance.** Blocking it would let
	 * one record from an older format halt this device's sync forever.
	 */
	it("a vector the codec rejected is ignored and the cursor advances", async () => {
		const scope = await controller.activate("alice");
		const payload = (await decryptRecord(
			DEK,
			IDENTITY,
			vectors.record.small.ciphertext,
			nobleAead,
		)) as {
			schemaVersion: number;
			rev: { t: number; c: number; d: string };
			deletedAt: string | null;
			data: unknown;
		};

		const codec = syncCodecRegistry.get(vectors.input.type);
		expect(codec).not.toBeNull();
		expect(
			codec?.decode({
				id: vectors.input.recordId,
				schemaVersion: payload.schemaVersion,
				rev: payload.rev,
				deletedAt: payload.deletedAt,
				data: payload.data,
			}),
		).toBeNull();

		const result = await scope.stores.sync.applyPull({
			entries: [{ kind: "ignored", reason: "invalid_payload" }],
			cursor: 31,
		});

		expect(result).toMatchObject({ applied: 0, ignored: 1 });
		expect((await scope.stores.sync.readState()).cursor).toBe(31);
		expect(await scope.stores.chat.listRooms()).toEqual([]);
	});

	/**
	 * Then run the same path to the end with a **complete record**: use the vector's DEK, nonce, owner
	 * and record identity, going through encryption, decryption, codec decode and SQLite apply. The
	 * product state here must match what the web produces. The same codec, the same merge and the same
	 * contract are the basis of that equivalence, and this test confirms that SQLite is the last link
	 * in that chain.
	 */
	it("an intact record passes through the envelope and becomes product state in SQLite", async () => {
		const scope = await controller.activate("alice");
		const codec = syncCodecRegistry.get("chat.room");
		if (!codec) throw new Error("no chat.room codec");

		const remote: ChatRoom = {
			id: vectors.input.recordId,
			originStoryId: "story-1",
			title: "The Night Library",
			adult: false,
			promptProtected: false,
			seed: seed("The Night Library"),
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
			deletedAt: null,
			dirty: 0,
			serverVersion: 0,
			rev: { t: 1_700, c: 2, d: "device-a" },
		};

		const ciphertext = await encryptRecord(
			DEK,
			IDENTITY,
			{
				schemaVersion: codec.schemaVersion,
				rev: remote.rev,
				deletedAt: null,
				data: codec.encode(remote),
			},
			nobleAead,
			NONCE,
		);
		// Same input and same nonce give the same bytes. If they diverge, the envelope spec has changed.
		expect(
			await encryptRecord(
				DEK,
				IDENTITY,
				{
					schemaVersion: codec.schemaVersion,
					rev: remote.rev,
					deletedAt: null,
					data: codec.encode(remote),
				},
				nobleAead,
				NONCE,
			),
		).toBe(ciphertext);

		const payload = (await decryptRecord(
			DEK,
			IDENTITY,
			ciphertext,
			nobleAead,
		)) as {
			schemaVersion: number;
			rev: { t: number; c: number; d: string };
			deletedAt: string | null;
			data: unknown;
		};
		const decoded = codec.decode({
			id: vectors.input.recordId,
			schemaVersion: payload.schemaVersion,
			rev: payload.rev,
			deletedAt: payload.deletedAt,
			data: payload.data,
		});
		if (!decoded) throw new Error("the codec rejected an intact record");

		await scope.stores.sync.applyPull({
			entries: [
				{
					kind: "record",
					id: vectors.input.recordId,
					type: "chat.room",
					version: 12,
					serverUpdatedAt: remote.updatedAt,
					rev: payload.rev,
					remote: decoded,
					merge: (local, context) => codec.merge(local, decoded, context),
				},
			],
			cursor: 99,
			markInitialSyncDone: true,
		});

		const stored = await scope.stores.chat.getRoom(vectors.input.recordId);
		expect(stored).toEqual({
			...remote,
			// The server-provided version is attached, and a record that came from remote is clean.
			serverVersion: 12,
			dirty: 0,
		});
		// The playback snapshot survives a round trip through JSON, DEFLATE and SQLite with the same
		// value.
		expect(stored?.seed).toEqual(remote.seed);

		const state = await scope.stores.sync.readState();
		expect(state.cursor).toBe(99);
		expect(state.initialSyncDone).toBe(true);
	});
});
