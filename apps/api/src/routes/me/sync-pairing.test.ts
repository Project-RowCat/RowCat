import { SYNC_ERROR_CODE, SYNC_LIMITS } from "@rowcat/contracts";
import { nobleAead } from "@rowcat/sync/aead";
import { bytesToB64 } from "@rowcat/sync/codec";
import { generateDek } from "@rowcat/sync/crypto";
import { buildKeyring, deriveAuthKey } from "@rowcat/sync/keyring";
import {
	generatePairingCode,
	generatePairingKeyPair,
	normalizePairingCode,
	openPairingDek,
	pairingCodeHash,
	sealPairingDek,
} from "@rowcat/sync/pairing";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { sync_pairing } from "../../db/schema.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * `/v2/me/sync/pairing` — integration tests on real Postgres.
 *
 * Most of what is verified are SQL properties: that one conditional `UPDATE` enforces "first
 * approval wins", that expiry is judged in the same statement as lookup and approval, and that
 * another account's request cannot reach someone else's row with the same hash. Mocks would take
 * all of that out of the test.
 *
 * This file also covers what the server must not learn: it reads the actual row to confirm it holds
 * no code, DEK or private key, and that everything the server has (the row plus both public keys)
 * cannot open the envelope.
 */

const EMAIL_PREFIX = "sync-pairing-test-";

interface Account {
	cookie: string;
	memberId: string;
}

const signUp = (name = "Pairing test") =>
	createTestMember(EMAIL_PREFIX, { name });

const call = (
	method: string,
	path: string,
	cookie: string | null,
	body?: unknown,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/me/sync${path}`, {
			method,
			headers: {
				...(body !== undefined ? { "Content-Type": "application/json" } : {}),
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		}),
	);

const readCode = async (response: Response): Promise<string | undefined> =>
	((await response.json()) as { code?: string }).code;

interface PairingBody {
	newPublicKey: string;
	payload: string | null;
	expiresAt: string;
}

/**
 * Each side of pairing. The tests really encrypt: the server does not parse the envelope, so
 * arbitrary strings would pass and make the test meaningless, while a real envelope lets one place
 * check both that bytes through the server open and that the server cannot open them.
 */

const DEK = generateDek();

/** What the new device does: generate the code and key pair, then compute the hash. */
function newDevice(owner: string) {
	const code = generatePairingCode();
	const normalizedCode = normalizePairingCode(code);
	return {
		code,
		normalizedCode,
		codeHash: pairingCodeHash(owner, normalizedCode),
		keyPair: generatePairingKeyPair(),
	};
}

const start = (account: Account, device: ReturnType<typeof newDevice>) =>
	call("POST", "/pairing", account.cookie, {
		codeHash: device.codeHash,
		newPublicKey: device.keyPair.publicKey,
	});

const status = (account: Account, codeHash: string) =>
	call("POST", "/pairing/status", account.cookie, { codeHash });

const approve = (account: Account, codeHash: string, payload: string) =>
	call("POST", "/pairing/approve", account.cookie, { codeHash, payload });

const cancel = (account: Account, codeHash: string) =>
	call("DELETE", "/pairing", account.cookie, { codeHash });

/** What the trusted device does: seal the current DEK to the new device's public key. */
async function seal(
	owner: string,
	device: ReturnType<typeof newDevice>,
	newPublicKey: string,
	dek: Uint8Array = DEK,
): Promise<string> {
	const { payload } = await sealPairingDek({
		owner,
		normalizedCode: device.normalizedCode,
		newPublicKey,
		dek,
		aead: nobleAead,
	});
	return payload;
}

const expire = (owner: string, codeHash: string): Promise<unknown> =>
	db
		.update(sync_pairing)
		.set({ expires_at: new Date(Date.now() - 1000) })
		.where(
			and(eq(sync_pairing.owner, owner), eq(sync_pairing.code_hash, codeHash)),
		);

const row = async (owner: string, codeHash: string) => {
	const [found] = await db
		.select()
		.from(sync_pairing)
		.where(
			and(eq(sync_pairing.owner, owner), eq(sync_pairing.code_hash, codeHash)),
		)
		.limit(1);
	return found ?? null;
};

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("authorization gate", () => {
	test("a guest gets 401 on every path", async () => {
		const device = newDevice("anyone");
		expect(
			(
				await call("POST", "/pairing", null, {
					codeHash: device.codeHash,
					newPublicKey: device.keyPair.publicKey,
				})
			).status,
		).toBe(401);
		expect(
			(
				await call("POST", "/pairing/status", null, {
					codeHash: device.codeHash,
				})
			).status,
		).toBe(401);
		expect(
			(
				await call("POST", "/pairing/approve", null, {
					codeHash: device.codeHash,
					payload: "x",
				})
			).status,
		).toBe(401);
		expect(
			(await call("DELETE", "/pairing", null, { codeHash: device.codeHash }))
				.status,
		).toBe(401);
	});

	test("there is no slot for the raw code — a hash in the wrong format is a 400", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		/**
		 * The contract accepts only 64 hex characters. A client that sends the human-transcribed code
		 * (`XXXX-XXXX-…`) verbatim is blocked here; the point (§6) is that no path lets that value reach
		 * the server.
		 */
		const response = await call("POST", "/pairing", account.cookie, {
			codeHash: device.code,
			newPublicKey: device.keyPair.publicKey,
		});
		expect(response.status).toBe(400);
	});
});

describe.skipIf(!databaseReady)("lifecycle", () => {
	test("start → lookup → approve → consume → clean up", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);

		const started = await start(account, device);
		expect(started.status).toBe(200);
		const startedBody = (await started.json()) as PairingBody;
		expect(startedBody.newPublicKey).toBe(device.keyPair.publicKey);
		expect(startedBody.payload).toBeNull();
		// Expiry is decided by the server, not by a value the client sent.
		expect(Date.parse(startedBody.expiresAt)).toBeGreaterThan(Date.now());
		expect(Date.parse(startedBody.expiresAt)).toBeLessThanOrEqual(
			Date.now() + SYNC_LIMITS.pairingTtlMinutes * 60_000 + 5_000,
		);

		// The trusted device enters the code and reads the public key.
		const seen = (await (
			await status(account, device.codeHash)
		).json()) as PairingBody;
		expect(seen.newPublicKey).toBe(device.keyPair.publicKey);
		expect(seen.payload).toBeNull();

		const payload = await seal(account.memberId, device, seen.newPublicKey);
		expect((await approve(account, device.codeHash, payload)).status).toBe(204);

		// The new device polls, receives the envelope and really opens it.
		const delivered = (await (
			await status(account, device.codeHash)
		).json()) as PairingBody;
		expect(delivered.payload).toBe(payload);
		const received = await openPairingDek({
			owner: account.memberId,
			normalizedCode: device.normalizedCode,
			privateKey: device.keyPair.privateKey,
			payload: delivered.payload as string,
			aead: nobleAead,
		});
		expect(bytesToB64(received)).toBe(bytesToB64(DEK));

		// Deleted only after consumption.
		expect((await cancel(account, device.codeHash)).status).toBe(204);
		expect(await row(account.memberId, device.codeHash)).toBeNull();
		expect((await status(account, device.codeHash)).status).toBe(404);
	});

	test("lookup **does not consume** the payload — re-polling after a lost response gets the same envelope", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		await start(account, device);
		const payload = await seal(
			account.memberId,
			device,
			device.keyPair.publicKey,
		);
		await approve(account, device.codeHash, payload);

		for (let i = 0; i < 3; i++) {
			const body = (await (
				await status(account, device.codeHash)
			).json()) as PairingBody;
			expect(body.payload).toBe(payload);
		}
	});

	test("cancelling only closes the relay — looking it up again finds nothing", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		await start(account, device);
		expect((await cancel(account, device.codeHash)).status).toBe(204);
		expect(await readCode(await status(account, device.codeHash))).toBe(
			SYNC_ERROR_CODE.pairingNotFound,
		);
	});

	test("cancelling is idempotent — closing a missing session is a 204", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		expect((await cancel(account, device.codeHash)).status).toBe(204);
		expect((await cancel(account, device.codeHash)).status).toBe(204);
	});

	test("an expired session **is the same as a missing one**", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		await start(account, device);
		await expire(account.memberId, device.codeHash);

		expect(await readCode(await status(account, device.codeHash))).toBe(
			SYNC_ERROR_CODE.pairingNotFound,
		);
		const payload = await seal(
			account.memberId,
			device,
			device.keyPair.publicKey,
		);
		expect(
			await readCode(await approve(account, device.codeHash, payload)),
		).toBe(SYNC_ERROR_CODE.pairingNotFound);
	});

	test("the next start clears expired rows — the same code can be used again", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		await start(account, device);
		await expire(account.memberId, device.codeHash);
		// Expired-row cleanup is in the same transaction, so the same hash can start again.
		expect((await start(account, device)).status).toBe(200);
	});

	test("there is a cap on in-progress sessions", async () => {
		const account = await signUp();
		for (let i = 0; i < SYNC_LIMITS.pairingMaxActive; i++)
			expect((await start(account, newDevice(account.memberId))).status).toBe(
				200,
			);
		const overflow = await start(account, newDevice(account.memberId));
		expect(overflow.status).toBe(429);
		expect(await readCode(overflow)).toBe(SYNC_ERROR_CODE.pairingTooMany);
	});
});

describe.skipIf(!databaseReady)("owner isolation", () => {
	test("Alice's session isn't visible to Bob — even knowing the hash", async () => {
		/**
		 * The most important test in this file. Bob is handed Alice's whole `codeHash` and still sees
		 * nothing, because sessions are looked up only in the namespace of the owner taken from the
		 * session. The request has no slot for an owner, which is what that property rests on.
		 */
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");
		const device = newDevice(alice.memberId);
		await start(alice, device);

		expect(await readCode(await status(bob, device.codeHash))).toBe(
			SYNC_ERROR_CODE.pairingNotFound,
		);
		expect(
			await readCode(await approve(bob, device.codeHash, "hijack attempt")),
		).toBe(SYNC_ERROR_CODE.pairingNotFound);
		// Bob's cancel does not touch Alice's row either (an idempotent 204 that deletes nothing).
		expect((await cancel(bob, device.codeHash)).status).toBe(204);
		expect(await row(alice.memberId, device.codeHash)).not.toBeNull();
	});

	test("the same code under a different account is a different hash", async () => {
		const alice = await signUp("Alice");
		const bob = await signUp("Bob");
		const code = generatePairingCode();
		const compact = normalizePairingCode(code);
		expect(pairingCodeHash(alice.memberId, compact)).not.toBe(
			pairingCodeHash(bob.memberId, compact),
		);
	});
});

describe.skipIf(!databaseReady)("races", () => {
	test("starting twice with the same hash makes the second lose", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		expect((await start(account, device)).status).toBe(200);
		const again = await start(account, device);
		expect(again.status).toBe(409);
		expect(await readCode(again)).toBe(SYNC_ERROR_CODE.pairingExists);
		// The first public key stays; a later request cannot swap it.
		const stored = await row(account.memberId, device.codeHash);
		expect(stored?.new_pub).toBe(device.keyPair.publicKey);
	});

	test("when two trusted devices approve at once, **only the first** remains", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		await start(account, device);
		const first = await seal(
			account.memberId,
			device,
			device.keyPair.publicKey,
		);
		const second = await seal(
			account.memberId,
			device,
			device.keyPair.publicKey,
		);
		expect(first).not.toBe(second); // One-time key pairs differ every time.

		const [a, b] = await Promise.all([
			approve(account, device.codeHash, first),
			approve(account, device.codeHash, second),
		]);
		const statuses = [a.status, b.status].sort();
		expect(statuses).toEqual([204, 409]);

		const stored = await row(account.memberId, device.codeHash);
		expect([first, second]).toContain(stored?.payload);
		/**
		 * The point is that a late approval does not overwrite the envelope. Overwriting would make the
		 * server's envelope differ from the one the new device already took, and the next poll would
		 * fetch a value that cannot be opened.
		 */
		const loser = stored?.payload === first ? second : first;
		expect(stored?.payload).not.toBe(loser);
	});

	test("even when approval and cancellation race, there is one result", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		await start(account, device);
		const payload = await seal(
			account.memberId,
			device,
			device.keyPair.publicKey,
		);

		const [approved, cancelled] = await Promise.all([
			approve(account, device.codeHash, payload),
			cancel(account, device.codeHash),
		]);
		expect(cancelled.status).toBe(204);
		expect([204, 404]).toContain(approved.status);
		/**
		 * Whichever order commits, only two states are reachable: the row is gone (cancel committed
		 * later) or the approved row remains. "Approved, row gone, yet the new device receives an
		 * envelope" is unrepresentable, since lookup reads the same row.
		 */
		const stored = await row(account.memberId, device.codeHash);
		if (stored) expect(stored.payload).toBe(payload);
	});

	test("when expiry and approval overlap, approval loses", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		await start(account, device);
		await expire(account.memberId, device.codeHash);
		const payload = await seal(
			account.memberId,
			device,
			device.keyPair.publicKey,
		);
		expect(
			await readCode(await approve(account, device.codeHash, payload)),
		).toBe(SYNC_ERROR_CODE.pairingNotFound);
		// An expired row never gets an envelope attached.
		expect((await row(account.memberId, device.codeHash))?.payload).toBeNull();
	});

	test("after consumption the same code can't be used again", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		await start(account, device);
		const payload = await seal(
			account.memberId,
			device,
			device.keyPair.publicKey,
		);
		await approve(account, device.codeHash, payload);
		await cancel(account, device.codeHash);

		// Replay: re-uploading the old envelope finds no session to attach to.
		expect(
			await readCode(await approve(account, device.codeHash, payload)),
		).toBe(SYNC_ERROR_CODE.pairingNotFound);
		expect(await readCode(await status(account, device.codeHash))).toBe(
			SYNC_ERROR_CODE.pairingNotFound,
		);
	});
});

describe.skipIf(!databaseReady)("zero knowledge", () => {
	test("the server row has no code, DEK or private key", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		await start(account, device);
		const payload = await seal(
			account.memberId,
			device,
			device.keyPair.publicKey,
		);
		await approve(account, device.codeHash, payload);

		const stored = await row(account.memberId, device.codeHash);
		expect(stored).not.toBeNull();
		/**
		 * Counts the whole column set. A subtractive check blocks only today's columns and would miss one
		 * added later for convenience (device name, last seen).
		 */
		expect(Object.keys(stored as object).sort()).toEqual([
			"code_hash",
			"created_at",
			"expires_at",
			"new_pub",
			"owner",
			"payload",
		]);

		const dump = JSON.stringify(stored);
		for (const secret of [
			device.code,
			device.normalizedCode,
			device.normalizedCode.toLowerCase(),
			bytesToB64(DEK),
			bytesToB64(device.keyPair.privateKey),
		])
			expect(dump).not.toContain(secret);
	});

	test("everything the server holds still can't open the envelope", async () => {
		const account = await signUp();
		const device = newDevice(account.memberId);
		await start(account, device);
		const payload = await seal(
			account.memberId,
			device,
			device.keyPair.publicKey,
		);
		await approve(account, device.codeHash, payload);

		const stored = await row(account.memberId, device.codeHash);
		/**
		 * What the server knows: owner, code hash, the new device's public key and the envelope. It can
		 * make its own key pair freely, and nothing it can do with that opens the envelope; that is the
		 * whole protocol.
		 */
		const attacker = generatePairingKeyPair();
		await expect(
			openPairingDek({
				owner: account.memberId,
				normalizedCode: device.normalizedCode,
				privateKey: attacker.privateKey,
				payload: stored?.payload as string,
				aead: nobleAead,
			}),
		).rejects.toThrow();

		/**
		 * Without the code the envelope stays closed even with the private key (channel binding). The
		 * server has neither, but this pins that leaking either one alone is still safe.
		 */
		await expect(
			openPairingDek({
				owner: account.memberId,
				normalizedCode: normalizePairingCode(generatePairingCode()),
				privateKey: device.keyPair.privateKey,
				payload: stored?.payload as string,
				aead: nobleAead,
			}),
		).rejects.toThrow();
	});

	test("the server doesn't change the keyring through pairing", async () => {
		/**
		 * Pairing distributes the key, it does not change it (§27). The server's keyring string must not
		 * change by a character across approval, or another device that was offline would silently drop
		 * off the account.
		 */
		const account = await signUp();
		const built = await buildKeyring(account.memberId, DEK, nobleAead);
		await call("POST", "/keyring", account.cookie, {
			keyring: built.keyring,
			authKey: bytesToB64(deriveAuthKey(DEK, account.memberId)),
		});
		const before = (await (
			await call("GET", "/keyring", account.cookie)
		).json()) as { keyring: string | null };

		const device = newDevice(account.memberId);
		await start(account, device);
		await approve(
			account,
			device.codeHash,
			await seal(account.memberId, device, device.keyPair.publicKey),
		);
		await cancel(account, device.codeHash);

		const after = (await (
			await call("GET", "/keyring", account.cookie)
		).json()) as { keyring: string | null };
		expect(after.keyring).toBe(before.keyring);
		expect(after.keyring).toBe(built.keyring);
	});
});
