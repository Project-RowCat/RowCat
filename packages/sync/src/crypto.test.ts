import { describe, expect, it } from "vitest";
import { nobleAead } from "./aead.ts";
import { b64ToBytes, bytesToB64, SyncCodecError } from "./codec.ts";
import {
	decryptRecord,
	encryptRecord,
	generateDek,
	isValidEnvelopeSyntax,
	parseEncryptedBlob,
	SyncCryptoError,
} from "./crypto.ts";

/**
 * Security properties of envelope encryption. These tests assert what must not happen, not only
 * what works. For each of the four values bound by the AAD, a ciphertext altered in that value must
 * fail to open. If any one check loosened, an attacker could move ciphertext to another account,
 * record or type without any visible sign.
 */

const OWNER = "0123456789abcdef0123456789abcdef";
const IDENTITY = {
	owner: OWNER,
	recordId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
	type: "chat.room",
};
const PAYLOAD = {
	schemaVersion: 1,
	rev: { t: 10, c: 0, d: "device-a" },
	deletedAt: null,
	data: { title: "The Night Library" },
};

const dek = generateDek();

const openWith = (identity: typeof IDENTITY, ciphertext: string) =>
	decryptRecord(dek, identity, ciphertext, nobleAead);

describe("AAD binding", () => {
	it("the normal path round-trips", async () => {
		const ct = await encryptRecord(dek, IDENTITY, PAYLOAD, nobleAead);
		expect(await openWith(IDENTITY, ct)).toEqual(PAYLOAD);
	});

	it("moving it to another owner's slot does not open", async () => {
		/**
		 * Scenario: a compromised server plants A's ciphertext in B's row. If it opened, B would see A's
		 * conversation as its own, which breaks the zero-knowledge claim.
		 */
		const ct = await encryptRecord(dek, IDENTITY, PAYLOAD, nobleAead);
		await expect(
			openWith({ ...IDENTITY, owner: "ffffffffffffffffffffffffffffffff" }, ct),
		).rejects.toThrow();
	});

	it("moving it to another record id within the same account does not open", async () => {
		const ct = await encryptRecord(dek, IDENTITY, PAYLOAD, nobleAead);
		await expect(
			openWith(
				{ ...IDENTITY, recordId: "99999999-8888-4777-8666-555555555555" },
				ct,
			),
		).rejects.toThrow();
	});

	it("swapping the type does not open it", async () => {
		// Places a room ciphertext in a draft slot. The server also rejects a type change as a conflict,
		// so this check is a second layer of defense.
		const ct = await encryptRecord(dek, IDENTITY, PAYLOAD, nobleAead);
		await expect(
			openWith({ ...IDENTITY, type: "authoring.draft" }, ct),
		).rejects.toThrow();
	});

	it("planting a lower envelope version is refused **before decryption**", async () => {
		/**
		 * The envelope version is both an AAD component and an envelope field. Changing only the field
		 * fails first as an unknown envelope.
		 *
		 * If that check were passed, the AAD mismatch would still fail the tag, so a downgrade is blocked
		 * twice over.
		 */
		const ct = await encryptRecord(dek, IDENTITY, PAYLOAD, nobleAead);
		const tampered = JSON.stringify({ ...JSON.parse(ct), v: 2 });
		await expect(openWith(IDENTITY, tampered)).rejects.toThrow(SyncCryptoError);
	});

	it("another DEK does not open it", async () => {
		const ct = await encryptRecord(dek, IDENTITY, PAYLOAD, nobleAead);
		await expect(
			decryptRecord(generateDek(), IDENTITY, ct, nobleAead),
		).rejects.toThrow();
	});

	it("flipping one ciphertext byte does not open it", async () => {
		const ct = await encryptRecord(dek, IDENTITY, PAYLOAD, nobleAead);
		const blob = JSON.parse(ct) as { ct: string };
		const bytes = b64ToBytes(blob.ct);
		bytes[0] ^= 0x01;
		await expect(
			openWith(
				IDENTITY,
				JSON.stringify({ ...JSON.parse(ct), ct: bytesToB64(bytes) }),
			),
		).rejects.toThrow();
	});
});

describe("nonce", () => {
	it("encrypting the same input twice gives different ciphertexts", async () => {
		/**
		 * Nonce reuse is the most expensive mistake in GCM: reusing a key and nonce pair leaks the
		 * authentication key. This test pins that nonces are never deterministic.
		 */
		const first = await encryptRecord(dek, IDENTITY, PAYLOAD, nobleAead);
		const second = await encryptRecord(dek, IDENTITY, PAYLOAD, nobleAead);
		expect(first).not.toBe(second);
		expect(parseEncryptedBlob(first).iv).not.toBe(
			parseEncryptedBlob(second).iv,
		);
		expect(await openWith(IDENTITY, second)).toEqual(PAYLOAD);
	});

	it("the nonce is 12 bytes", async () => {
		const blob = parseEncryptedBlob(
			await encryptRecord(dek, IDENTITY, PAYLOAD, nobleAead),
		);
		expect(b64ToBytes(blob.iv).length).toBe(12);
	});
});

describe("envelope syntax validation: what the server does without decrypting", () => {
	it("passes a normal envelope", async () => {
		const ct = await encryptRecord(dek, IDENTITY, PAYLOAD, nobleAead);
		expect(isValidEnvelopeSyntax(ct, 1)).toBe(true);
	});

	it.each([
		["not JSON", "not-json"],
		["no v", '{"iv":"AAAAAAAAAAAAAAAA","ct":"AAAA"}'],
		["iv is not 12 bytes", '{"v":1,"iv":"AAAA","ct":"AAAA"}'],
		["ct is empty", '{"v":1,"iv":"AAAAAAAAAAAAAAAA","ct":""}'],
	])("%s → refused", (_label, ciphertext) => {
		expect(isValidEnvelopeSyntax(ciphertext, 1)).toBe(false);
	});

	it("refuses when the declared envelope version differs from the body's v", () => {
		expect(
			isValidEnvelopeSyntax('{"v":1,"iv":"AAAAAAAAAAAAAAAA","ct":"AAAA"}', 2),
		).toBe(false);
	});

	it("a malformed envelope throws at parsing", () => {
		expect(() => parseEncryptedBlob("{}")).toThrow(SyncCodecError);
	});
});
