import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { createAppleNonce } from "./apple-nonce.ts";

/**
 * Apple native sign-in nonce: **which shape goes where.**
 *
 * The regression this check guards is one, and it is the quietest mistake in this slice: swapping
 * the two values. Compilation and rendering both pass (both are hex strings), and the symptom is
 * only "Apple alone is rejected by the server", which cannot be checked without a device. That is
 * why derivation sits in a pure module.
 */

/** Deterministic randomness. To check derivation by value, the random source must be an argument. */
const fixedRandom = (byte: number) => (length: number) =>
	new Uint8Array(length).fill(byte);

describe("createAppleNonce", () => {
	it("the value given to Apple is the sha256 of the value given to the server", () => {
		const nonce = createAppleNonce(fixedRandom(0xab));
		expect(nonce.hashed).toBe(bytesToHex(sha256(utf8ToBytes(nonce.raw))));
	});

	/**
	 * **Must not be reversed.** Sending the raw value to Apple means it rides in the id token
	 * unchanged, and whoever intercepts the token learns the nonce and can replay it to our server.
	 */
	it("the two values differ", () => {
		const nonce = createAppleNonce(fixedRandom(0x01));
		expect(nonce.raw).not.toBe(nonce.hashed);
		expect(bytesToHex(sha256(utf8ToBytes(nonce.hashed)))).not.toBe(nonce.raw);
	});

	/** Hex of 32 bytes. A shorter value weakens replay protection. */
	it("the original comes from 32 bytes", () => {
		expect(createAppleNonce(fixedRandom(0)).raw).toHaveLength(64);
	});

	/**
	 * The default random source is the platform CSPRNG (`secure-random.ts` plugs it into Hermes). We
	 * only check that a no-argument call changes each time: if the same value came out twice, replay
	 * protection would do nothing.
	 */
	it("a different value every call", () => {
		expect(createAppleNonce().raw).not.toBe(createAppleNonce().raw);
	});
});
