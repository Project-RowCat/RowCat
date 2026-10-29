import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * The **replay-protection value** for Apple native sign-in, and why it takes two shapes.
 *
 * In this flow the nonce goes to two places in two different shapes. That asymmetry is the reason
 * this file exists, and reversing it makes verification meaningless:
 *
 * ```text
 * Apple (the device's auth sheet)   the hash          becomes the `nonce` claim in the id token
 * RowCat server                     **the raw value** the server hashes it and compares against the claim
 * ```
 *
 * Giving the raw value to Apple means it rides in the token unchanged, and whoever intercepts the
 * token **learns the nonce** and can replay it to our server. Giving the hash to the server means
 * the server hashes it once more and compares, so it always mismatches. (better-auth's apple
 * provider uses `nonceComparison: "exact-or-sha256"`, so it must receive the **raw** value for one
 * of the two rules to match.)
 *
 * ## Why a pure module
 *
 * If this rule lived in `apple-auth.ts` (the file that pulls in the native module), the only way to
 * check it would be on a real device. Here, **which value goes where** can be locked by value
 * without render or device. This is the regression this slice most wants to catch: swapping the two
 * still compiles, and the symptom is only "Apple sign-in alone gets rejected by the server".
 *
 * ## The random source is an argument
 *
 * The default is `randomBytes`, so callers pass nothing, but tests pass fixed bytes to check
 * derivation deterministically. The source is the platform CSPRNG this app already installs
 * (`secure-random.ts` — Hermes has no `crypto.getRandomValues`, so that wiring comes first).
 */

/** 32 bytes. Replay protection needs unpredictability, and that length is enough. */
const NONCE_BYTES = 32;

export interface AppleNonce {
	/** Sent to the server. Never give this to Apple. */
	raw: string;
	/** Given to Apple. Never send this to the server. */
	hashed: string;
}

export function createAppleNonce(
	random: (length: number) => Uint8Array = randomBytes,
): AppleNonce {
	const raw = bytesToHex(random(NONCE_BYTES));
	return { raw, hashed: bytesToHex(sha256(utf8ToBytes(raw))) };
}
