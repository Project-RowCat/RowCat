import { describe, expect, it } from "vitest";
import vectors from "./__fixtures__/vectors.json" with { type: "json" };
import { nobleAead } from "./aead.ts";
import {
	b64ToBytes,
	bytesToB64,
	encodeRecordPlaintext,
	PLAINTEXT_CODEC,
} from "./codec.ts";
import { decryptRecord, encryptRecord, recordAad } from "./crypto.ts";
import {
	buildKeyring,
	deriveAuthKey,
	encodeRecoveryCode,
	proveKeyring,
	unlockWithRecovery,
	verifyKeyringProof,
} from "./keyring.ts";

/**
 * Golden vectors. If this file breaks, do not deploy. What is pinned here is the ciphertext format
 * already on users' servers. If envelope composition, AAD order, compression codec bytes or key
 * derivation changes even slightly, existing records cannot be opened from the moment that change
 * ships. The only recovery is for every client to decrypt in the old format and re-upload in the
 * new one, and offline devices cannot take part until then. So this test does not verify the
 * implementation. It locks the format. The vectors are built from fixed inputs (DEK, nonce,
 * recovery secret, salt). Production uses the CSPRNG at those points, and only low-level functions
 * accept injected bytes. That is why deterministic vectors and production can share code.
 */

const OWNER = vectors.input.owner;
const IDENTITY = {
	owner: OWNER,
	recordId: vectors.input.recordId,
	type: vectors.input.type,
};
const DEK = b64ToBytes(vectors.input.dekB64);
const NONCE = b64ToBytes(vectors.input.nonceB64);

describe("record envelopes", () => {
	it("the AAD composition is fixed", () => {
		expect(bytesToB64(recordAad({ ...IDENTITY, envelopeVersion: 1 }))).toBe(
			vectors.record.aadB64,
		);
	});

	it("the AAD joins owner, id, type and envelope version with \\0", () => {
		const decoded = new TextDecoder().decode(b64ToBytes(vectors.record.aadB64));
		expect(decoded.split("\0")).toEqual([
			"rowcat.sync.rec.v1",
			OWNER,
			vectors.input.recordId,
			vectors.input.type,
			"1",
		]);
	});

	it("short payloads ride the identity codec", () => {
		const plaintext = encodeRecordPlaintext(vectors.record.small.payload);
		expect(plaintext[0]).toBe(PLAINTEXT_CODEC.identity);
		expect(bytesToB64(plaintext)).toBe(vectors.record.small.plaintextB64);
	});

	it("long payloads ride DEFLATE and really shrink", () => {
		const plaintext = encodeRecordPlaintext(vectors.record.large.payload);
		expect(plaintext[0]).toBe(PLAINTEXT_CODEC.deflate);
		expect(bytesToB64(plaintext)).toBe(vectors.record.large.plaintextB64);
		// Checks that compression actually made the payload smaller, rather than assuming it did.
		const raw = new TextEncoder().encode(
			JSON.stringify(vectors.record.large.payload),
		);
		expect(plaintext.length).toBeLessThan(raw.length);
	});

	it.each([
		["small", vectors.record.small],
		["large", vectors.record.large],
	])("%s ciphertext bytes are unchanged", async (_label, vector) => {
		expect(
			await encryptRecord(DEK, IDENTITY, vector.payload, nobleAead, NONCE),
		).toBe(vector.ciphertext);
	});

	it.each([
		["small", vectors.record.small],
		["large", vectors.record.large],
	])("the current code decrypts the %s vector", async (_label, vector) => {
		expect(
			await decryptRecord(DEK, IDENTITY, vector.ciphertext, nobleAead),
		).toEqual(vector.payload);
	});
});

describe("keyring", () => {
	it("the recovery code from the fixed secret is unchanged", () => {
		expect(encodeRecoveryCode(b64ToBytes(vectors.input.recoveryB64))).toBe(
			vectors.keyring.recoveryCode,
		);
	});

	it("recovery code notation is RCAT + seven groups of four", () => {
		expect(vectors.keyring.recoveryCode).toMatch(
			/^RCAT(-[0-9A-HJKMNP-TV-Z]{4}){7}$/,
		);
	});

	it("the keyring string from the fixed seed is identical to the byte", async () => {
		/**
		 * The exact string comparison is the point. Comparing parsed fields would pass even if key order
		 * or whitespace changed. The keyring possession proof is a MAC over this exact string, so one
		 * character of difference makes server verification fail.
		 */
		const built = await buildKeyring(OWNER, DEK, nobleAead, {
			recovery: b64ToBytes(vectors.input.recoveryB64),
			salt: b64ToBytes(vectors.input.recoverySaltB64),
			nonce: b64ToBytes(vectors.input.keyNonceB64),
		});
		expect(built.keyring).toBe(vectors.keyring.keyring);
		expect(built.recoveryCode).toBe(vectors.keyring.recoveryCode);
	});

	it("the vector's recovery code extracts the same DEK from the vector's keyring", async () => {
		const dek = await unlockWithRecovery(
			OWNER,
			vectors.keyring.keyring,
			vectors.keyring.recoveryCode,
			nobleAead,
		);
		expect(bytesToB64(dek)).toBe(vectors.input.dekB64);
	});

	it("authKey derivation is unchanged", () => {
		expect(bytesToB64(deriveAuthKey(DEK, OWNER))).toBe(
			vectors.keyring.authKeyB64,
		);
	});

	it("the same DEK with a different owner gives a different authKey", () => {
		expect(vectors.keyring.otherOwnerAuthKeyB64).not.toBe(
			vectors.keyring.authKeyB64,
		);
		expect(bytesToB64(deriveAuthKey(DEK, vectors.input.otherOwner))).toBe(
			vectors.keyring.otherOwnerAuthKeyB64,
		);
	});

	it("the proof of possession is unchanged and verifies", () => {
		const authKey = b64ToBytes(vectors.keyring.authKeyB64);
		expect(proveKeyring(authKey, vectors.keyring.keyring)).toBe(
			vectors.keyring.proofB64,
		);
		expect(
			verifyKeyringProof(
				authKey,
				vectors.keyring.keyring,
				vectors.keyring.proofB64,
			),
		).toBe(true);
	});
});
