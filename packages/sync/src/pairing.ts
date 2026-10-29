import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { SYNC_PAIRING_VERSION } from "@rowcat/contracts/sync";
import { AEAD, type AeadProvider } from "./aead.ts";
import {
	b64ToBytes,
	base32ToBytes,
	bytesToB64,
	bytesToBase32,
	bytesToHex,
	SyncCodecError,
	utf8ToBytes,
} from "./codec.ts";
import { pairingAad, SyncCryptoError } from "./crypto.ts";

/**
 * Device pairing: hands the current DEK to a new device without re-entering the recovery code.
 * - The only secret moved is the DEK in use. Keys are not regenerated, the recovery code is not
 *   rotated, and the keyring is not re-wrapped. Pairing distributes the key; it does not change it.
 *   Mixing the two would silently drop an offline device from the account.
 * - Flow: the new device sends a code hash and its public key through the server. The user copies
 *   the code to the trusted device, which derives K from ECDH plus the code, seals the DEK, and
 *   returns the payload through the server. The new device derives the same K and opens it.
 * - The server never learns the DEK, the code (only its hash), any private key, or the shared
 *   secret. Its maximum is to swap newPub, which only makes pairing fail; cutting the relay
 *   achieves that too.
 * - Not here: fetch, storage or React. This file handles bytes only. The app runs the relay, and
 *   the controller owns private-key lifetime.
 * - The code plaintext must never be sent to the server. Once logged, channel binding is lost.
 * - Approval cannot be revoked cryptographically after the DEK is handed over. Deleting the row
 *   closes the relay but is not revocation, and the UI must not describe it as one.
 */

/**
 * Code entropy is 80 bits; the legacy scheme used 40 bits (5 bytes). The 5-minute TTL and owner
 * scope already keep online guessing small. But the code is channel-binding material: guessing it
 * opens the session's envelope, not merely hijacks the session. At 80 bits, offline attempts within
 * the window are pointless. 10 bytes encode to exactly 16 base32 characters (80 = 16 x 5). With no
 * padding bits, no non-canonical final character can decode differently.
 */
const PAIRING_CODE_BYTES = 10;
export const PAIRING_CODE_CHARS = 16;
const PAIRING_GROUP = 4;

/**
 * Domain-separation prefix for the lookup hash. SHA-256 over owner and code would already work as a
 * lookup key. The prefix guarantees this hash can never equal a hash of the same input built
 * elsewhere. It costs nothing now and prevents collisions if a second hash use is added later.
 */
const PAIRING_HASH_PREFIX = "rowcat.sync.pair.hash.v1";

/**
 * HKDF info label. It keeps pairing-key derivation distinct from record, recovery and auth
 * derivations.
 */
const PAIRING_HKDF_INFO = "rowcat-sync-pairing-v1";

/**
 * Generates a new pairing code in the form `XXXX-XXXX-XXXX-XXXX`. Uses the same Crockford alphabet
 * as recovery codes, with no I, L, O or U. A person reads it on one screen and types it on another,
 * so one unreadable character is a failure, not a typo. No `RCAT-` prefix. Recovery codes are
 * printed and found months later, so they need a label. This code lives five minutes between two
 * screens.
 */
export const generatePairingCode = (): string =>
	formatPairingCode(bytesToBase32(randomBytes(PAIRING_CODE_BYTES)));

/**
 * Formats a normalized 16-character code for display. The dashed form is a screen concern only; no
 * other code should depend on it.
 */
export const formatPairingCode = (compact: string): string =>
	(compact.match(new RegExp(`.{1,${PAIRING_GROUP}}`, "g")) ?? []).join("-");

/**
 * A single folding table that absorbs display variation. Length is not checked here. Normalization
 * (`normalizePairingCode`) and the input mask (`maskPairingCodeInput`) must read the same table, so
 * they are kept separate. If the mask starts trimming on its own, the characters on screen diverge
 * from the characters used for derivation. The mismatch then appears as 'the code is wrong' even
 * though the user typed what they saw. After folding, the remaining characters are the 32-character
 * Crockford set, since I, L, O and U are folded into other characters. The mask has nothing left to
 * filter, and validity is decided by normalization alone.
 */
const foldPairingCode = (code: string): string =>
	code
		.toUpperCase()
		.replace(/[^0-9A-Z]/g, "")
		.replace(/O/g, "0")
		.replace(/[IL]/g, "1")
		.replace(/U/g, "V");

/**
 * Turns input in progress into the display form of what has been typed so far
 * (`XXXX-XXXX-XXXX-XXXX`). Does not throw. Input here is always mid-grammar (such as `AB` or
 * `ABCDE`). That is a normal state for every keystroke, which is why normalization, which accepts
 * only full 16-character codes, cannot be used here. A hyphen is added only when the next group
 * begins. A trailing hyphen after `ABCD` would make one backspace appear to delete nothing, so
 * users would learn to press it twice. Characters past the limit are discarded. The 16 characters
 * are the whole code, so later input is a typo or a pasted value. Keeping it would show a non-code
 * string as a code.
 */
export const maskPairingCodeInput = (input: string): string =>
	formatPairingCode(foldPairingCode(input).slice(0, PAIRING_CODE_CHARS));

/**
 * The one function in this repo that judges human input into a canonical code. Derivation (HKDF
 * salt), AAD and the lookup hash all use its output. If any other place starts trimming input on
 * its own, sender and receiver reach different strings. The failure appears only as a decryption
 * failure, which the user reads as a wrong code even though the code was right. It absorbs only
 * display variation: case, hyphens and spaces, and Crockford confusables (O to 0, I and L to 1, U
 * to V). It never guesses or corrects secret bits.
 */
export function normalizePairingCode(code: string): string {
	const compact = foldPairingCode(code);
	if (compact.length !== PAIRING_CODE_CHARS)
		throw new SyncCodecError("the pairing code has the wrong length");
	// Characters outside the alphabet throw here, so input with the right length but wrong characters
	// is rejected.
	const bytes = base32ToBytes(compact);
	if (bytes.length !== PAIRING_CODE_BYTES)
		throw new SyncCodecError("the pairing code has the wrong length");
	return compact;
}

/**
 * Lookup key sent to the server: SHA-256 over a prefix, a NUL byte, the owner, a NUL byte and the
 * normalized code, as hex. Binding the owner is the point. The same code under a different account
 * gives a different hash, so a hash leaked from one account cannot find another account's session.
 * The value is also not a substitute for the original: knowing the hash does not open the envelope,
 * since K needs the code.
 */
export const pairingCodeHash = (
	owner: string,
	normalizedCode: string,
): string =>
	bytesToHex(
		sha256(
			utf8ToBytes([PAIRING_HASH_PREFIX, owner, normalizedCode].join("\0")),
		),
	);

/** One-time key pair for the new device. The private key must never leave this object. */
export interface PairingKeyPair {
	/** Raw 32 bytes. Kept only in memory, never written to disk or to the server (see §14). */
	privateKey: Uint8Array;
	/** Base64. This is the only key material the server relays. */
	publicKey: string;
}

export function generatePairingKeyPair(): PairingKeyPair {
	const privateKey = x25519.utils.randomSecretKey();
	return { privateKey, publicKey: bytesToB64(x25519.getPublicKey(privateKey)) };
}

/**
 * Derives the sealing key: HKDF-SHA256 with the owner and code as salt, and the pairing info label.
 * The raw ECDH output is not used directly as an AES key. X25519 output is not a uniform 32 bytes;
 * it is a curve coordinate. The derivation also needs a place to mix in the code. With the code in
 * the salt, a successful ECDH with a wrong code still will not open. That property is the final
 * lock keeping the server at relay-only.
 */
const derivePairingKey = (
	shared: Uint8Array,
	owner: string,
	normalizedCode: string,
): Uint8Array =>
	hkdf(
		sha256,
		shared,
		utf8ToBytes([owner, normalizedCode].join("\0")),
		utf8ToBytes(PAIRING_HKDF_INFO),
		AEAD.keyBytes,
	);

/**
 * ECDH with the peer's public key. noble throws on every all-zero result, and that is part of the
 * defense. A low-order point in the public key slot would make the shared secret constant. That
 * path is blocked by the exception, so no hand-written check is needed. A hand-written check could
 * eventually be wrong.
 */
function sharedSecret(privateKey: Uint8Array, publicKey: string): Uint8Array {
	let peer: Uint8Array;
	try {
		peer = b64ToBytes(publicKey);
	} catch {
		throw new SyncCodecError("the pairing public key is not base64");
	}
	if (peer.length !== 32)
		throw new SyncCryptoError("the pairing public key length is off spec");
	try {
		return x25519.getSharedSecret(privateKey, peer);
	} catch {
		throw new SyncCryptoError("pairing key agreement failed");
	}
}

/**
 * The relayed envelope. To the server it is a single string. `epk` sits inside the envelope by
 * design. If it were pulled out, the server would learn the envelope's structure, and known
 * structure eventually becomes a target for validation, transformation or statistics. Inside, the
 * server stores only a string it cannot open. Key order is fixed as a literal so the same value
 * always yields the same string, which keeps diagnostics possible.
 */
export interface PairingEnvelope {
	v: number;
	/** Ephemeral public key of the trusted device, base64 of 32 bytes. */
	epk: string;
	/** Base64 of the 12-byte IV. */
	iv: string;
	/** base64(AES-256-GCM(DEK) ‖ tag). */
	ct: string;
}

export interface PairingSealInput {
	owner: string;
	/** Must already be passed through `normalizePairingCode`. */
	normalizedCode: string;
	/** Public key (base64) entrusted by the new device. */
	newPublicKey: string;
	dek: Uint8Array;
	aead: AeadProvider;
	/** Golden vectors and tests only. The production path leaves this unset. */
	seed?: { ephemeralPrivateKey?: Uint8Array; nonce?: Uint8Array };
}

/**
 * Trusted device: seals the current DEK. A new one-time key pair is generated for every pairing. A
 * fixed key would let one leaked private key open every past and future pairing envelope for the
 * account, and each of those carries the DEK.
 */
export async function sealPairingDek(
	input: PairingSealInput,
): Promise<{ payload: string }> {
	if (input.dek.length !== AEAD.keyBytes)
		throw new SyncCryptoError("the key to send by pairing is off spec");
	const ephemeralPrivateKey =
		input.seed?.ephemeralPrivateKey ?? x25519.utils.randomSecretKey();
	const nonce = input.seed?.nonce ?? randomBytes(AEAD.nonceBytes);
	const key = derivePairingKey(
		sharedSecret(ephemeralPrivateKey, input.newPublicKey),
		input.owner,
		input.normalizedCode,
	);
	const ct = await input.aead.encrypt(
		key,
		input.dek,
		pairingAad(input.owner, input.normalizedCode),
		nonce,
	);
	const envelope: PairingEnvelope = {
		v: SYNC_PAIRING_VERSION,
		epk: bytesToB64(x25519.getPublicKey(ephemeralPrivateKey)),
		iv: bytesToB64(nonce),
		ct: bytesToB64(ct),
	};
	return { payload: JSON.stringify(envelope) };
}

export interface PairingOpenInput {
	owner: string;
	normalizedCode: string;
	/** Private key this device generated when pairing started. */
	privateKey: Uint8Array;
	payload: string;
	aead: AeadProvider;
}

/**
 * New device: opens the envelope. All failures are thrown. There are several causes (wrong code,
 * tampered envelope, another account's envelope, a server-swapped public key), but they are not
 * distinguished here. Every failure has the same result, and the value is not remembered. Splitting
 * the causes would give an attacker a signal. A successful open does not prove the key belongs to
 * this account. That judgment is made by the keyring possession proof, which must pass once before
 * the controller remembers the key (§20).
 */
export async function openPairingDek(
	input: PairingOpenInput,
): Promise<Uint8Array> {
	const envelope = parsePairingEnvelope(input.payload);
	const nonce = b64ToBytes(envelope.iv);
	if (nonce.length !== AEAD.nonceBytes)
		throw new SyncCryptoError("the pairing envelope nonce length is off spec");
	const key = derivePairingKey(
		sharedSecret(input.privateKey, envelope.epk),
		input.owner,
		input.normalizedCode,
	);
	/**
	 * Converts AEAD failure into this package's error name. The library throws a plain Error (such as
	 * 'invalid tag'), which callers cannot use to tell a definite failure from a transient one.
	 * Screens and CLIs would read both as a network problem and retry several times before stopping.
	 * The cause is still not distinguished (wrong code, wrong account, or tampering). Only the name is
	 * made ours.
	 */
	let dek: Uint8Array;
	try {
		dek = await input.aead.decrypt(
			key,
			b64ToBytes(envelope.ct),
			pairingAad(input.owner, input.normalizedCode),
			nonce,
		);
	} catch (error) {
		if (error instanceof SyncCodecError) throw error;
		throw new SyncCryptoError("could not open the pairing envelope");
	}
	if (dek.length !== AEAD.keyBytes)
		throw new SyncCryptoError(
			"the key inside the pairing envelope is off spec",
		);
	return dek;
}

/**
 * Reads the envelope string. Client-only: the server does not know this function, which is not in
 * `@rowcat/sync/server`. If the server could parse envelopes, the next request would always be to
 * validate them too. Validation needs the structure, and a server that knows the structure is no
 * longer a relay.
 */
export function parsePairingEnvelope(payload: string): PairingEnvelope {
	let json: unknown;
	try {
		json = JSON.parse(payload);
	} catch {
		throw new SyncCodecError("the pairing envelope is not JSON");
	}
	if (!isPairingEnvelope(json))
		throw new SyncCodecError("the pairing envelope shape is off spec");
	if (json.v !== SYNC_PAIRING_VERSION)
		throw new SyncCryptoError(`unknown pairing envelope version: ${json.v}`);
	return json;
}

function isPairingEnvelope(value: unknown): value is PairingEnvelope {
	if (typeof value !== "object" || value === null) return false;
	const row = value as Record<string, unknown>;
	return (
		typeof row.v === "number" &&
		typeof row.epk === "string" &&
		typeof row.iv === "string" &&
		typeof row.ct === "string"
	);
}
