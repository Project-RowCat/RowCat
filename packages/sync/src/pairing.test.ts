import { x25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { nobleAead } from "./aead.ts";
import { b64ToBytes, bytesToB64, SyncCodecError } from "./codec.ts";
import { generateDek, SyncCryptoError } from "./crypto.ts";
import {
	formatPairingCode,
	generatePairingCode,
	generatePairingKeyPair,
	maskPairingCodeInput,
	normalizePairingCode,
	openPairingDek,
	PAIRING_CODE_CHARS,
	pairingCodeHash,
	parsePairingEnvelope,
	sealPairingDek,
} from "./pairing.ts";

/**
 * Security properties of pairing. The tests assert what must not be possible, not only what works.
 * The server holds the envelope and both public keys, so every tampering it could attempt must
 * fail. If any one of these checks loosens, the server could obtain the user's DEK with no visible
 * sign.
 */

const OWNER = "0123456789abcdef0123456789abcdef";
const OTHER_OWNER = "ffffffffffffffffffffffffffffffff";

const sealFor = (
	owner: string,
	code: string,
	newPublicKey: string,
	dek: Uint8Array,
) =>
	sealPairingDek({
		owner,
		normalizedCode: normalizePairingCode(code),
		newPublicKey,
		dek,
		aead: nobleAead,
	});

const openFor = (
	owner: string,
	code: string,
	privateKey: Uint8Array,
	payload: string,
) =>
	openPairingDek({
		owner,
		normalizedCode: normalizePairingCode(code),
		privateKey,
		payload,
		aead: nobleAead,
	});

describe("codes", () => {
	it("80 bits as four groups of four", () => {
		const code = generatePairingCode();
		expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
		expect(normalizePairingCode(code)).toHaveLength(PAIRING_CODE_CHARS);
	});

	it("produces different codes", () => {
		/**
		 * Minimal net against an implementation that returns a constant, e.g. one written without
		 * randomness. It does not test entropy statistically; that is the CSPRNG's job. This only checks
		 * that codes differ between calls.
		 */
		const codes = new Set(
			Array.from({ length: 64 }, () => generatePairingCode()),
		);
		expect(codes.size).toBe(64);
	});

	it("absorbs only notation differences", () => {
		const canonical = normalizePairingCode(generatePairingCode());
		const shaken = ` ${formatPairingCode(canonical).toLowerCase()} `;
		expect(normalizePairingCode(shaken)).toBe(canonical);
	});

	it("folds Crockford confusables", () => {
		// O, I, L and U are not in the alphabet. This restores the values a person may have misread while
		// copying a code.
		expect(normalizePairingCode("OILU-0000-0000-0000")).toBe(
			"011V0000" + "00000000",
		);
	});

	it("a different length throws", () => {
		expect(() => normalizePairingCode("ABCD-ABCD-ABCD")).toThrow(
			SyncCodecError,
		);
		expect(() => normalizePairingCode("ABCD-ABCD-ABCD-ABCDE")).toThrow(
			SyncCodecError,
		);
	});
});

describe("input mask", () => {
	/**
	 * Keeps the display formatting aligned with what the screen types. What matters is that it reads
	 * the same table as normalization, not that the output looks nice. If they diverge, the user reads
	 * one character on screen while derivation uses another. The failure then shows only as an
	 * incorrect code.
	 */
	it("a masked value normalizes as is", () => {
		const canonical = normalizePairingCode(generatePairingCode());
		const masked = maskPairingCodeInput(canonical.toLowerCase());
		expect(masked).toBe(formatPairingCode(canonical));
		expect(normalizePairingCode(masked)).toBe(canonical);
	});

	it("does not throw while typing; incomplete is the normal state", () => {
		expect(maskPairingCodeInput("")).toBe("");
		expect(maskPairingCodeInput("a")).toBe("A");
		expect(maskPairingCodeInput("abcd")).toBe("ABCD");
		expect(maskPairingCodeInput("abcde")).toBe("ABCD-E");
	});

	it("adds no trailing hyphen", () => {
		// A trailing hyphen after a complete group would make one backspace appear to delete nothing.
		expect(maskPairingCodeInput("ABCD")).toBe("ABCD");
		expect(maskPairingCodeInput("ABCD-")).toBe("ABCD");
	});

	it("uses the same folding table as normalization", () => {
		expect(maskPairingCodeInput("oilu 0000/0000_0000")).toBe(
			"011V-0000-0000-0000",
		);
		expect(normalizePairingCode(maskPairingCodeInput("oilu000000000000"))).toBe(
			normalizePairingCode("OILU-0000-0000-0000"),
		);
	});

	it("idempotent: re-entering a masked value gives the same", () => {
		const once = maskPairingCodeInput("abcd efgh 2345 6789");
		expect(maskPairingCodeInput(once)).toBe(once);
	});

	it("drops characters past sixteen", () => {
		// Characters beyond the 16-character limit are dropped. Keeping them would make the screen draw a
		// non-code string as if it were a code.
		expect(maskPairingCodeInput("ABCDABCDABCDABCDXYZ")).toBe(
			"ABCD-ABCD-ABCD-ABCD",
		);
	});
});

describe("code hashes", () => {
	it("the same owner and code give the same hash", () => {
		const code = generatePairingCode();
		const compact = normalizePairingCode(code);
		expect(pairingCodeHash(OWNER, compact)).toBe(
			pairingCodeHash(OWNER, normalizePairingCode(formatPairingCode(compact))),
		);
	});

	it("a different owner gives a different hash", () => {
		/**
		 * Without this property, a hash leaked from one account could be used to find another account's
		 * session.
		 */
		const compact = normalizePairingCode(generatePairingCode());
		expect(pairingCodeHash(OWNER, compact)).not.toBe(
			pairingCodeHash(OTHER_OWNER, compact),
		);
	});

	it("a different code gives a different hash", () => {
		const a = normalizePairingCode(generatePairingCode());
		const b = normalizePairingCode(generatePairingCode());
		expect(pairingCodeHash(OWNER, a)).not.toBe(pairingCodeHash(OWNER, b));
	});

	it("64 lowercase hex characters; the same string in a DB key or a log", () => {
		expect(
			pairingCodeHash(OWNER, normalizePairingCode(generatePairingCode())),
		).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe("key agreement", () => {
	it("both sides reach the same shared secret", () => {
		const n = generatePairingKeyPair();
		const t = generatePairingKeyPair();
		const fromT = x25519.getSharedSecret(t.privateKey, b64ToBytes(n.publicKey));
		const fromN = x25519.getSharedSecret(n.privateKey, b64ToBytes(t.publicKey));
		expect(bytesToB64(fromT)).toBe(bytesToB64(fromN));
	});

	it("public keys are 32 bytes", () => {
		expect(b64ToBytes(generatePairingKeyPair().publicKey)).toHaveLength(32);
	});
});

describe("envelopes", () => {
	it("the normal path moves the DEK as is", async () => {
		const dek = generateDek();
		const code = generatePairingCode();
		const device = generatePairingKeyPair();
		const { payload } = await sealFor(OWNER, code, device.publicKey, dek);
		expect(
			bytesToB64(await openFor(OWNER, code, device.privateKey, payload)),
		).toBe(bytesToB64(dek));
	});

	it("the envelope holds only the envelope version, an ephemeral public key, a nonce and ciphertext", async () => {
		const { payload } = await sealFor(
			OWNER,
			generatePairingCode(),
			generatePairingKeyPair().publicKey,
			generateDek(),
		);
		/**
		 * Asserts the whole key set rather than excluding known fields. An exclusion check only blocks
		 * fields known today, so a field added later for convenience, such as a device name or timestamp,
		 * would slip through.
		 */
		expect(Object.keys(JSON.parse(payload) as object)).toEqual([
			"v",
			"epk",
			"iv",
			"ct",
		]);
	});

	it("the server cannot open the envelope; it has neither the code nor the private key", async () => {
		/**
		 * Hands the server everything it holds: both public keys and the envelope. The protocol's
		 * guarantee is that nothing useful can be derived from them.
		 */
		const dek = generateDek();
		const code = generatePairingCode();
		const device = generatePairingKeyPair();
		const { payload } = await sealFor(OWNER, code, device.publicKey, dek);
		const envelope = parsePairingEnvelope(payload);

		// Even if the server runs ECDH with its own keypair, it lacks the peer's private key, so K is not
		// produced.
		const attacker = generatePairingKeyPair();
		await expect(
			openFor(OWNER, code, attacker.privateKey, payload),
		).rejects.toThrow();
		// Re-submitting the public key carried in the envelope has the same result: the attacker gains
		// nothing.
		expect(envelope.epk).not.toBe(device.publicKey);
	});

	it("a different code does not open it: **channel binding**", async () => {
		/**
		 * ECDH must succeed while decryption fails. Without this property, the server could replace
		 * `newPub`, so the trusted device seals the DEK under a key the server controls.
		 */
		const device = generatePairingKeyPair();
		const { payload } = await sealFor(
			OWNER,
			generatePairingCode(),
			device.publicKey,
			generateDek(),
		);
		await expect(
			openFor(OWNER, generatePairingCode(), device.privateKey, payload),
		).rejects.toThrow();
	});

	it("a different owner does not open it", async () => {
		const device = generatePairingKeyPair();
		const code = generatePairingCode();
		const { payload } = await sealFor(
			OWNER,
			code,
			device.publicKey,
			generateDek(),
		);
		await expect(
			openFor(OTHER_OWNER, code, device.privateKey, payload),
		).rejects.toThrow();
	});

	it("tampered ciphertext does not open", async () => {
		const device = generatePairingKeyPair();
		const code = generatePairingCode();
		const { payload } = await sealFor(
			OWNER,
			code,
			device.publicKey,
			generateDek(),
		);
		const envelope = parsePairingEnvelope(payload);
		const ct = b64ToBytes(envelope.ct);
		ct[0] ^= 0x01;
		const tampered = JSON.stringify({ ...envelope, ct: bytesToB64(ct) });
		await expect(
			openFor(OWNER, code, device.privateKey, tampered),
		).rejects.toThrow();
	});

	it("swapping the ephemeral public key does not open it", async () => {
		const device = generatePairingKeyPair();
		const code = generatePairingCode();
		const { payload } = await sealFor(
			OWNER,
			code,
			device.publicKey,
			generateDek(),
		);
		const envelope = parsePairingEnvelope(payload);
		const swapped = JSON.stringify({
			...envelope,
			epk: generatePairingKeyPair().publicKey,
		});
		await expect(
			openFor(OWNER, code, device.privateKey, swapped),
		).rejects.toThrow();
	});

	it("an unknown envelope version throws; it does not read as 'wrong key'", () => {
		expect(() => parsePairingEnvelope(JSON.stringify({ v: 99 }))).toThrow(
			SyncCodecError,
		);
		expect(() =>
			parsePairingEnvelope(
				JSON.stringify({ v: 99, epk: "a", iv: "b", ct: "c" }),
			),
		).toThrow(SyncCryptoError);
	});

	it("does not seal with an off-spec key length", async () => {
		await expect(
			sealFor(
				OWNER,
				generatePairingCode(),
				generatePairingKeyPair().publicKey,
				new Uint8Array(16),
			),
		).rejects.toThrow(SyncCryptoError);
	});

	it("low-order public keys are blocked at key agreement", async () => {
		/**
		 * An all-zero public key makes the shared secret constant. noble throws on that result, so this
		 * needs no hand-written check, which could eventually be wrong.
		 */
		await expect(
			sealFor(
				OWNER,
				generatePairingCode(),
				bytesToB64(new Uint8Array(32)),
				generateDek(),
			),
		).rejects.toThrow(SyncCryptoError);
	});
});
