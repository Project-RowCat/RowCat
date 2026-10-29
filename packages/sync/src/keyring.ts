import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { AEAD, type AeadProvider } from "./aead.ts";
import {
	b64ToBytes,
	base32ToBytes,
	bytesToB64,
	bytesToBase32,
	SyncCodecError,
	timingSafeEqual,
	utf8ToBytes,
} from "./codec.ts";
import { keyAad, SyncCryptoError } from "./crypto.ts";

/**
 * Keyring: how the DEK is kept without the server being able to read it.
 *
 * The server holds only two pieces of key material, and neither can recover the DEK:
 * - keyring: the DEK wrapped with a key derived from the recovery code, plus that derivation's
 *   salt.
 * - authKey: HKDF(DEK, salt = owner). One-way; used only to verify proof of possession.
 *
 * authKey is never returned in any response, and that is the core defense. An attacker holding only
 * a session cannot derive authKey, so cannot produce a valid MAC for a new keyring. They can
 * therefore neither read the data nor swap the keyring to lock the user out. Key replacement would
 * permanently destroy the user's data, which matters more than a failed read.
 */

/** Length of the recovery secret: 128 bits. The user does not choose it; it is not a password. */
const RECOVERY_BYTES = 16;
/**
 * HKDF salt length. The same recovery code must yield a different wrapping key for each keyring.
 */
const RECOVERY_SALT_BYTES = 16;

/**
 * Argon2, scrypt and PBKDF2 are deliberately not used. Memory-hard KDFs protect low-entropy,
 * human-chosen passwords from dictionary attacks. The input here is 128-bit random data, so there
 * is nothing to guess. Extra work would only slow unlocking and add no real security. The 1Password
 * Secret Key makes the same choice for the same reason.
 *
 * The product cost is accepted: the recovery code is not a password that can be re-entered or
 * reset. If it is lost, it is gone, because the server cannot know it and cannot show it again.
 */
const RECOVERY_HKDF_INFO = "rowcat-sync-recovery-v1";
const AUTH_HKDF_INFO = "rowcat-sync-auth-v1";

/**
 * Purpose label in the key-wrap AAD. Other wrappers added later, such as pairing, get separate
 * slots.
 */
const RECOVERY_PURPOSE = "recovery";

/**
 * Format version of the keyring JSON. Bump it when the format changes. Reverting such a change is
 * the second most expensive kind after an envelope change.
 */
export const KEYRING_VERSION = 1;

/**
 * Shape of the keyring the server stores.
 *
 * The server does not interpret this structure. It stores and returns the client-produced string
 * unchanged. Re-serializing could change key order or whitespace, and the proof is a MAC over that
 * exact string, so a single changed character fails verification.
 */
export interface KeyringPayload {
	v: number;
	/** Base64 of a 16-byte salt. */
	recoverySalt: string;
	wrapped: { iv: string; ct: string };
}

const RECOVERY_PREFIX = "RCAT";
/** 16 bytes encode to 26 characters: 130 bits, of which 2 are padding. */
const RECOVERY_DATA_CHARS = 26;
/**
 * The checksum is two characters, 10 bits. The legacy code used one character (byte sum mod 32),
 * which was changed for two reasons.
 *
 * A byte sum has a structural blind spot: some single-character typos change the sum by exactly 32
 * and pass unnoticed. A hash-derived checksum has no such systematic gap.
 *
 * Even a hash-derived single character misses about 1 in 32 errors. Those misses surface only as an
 * AEAD failure, which reads as `cannot open the data` rather than `wrong code`. Ten bits cut the miss rate to
 * about 1 in 1024.
 *
 * The 28 characters (26 + 2) split into seven groups of four, which is easier to copy. 27 would
 * leave a last group of three.
 */
const RECOVERY_CHECK_CHARS = 2;
const RECOVERY_TOTAL_CHARS = RECOVERY_DATA_CHARS + RECOVERY_CHECK_CHARS;

const B32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Two-character checksum derived from the secret bytes. It catches typos and does not reveal the
 * secret.
 */
function recoveryChecksum(bytes: Uint8Array): string {
	const digest = sha256(bytes);
	const bits = ((digest[0] << 8) | digest[1]) & 0x3ff;
	return B32_ALPHABET[(bits >> 5) & 31] + B32_ALPHABET[bits & 31];
}

/** Produces the `RCAT-XXXX-…` form: the prefix followed by seven groups of four characters. */
export function encodeRecoveryCode(bytes: Uint8Array): string {
	if (bytes.length !== RECOVERY_BYTES)
		throw new SyncCryptoError("the recovery secret length is off spec");
	const body = bytesToBase32(bytes) + recoveryChecksum(bytes);
	return `${RECOVERY_PREFIX}-${(body.match(/.{1,4}/g) ?? []).join("-")}`;
}

/**
 * Converts a human-entered string into 16 bytes. The checksum is verified before AEAD.
 *
 * The order decides the message the user sees. A typo fails the checksum and gets `Check the code again`. A
 * well-formed code that is wrong fails only at the AEAD tag and gets `This code can't open it`. Merging the
 * two would leave users unable to tell a typo from another account's code.
 *
 * Normalization absorbs only notation differences: case, hyphens and spaces, and Crockford's
 * confusable letters (O to 0, I and L to 1, U to V). It never guesses secret bits. That would be
 * manipulation, and a manipulated code that happened to become another valid code would hide the
 * real failure.
 */
export function decodeRecoveryCode(code: string): Uint8Array {
	let compact = code.toUpperCase().replace(/[^0-9A-Z]/g, "");
	/**
	 * Strips the prefix only when the length matches. `RCAT` is four valid base32 characters, so
	 * stripping it unconditionally would break any code whose body starts with those letters.
	 */
	if (
		compact.startsWith(RECOVERY_PREFIX) &&
		compact.length === RECOVERY_PREFIX.length + RECOVERY_TOTAL_CHARS
	)
		compact = compact.slice(RECOVERY_PREFIX.length);
	compact = compact.replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");

	if (compact.length !== RECOVERY_TOTAL_CHARS)
		throw new SyncCodecError("the recovery code has the wrong length");

	const data = compact.slice(0, RECOVERY_DATA_CHARS);
	const check = compact.slice(RECOVERY_DATA_CHARS);
	const bytes = base32ToBytes(data);
	if (bytes.length !== RECOVERY_BYTES)
		throw new SyncCodecError("the recovery code has the wrong length");
	if (recoveryChecksum(bytes) !== check)
		throw new SyncCodecError(
			"the recovery code checksum does not match; check for typos",
		);
	return bytes;
}

const deriveRecoveryKey = (
	recovery: Uint8Array,
	salt: Uint8Array,
): Uint8Array =>
	hkdf(sha256, recovery, salt, utf8ToBytes(RECOVERY_HKDF_INFO), AEAD.keyBytes);

/**
 * Auth key for proof of possession: HKDF-SHA256(DEK, salt = owner, info = auth-v1).
 *
 * The owner salt is the point. The same DEK under a different account yields a different authKey,
 * so a proof obtained in one account cannot be reused to replace another account's keyring.
 *
 * The derivation is one-way, so the server cannot recover the DEK from it. The server still never
 * returns this value, because knowing it would let someone replace the keyring.
 */
export const deriveAuthKey = (dek: Uint8Array, owner: string): Uint8Array =>
	hkdf(
		sha256,
		dek,
		utf8ToBytes(owner),
		utf8ToBytes(AUTH_HKDF_INFO),
		AEAD.keyBytes,
	);

/**
 * Proof of possession: HMAC-SHA256(authKey, keyring string).
 *
 * The input is the exact string the server stores, not the parsed object. Re-serializing an object
 * can vary key order and whitespace between implementations, and that difference would produce a
 * different MAC.
 */
export const proveKeyring = (authKey: Uint8Array, keyring: string): string =>
	bytesToB64(hmac(sha256, authKey, utf8ToBytes(keyring)));

/**
 * Proof verification, constant time and fail-closed. A value that is not base64 returns false
 * instead of throwing.
 *
 * The server calls this. If malformed input and a proof mismatch returned different status codes,
 * that difference alone would tell an attacker something.
 */
export function verifyKeyringProof(
	authKey: Uint8Array,
	keyring: string,
	proof: string,
): boolean {
	let provided: Uint8Array;
	try {
		provided = b64ToBytes(proof);
	} catch {
		return false;
	}
	return timingSafeEqual(hmac(sha256, authKey, utf8ToBytes(keyring)), provided);
}

export interface CreatedKeyring {
	/** Sent to the server as this exact string. Do not re-serialize it. */
	keyring: string;
	/** Base64. Sent only in the initial registration request. */
	authKey: string;
	/** Shown to the user once. The server does not know it, so it cannot be regenerated. */
	recoveryCode: string;
	dek: Uint8Array;
}

/**
 * The optional `recovery`, `salt` and `nonce` inputs exist only for golden vectors. Production
 * passes none, and the CSPRNG fills them. Because the defaults are random, a production call could
 * pass a test value only by writing it explicitly.
 */
export async function buildKeyring(
	owner: string,
	dek: Uint8Array,
	aead: AeadProvider,
	seed: {
		recovery?: Uint8Array;
		salt?: Uint8Array;
		nonce?: Uint8Array;
	} = {},
): Promise<{ keyring: string; recoveryCode: string }> {
	const recovery = seed.recovery ?? randomBytes(RECOVERY_BYTES);
	const salt = seed.salt ?? randomBytes(RECOVERY_SALT_BYTES);
	const nonce = seed.nonce ?? randomBytes(AEAD.nonceBytes);
	const wrapKey = deriveRecoveryKey(recovery, salt);
	const ct = await aead.encrypt(
		wrapKey,
		dek,
		keyAad(owner, RECOVERY_PURPOSE),
		nonce,
	);
	const payload: KeyringPayload = {
		v: KEYRING_VERSION,
		recoverySalt: bytesToB64(salt),
		wrapped: { iv: bytesToB64(nonce), ct: bytesToB64(ct) },
	};
	return {
		// Key order is fixed by the literal. The proof is bound to this string, so it must be stable.
		keyring: JSON.stringify(payload),
		recoveryCode: encodeRecoveryCode(recovery),
	};
}

export async function createKeyring(
	owner: string,
	dek: Uint8Array,
	aead: AeadProvider,
	seed?: { recovery?: Uint8Array; salt?: Uint8Array; nonce?: Uint8Array },
): Promise<CreatedKeyring> {
	const { keyring, recoveryCode } = await buildKeyring(owner, dek, aead, seed);
	return {
		keyring,
		authKey: bytesToB64(deriveAuthKey(dek, owner)),
		recoveryCode,
		dek,
	};
}

/**
 * A failure can happen at two stages, and the two mean different things. `decodeRecoveryCode`
 * failing means a typo: the checksum caught it and AEAD was never called. `aead.decrypt` failing
 * means the syntax is valid but this keyring does not accept this code, for example another
 * account's code or an old one.
 *
 * There is deliberately no separate verifier. The code is judged only by the AEAD tag, so neither
 * the server nor the device holds anything that can check it in advance.
 */
export async function unlockWithRecovery(
	owner: string,
	keyring: string,
	code: string,
	aead: AeadProvider,
): Promise<Uint8Array> {
	const recovery = decodeRecoveryCode(code);
	const payload = parseKeyring(keyring);
	const salt = b64ToBytes(payload.recoverySalt);
	const wrapKey = deriveRecoveryKey(recovery, salt);
	const dek = await aead.decrypt(
		wrapKey,
		b64ToBytes(payload.wrapped.ct),
		keyAad(owner, RECOVERY_PURPOSE),
		b64ToBytes(payload.wrapped.iv),
	);
	if (dek.length !== AEAD.keyBytes)
		throw new SyncCryptoError("the key in the keyring is off spec");
	return dek;
}

/**
 * Reissues the recovery code. **The DEK stays the same.**
 *
 * Only the salt and the wrapper change, so no re-encryption is needed. The old salt and wrapper
 * disappear, which invalidates the previous code immediately. Records already uploaded still open
 * with the same DEK.
 *
 * The DEK is not rotated as well. That would re-upload every record under a new key, and devices
 * offline during that window could not take part. Real device revocation needs a separate slice
 * (§29.5).
 */
export async function rotateRecovery(
	owner: string,
	dek: Uint8Array,
	aead: AeadProvider,
	seed?: { recovery?: Uint8Array; salt?: Uint8Array; nonce?: Uint8Array },
): Promise<{ keyring: string; recoveryCode: string; proof: string }> {
	const { keyring, recoveryCode } = await buildKeyring(owner, dek, aead, seed);
	return {
		keyring,
		recoveryCode,
		proof: proveKeyring(deriveAuthKey(dek, owner), keyring),
	};
}

/** Parses the keyring string. Clients only; the server never calls this. */
export function parseKeyring(keyring: string): KeyringPayload {
	let json: unknown;
	try {
		json = JSON.parse(keyring);
	} catch {
		throw new SyncCodecError("the keyring is not JSON");
	}
	if (!isKeyringPayload(json))
		throw new SyncCodecError("the keyring shape is off spec");
	if (json.v !== KEYRING_VERSION)
		throw new SyncCryptoError(`unknown keyring version: ${json.v}`);
	return json;
}

function isKeyringPayload(value: unknown): value is KeyringPayload {
	if (typeof value !== "object" || value === null) return false;
	const row = value as Record<string, unknown>;
	const wrapped = row.wrapped as Record<string, unknown> | undefined;
	return (
		typeof row.v === "number" &&
		typeof row.recoverySalt === "string" &&
		typeof wrapped === "object" &&
		wrapped !== null &&
		typeof wrapped.iv === "string" &&
		typeof wrapped.ct === "string"
	);
}
