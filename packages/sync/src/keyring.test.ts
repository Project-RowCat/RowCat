import { describe, expect, it } from "vitest";
import { nobleAead } from "./aead.ts";
import { bytesToB64, SyncCodecError, timingSafeEqual } from "./codec.ts";
import { generateDek } from "./crypto.ts";
import {
	createKeyring,
	decodeRecoveryCode,
	deriveAuthKey,
	encodeRecoveryCode,
	parseKeyring,
	proveKeyring,
	rotateRecovery,
	unlockWithRecovery,
	verifyKeyringProof,
} from "./keyring.ts";

const OWNER = "0123456789abcdef0123456789abcdef";
const OTHER = "ffffffffffffffffffffffffffffffff";

describe("recovery code notation", () => {
	it("round-trips", () => {
		const secret = Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3);
		expect(decodeRecoveryCode(encodeRecoveryCode(secret))).toEqual(secret);
	});

	it("absorbs lowercase, spaces and separators", () => {
		const secret = Uint8Array.from({ length: 16 }, (_, i) => 255 - i);
		const code = encodeRecoveryCode(secret);
		const messy = ` ${code.toLowerCase().replace(/-/g, " ")}  `;
		expect(decodeRecoveryCode(messy)).toEqual(secret);
	});

	it("normalizes Crockford's confusable characters", () => {
		/**
		 * Users copy this value from paper, so 0/O, 1/I/L and V/U mix-ups are reading errors, not typos.
		 * If they are not absorbed here, someone who copied the code exactly would fail.
		 */
		const secret = Uint8Array.from({ length: 16 }, (_, i) => i);
		const code = encodeRecoveryCode(secret);
		const confused = code
			.replace(/0/g, "O")
			.replace(/1/g, "I")
			.replace(/V/g, "U");
		expect(decodeRecoveryCode(confused)).toEqual(secret);
	});

	it("**the checksum** catches a one-character typo before decryption", () => {
		/**
		 * Checks every single-character typo exhaustively. A single sample could happen to be a character
		 * that passes, giving false assurance.
		 *
		 * Some typos are expected to pass the 10-bit checksum (about 1 in 1024). That is acceptable: the
		 * rate is low, and any that pass still fail at the AEAD tag.
		 */
		const secret = Uint8Array.from({ length: 16 }, (_, i) => i * 11 + 5);
		const code = encodeRecoveryCode(secret);
		const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
		let mutations = 0;
		let caught = 0;
		for (let i = 0; i < code.length; i++) {
			if (code[i] === "-") continue;
			for (const ch of alphabet) {
				if (ch === code[i]) continue;
				mutations++;
				const typo = code.slice(0, i) + ch + code.slice(i + 1);
				try {
					const decoded = decodeRecoveryCode(typo);
					// If a typo does decode, the result must be a different secret. The decoder must never
					// silently correct it.
					expect(timingSafeEqual(decoded, secret)).toBe(false);
				} catch (error) {
					expect(error).toBeInstanceOf(SyncCodecError);
					caught++;
				}
			}
		}
		expect(mutations).toBeGreaterThan(800);
		expect(caught / mutations).toBeGreaterThan(0.98);
	});

	it("refuses a different length", () => {
		expect(() => decodeRecoveryCode("RCAT-1234")).toThrow(SyncCodecError);
	});

	it("a body starting with RCAT is not mistaken for the prefix", () => {
		/**
		 * `R`, `C`, `A` and `T` are all valid base32 characters. Stripping the prefix unconditionally
		 * would break codes whose body happens to start with those four letters, which occurs about once
		 * in 4096 codes.
		 */
		const secret = Uint8Array.from({ length: 16 }, (_, i) => i);
		const code = encodeRecoveryCode(secret);
		const withoutPrefix = code.slice("RCAT-".length);
		expect(decodeRecoveryCode(withoutPrefix)).toEqual(secret);
	});
});

describe("keyring lifecycle", () => {
	it("set up → unlock with the recovery code → the same DEK", async () => {
		const dek = generateDek();
		const created = await createKeyring(OWNER, dek, nobleAead);
		const unlocked = await unlockWithRecovery(
			OWNER,
			created.keyring,
			created.recoveryCode,
			nobleAead,
		);
		expect(bytesToB64(unlocked)).toBe(bytesToB64(dek));
	});

	it("a well-formed but wrong code fails only at **the AEAD tag**", async () => {
		/**
		 * Confirms that no verifier is stored. Neither the server nor the device holds anything to check
		 * a code against in advance; only a decryption attempt can answer.
		 */
		const created = await createKeyring(OWNER, generateDek(), nobleAead);
		const wrong = encodeRecoveryCode(
			Uint8Array.from({ length: 16 }, (_, i) => i + 100),
		);
		// The checksum passes because the code is well formed; only the AEAD unlock fails.
		expect(() => decodeRecoveryCode(wrong)).not.toThrow();
		await expect(
			unlockWithRecovery(OWNER, created.keyring, wrong, nobleAead),
		).rejects.toThrow();
	});

	it("another owner's keyring does not open with the same code", async () => {
		const created = await createKeyring(OWNER, generateDek(), nobleAead);
		await expect(
			unlockWithRecovery(
				OTHER,
				created.keyring,
				created.recoveryCode,
				nobleAead,
			),
		).rejects.toThrow();
	});

	it("rotation keeps the DEK and invalidates the old code", async () => {
		const dek = generateDek();
		const created = await createKeyring(OWNER, dek, nobleAead);
		const rotated = await rotateRecovery(OWNER, dek, nobleAead);

		// Unlocking with the new code yields the same DEK, so existing records still open.
		expect(
			bytesToB64(
				await unlockWithRecovery(
					OWNER,
					rotated.keyring,
					rotated.recoveryCode,
					nobleAead,
				),
			),
		).toBe(bytesToB64(dek));
		// The old code no longer unlocks the keyring, because the old salt and wrapper were replaced.
		await expect(
			unlockWithRecovery(
				OWNER,
				rotated.keyring,
				created.recoveryCode,
				nobleAead,
			),
		).rejects.toThrow();
		expect(rotated.recoveryCode).not.toBe(created.recoveryCode);
	});

	it("the proof rotation makes verifies with the existing authKey", async () => {
		const dek = generateDek();
		await createKeyring(OWNER, dek, nobleAead);
		const rotated = await rotateRecovery(OWNER, dek, nobleAead);
		expect(
			verifyKeyringProof(
				deriveAuthKey(dek, OWNER),
				rotated.keyring,
				rotated.proof,
			),
		).toBe(true);
	});

	it("the keyring holds no plaintext DEK", async () => {
		const dek = generateDek();
		const created = await createKeyring(OWNER, dek, nobleAead);
		expect(created.keyring).not.toContain(bytesToB64(dek));
		// The recovery code must not appear in the keyring string sent to the server.
		expect(created.keyring).not.toContain(created.recoveryCode);
	});

	it("an unknown keyring version throws", () => {
		expect(() =>
			parseKeyring(
				'{"v":9,"recoverySalt":"AAAA","wrapped":{"iv":"AA","ct":"AA"}}',
			),
		).toThrow();
	});
});

describe("proof of possession", () => {
	it("bound to **exactly that string**; one space off fails", async () => {
		/**
		 * The server must store the client-produced keyring string byte for byte. If it re-serialized the
		 * parsed value, this test would fail.
		 */
		const dek = generateDek();
		const created = await createKeyring(OWNER, dek, nobleAead);
		const authKey = deriveAuthKey(dek, OWNER);
		const proof = proveKeyring(authKey, created.keyring);

		expect(verifyKeyringProof(authKey, created.keyring, proof)).toBe(true);
		expect(verifyKeyringProof(authKey, `${created.keyring} `, proof)).toBe(
			false,
		);
		// A re-serialized string with the same content but different key order must also fail
		// verification.
		const reserialized = JSON.stringify({
			wrapped: parseKeyring(created.keyring).wrapped,
			recoverySalt: parseKeyring(created.keyring).recoverySalt,
			v: 1,
		});
		expect(verifyKeyringProof(authKey, reserialized, proof)).toBe(false);
	});

	it("a proof made with another account's authKey fails", async () => {
		const dek = generateDek();
		const created = await createKeyring(OWNER, dek, nobleAead);
		const foreign = proveKeyring(deriveAuthKey(dek, OTHER), created.keyring);
		expect(
			verifyKeyringProof(deriveAuthKey(dek, OWNER), created.keyring, foreign),
		).toBe(false);
	});

	it("a non-base64 proof is refused without throwing", async () => {
		const dek = generateDek();
		const created = await createKeyring(OWNER, dek, nobleAead);
		expect(
			verifyKeyringProof(
				deriveAuthKey(dek, OWNER),
				created.keyring,
				"!!!not-b64!!!",
			),
		).toBe(false);
	});
});

describe("constant-time comparison", () => {
	it("different lengths are false", () => {
		expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1]))).toBe(
			false,
		);
	});
	it("equal values are true; one byte off is false", () => {
		expect(
			timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])),
		).toBe(true);
		expect(
			timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])),
		).toBe(false);
	});
});
