import type { KeyringDto } from "@rowcat/contracts/sync";
import { SYNC_ERROR_CODE, SYNC_LIMITS } from "@rowcat/contracts/sync";
import { describe, expect, it } from "vitest";
import { nobleAead } from "./aead.ts";
import { bytesToB64 } from "./codec.ts";
import { generateDek } from "./crypto.ts";
import { buildKeyring, deriveAuthKey, verifyKeyringProof } from "./keyring.ts";
import {
	normalizePairingCode,
	pairingCodeHash,
	sealPairingDek,
} from "./pairing.ts";
import {
	PairingKeyRejectedError,
	type PairingRunnerTransport,
	startPairingRun,
} from "./pairing-runner.ts";

/**
 * The order the receiving side follows. This file guards one thing from §20: an opened value is not
 * a trusted value. Nothing that has not passed the keyring check may come out by any path.
 *
 * The cryptographic properties (channel binding by code, the server cannot open it, tamper
 * detection) are tested in pairing.test.ts. This file covers the procedure built on top, so its
 * focus is rejection and failure.
 */

const OWNER = "0123456789abcdef0123456789abcdef";

/**
 * Test double for the relay: four relay operations plus the keyring and authKey. It imitates only
 * the real server's decisions.
 */
class FakeRelay implements PairingRunnerTransport {
	keyring: string | null = null;
	authKey: Uint8Array | null = null;
	verifyCalls = 0;
	now = () => Date.now();
	readonly rows = new Map<
		string,
		{ newPub: string; payload: string | null; expiresAt: number }
	>();
	failNextRead: Error | null = null;

	private live(codeHash: string) {
		const row = this.rows.get(codeHash);
		if (!row) return null;
		return row.expiresAt <= this.now() ? null : row;
	}

	private notFound(): never {
		throw Object.assign(new Error("no pairing"), {
			status: 404,
			code: SYNC_ERROR_CODE.pairingNotFound,
		});
	}

	async getKeyring(): Promise<KeyringDto> {
		return { keyring: this.keyring };
	}

	async verifyKeyring(input: {
		keyring: string;
		proof: string;
	}): Promise<boolean> {
		this.verifyCalls += 1;
		return (
			this.authKey !== null &&
			verifyKeyringProof(this.authKey, input.keyring, input.proof)
		);
	}

	async startPairing(input: { codeHash: string; newPublicKey: string }) {
		const row = {
			newPub: input.newPublicKey,
			payload: null as string | null,
			expiresAt: this.now() + SYNC_LIMITS.pairingTtlMinutes * 60_000,
		};
		this.rows.set(input.codeHash, row);
		return {
			newPublicKey: row.newPub,
			payload: row.payload,
			expiresAt: new Date(row.expiresAt).toISOString(),
		};
	}

	async readPairing(input: { codeHash: string }) {
		if (this.failNextRead !== null) {
			const error = this.failNextRead;
			this.failNextRead = null;
			throw error;
		}
		const row = this.live(input.codeHash);
		if (!row) this.notFound();
		return {
			newPublicKey: row.newPub,
			payload: row.payload,
			expiresAt: new Date(row.expiresAt).toISOString(),
		};
	}

	async approvePairing(input: { codeHash: string; payload: string }) {
		const row = this.live(input.codeHash);
		if (!row) this.notFound();
		if (row.payload !== null)
			throw Object.assign(new Error("already approved"), {
				status: 409,
				code: SYNC_ERROR_CODE.pairingAlreadyApproved,
			});
		row.payload = input.payload;
	}

	async cancelPairing(input: { codeHash: string }) {
		this.rows.delete(input.codeHash);
	}
}

/** What a trusted device does: it receives the code and seals the DEK for the new device. */
async function approveFrom(
	relay: FakeRelay,
	owner: string,
	code: string,
	dek: Uint8Array,
): Promise<void> {
	const normalizedCode = normalizePairingCode(code);
	const codeHash = pairingCodeHash(owner, normalizedCode);
	const session = await relay.readPairing({ codeHash });
	const { payload } = await sealPairingDek({
		owner,
		normalizedCode,
		newPublicKey: session.newPublicKey,
		dek,
		aead: nobleAead,
	});
	await relay.approvePairing({ codeHash, payload });
}

async function enableSync(relay: FakeRelay, owner: string) {
	const dek = generateDek();
	const built = await buildKeyring(owner, dek, nobleAead);
	relay.keyring = built.keyring;
	relay.authKey = deriveAuthKey(dek, owner);
	return dek;
}

describe("normal path", () => {
	it("the key crosses over without ever asking for the recovery code", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);

		const run = await startPairingRun({
			owner: OWNER,
			transport: relay,
			aead: nobleAead,
		});
		expect(await run.poll()).toEqual({ status: "pending" });

		await approveFrom(relay, OWNER, run.code, dek);
		const result = await run.poll();

		expect(result.status).toBe("paired");
		if (result.status !== "paired") throw new Error("unreachable");
		expect(bytesToB64(result.dek)).toBe(bytesToB64(dek));
	});

	it("checks against the keyring **before** returning", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);
		const run = await startPairingRun({
			owner: OWNER,
			transport: relay,
			aead: nobleAead,
		});
		await approveFrom(relay, OWNER, run.code, dek);

		expect(relay.verifyCalls).toBe(0);
		await run.poll();
		expect(relay.verifyCalls).toBe(1);
	});

	it("the caller closes the relay, after consuming it", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);
		const run = await startPairingRun({
			owner: OWNER,
			transport: relay,
			aead: nobleAead,
		});
		await approveFrom(relay, OWNER, run.code, dek);

		await run.poll();
		/** Still alive. A retry after a lost response sees the same envelope again. */
		expect(relay.rows.size).toBe(1);
		await run.cancel();
		expect(relay.rows.size).toBe(0);
	});
});

describe("cases that return nothing", () => {
	it("refuses a key that cannot open this account's keyring", async () => {
		const relay = new FakeRelay();
		await enableSync(relay, OWNER);
		const run = await startPairingRun({
			owner: OWNER,
			transport: relay,
			aead: nobleAead,
		});
		/** The code and private key are correct, but the sealed DEK belongs to another account. */
		await approveFrom(relay, OWNER, run.code, generateDek());

		await expect(run.poll()).rejects.toBeInstanceOf(PairingKeyRejectedError);
		/** Even after a rejection the relay row is kept, giving the user a window to check the cause. */
		expect(relay.rows.size).toBe(1);
	});

	it("an account without a keyring has no key to hand over", async () => {
		const relay = new FakeRelay();
		const run = await startPairingRun({
			owner: OWNER,
			transport: relay,
			aead: nobleAead,
		});
		await approveFrom(relay, OWNER, run.code, generateDek());
		await expect(run.poll()).rejects.toThrow(SYNC_ERROR_CODE.notConfigured);
	});

	it("an expired session is the same as none", async () => {
		const relay = new FakeRelay();
		await enableSync(relay, OWNER);
		const run = await startPairingRun({
			owner: OWNER,
			transport: relay,
			aead: nobleAead,
		});
		const base = Date.now();
		relay.now = () => base + SYNC_LIMITS.pairingTtlMinutes * 60_000 + 1;
		await expect(run.poll()).rejects.toMatchObject({
			code: SYNC_ERROR_CODE.pairingNotFound,
		});
	});

	it("transient failures throw as is; the caller decides whether to keep waiting", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);
		const run = await startPairingRun({
			owner: OWNER,
			transport: relay,
			aead: nobleAead,
		});
		relay.failNextRead = Object.assign(new Error("network"), { status: 0 });
		await expect(run.poll()).rejects.toThrow("network");

		/** A failure does not end the run. The same code can still be approved and polled. */
		await approveFrom(relay, OWNER, run.code, dek);
		expect((await run.poll()).status).toBe("paired");
	});
});

describe("the first approval wins", () => {
	it("a late approval cannot replace the envelope", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);
		const run = await startPairingRun({
			owner: OWNER,
			transport: relay,
			aead: nobleAead,
		});

		await approveFrom(relay, OWNER, run.code, dek);
		await expect(
			approveFrom(relay, OWNER, run.code, generateDek()),
		).rejects.toMatchObject({ code: SYNC_ERROR_CODE.pairingAlreadyApproved });

		const result = await run.poll();
		if (result.status !== "paired") throw new Error("unreachable");
		expect(bytesToB64(result.dek)).toBe(bytesToB64(dek));
	});
});

describe("private keys", () => {
	it("a new one per procedure; a later procedure cannot open an earlier envelope", async () => {
		const relay = new FakeRelay();
		const dek = await enableSync(relay, OWNER);

		const first = await startPairingRun({
			owner: OWNER,
			transport: relay,
			aead: nobleAead,
		});
		await approveFrom(relay, OWNER, first.code, dek);
		const firstHash = pairingCodeHash(OWNER, normalizePairingCode(first.code));
		const sealedForFirst = relay.rows.get(firstHash)?.payload;
		expect(sealedForFirst).toBeTypeOf("string");

		const second = await startPairingRun({
			owner: OWNER,
			transport: relay,
			aead: nobleAead,
		});
		expect(second.code).not.toBe(first.code);

		/**
		 * Moves a sealed envelope from the first run into the second run's slot. The server could perform
		 * this manipulation. Neither the second run's private key nor its code opens it.
		 */
		const secondHash = pairingCodeHash(
			OWNER,
			normalizePairingCode(second.code),
		);
		const row = relay.rows.get(secondHash);
		if (row === undefined) throw new Error("unreachable");
		row.payload = sealedForFirst ?? null;
		await expect(second.poll()).rejects.toThrow();
	});
});
