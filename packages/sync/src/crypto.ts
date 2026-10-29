import { randomBytes } from "@noble/hashes/utils.js";
import { EncryptedBlob, SYNC_ENVELOPE_VERSION } from "@rowcat/contracts/sync";
import { AEAD, type AeadProvider } from "./aead.ts";
import {
	b64ToBytes,
	bytesToB64,
	decodeRecordPlaintext,
	encodeRecordPlaintext,
	SyncCodecError,
	utf8ToBytes,
} from "./codec.ts";

/**
 * Record envelope encryption. This is the most expensive code in the repo to reverse.
 *
 * Changing the byte format forces every client to decrypt and re-encrypt all ciphertext already on
 * the server. Devices that are offline during that window cannot take part.
 *
 * Every constant here is locked by golden vectors in `__fixtures__/vectors.json`, so an accidental
 * change fails the tests first.
 */

/** Creates the DEK from a 256-bit CSPRNG. It is the only value the server never sees. */
export const generateDek = (): Uint8Array => randomBytes(AEAD.keyBytes);

/**
 * Crypto-layer failure. Kept separate from `SyncCodecError` so diagnostics can tell the cause
 * apart.
 */
export class SyncCryptoError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SyncCryptoError";
	}
}

/**
 * Domain-separation prefix, so the three kinds of ciphertext cannot be placed in each other's
 * slots.
 *
 * Legacy record AAD had no prefix (owner, id, type and version joined by NUL bytes). With the
 * prefix, placing a record ciphertext in a key-wrapper slot becomes structurally impossible.
 */
const RECORD_AAD_PREFIX = "rowcat.sync.rec.v1";
export const KEY_AAD_PREFIX = "rowcat.sync.key.v1";
/**
 * Prefix for the pairing transport envelope. That a third slot exists is itself the reason for this
 * value.
 *
 * A pairing envelope carries the DEK in plaintext and lives only five minutes, so it must never be
 * placed in a key-wrapper or record slot. A distinct prefix makes that cross-use fail at the AEAD
 * tag.
 */
export const PAIRING_AAD_PREFIX = "rowcat.sync.pair.v1";

/**
 * Record AAD is prefix, owner, recordId, type and envelopeVersion, joined by NUL bytes. Each bound
 * value blocks one attack: owner stops moving ciphertext to another account, recordId stops moving
 * it to another record, type stops a room ciphertext landing in a draft slot, and envelopeVersion
 * stops a downgrade.
 *
 * `version` is deliberately left out. The client cannot know the server-assigned version when it
 * encrypts, and baseVersion + 1 is a guess that breaks when a batch conflicts and retries after a
 * pull. Including it would force re-encryption on every retry and change the ciphertext per
 * request, which breaks the Idempotency-Key request hash. Rollback defense uses the `rev` inside
 * the authenticated plaintext (SyncPayloadEnvelope) instead.
 *
 * NUL is the separator because owner, id and type can never contain a NUL byte. A separator that
 * could appear in a value would let two different tuples serialize identically.
 */
export function recordAad(input: {
	owner: string;
	recordId: string;
	type: string;
	envelopeVersion: number;
}): Uint8Array {
	return utf8ToBytes(
		[
			RECORD_AAD_PREFIX,
			input.owner,
			input.recordId,
			input.type,
			String(input.envelopeVersion),
		].join("\0"),
	);
}

/**
 * Key-wrap AAD: prefix, owner and purpose, joined by NUL bytes. The only purpose in use today is
 * `recovery`.
 */
export const keyAad = (owner: string, purpose: string): Uint8Array =>
	utf8ToBytes([KEY_AAD_PREFIX, owner, purpose].join("\0"));

/**
 * Pairing AAD: prefix, owner and normalized code, joined by NUL bytes.
 *
 * The code in this AAD is the actual channel binding. The server receives only the code's hash, so
 * it cannot build this AAD itself. An envelope swapped in transit therefore fails its tag when the
 * new device opens it. Owner is bound too, so another account's approval envelope cannot be moved
 * into this session.
 *
 * The code must be normalized first. Otherwise sender and receiver derive different AADs, and that
 * failure looks identical to a wrong code.
 */
export const pairingAad = (owner: string, normalizedCode: string): Uint8Array =>
	utf8ToBytes([PAIRING_AAD_PREFIX, owner, normalizedCode].join("\0"));

export interface RecordIdentity {
	owner: string;
	recordId: string;
	type: string;
}

/**
 * Converts a payload into the ciphertext string to store. The nonce is 12 fresh random bytes on
 * every call.
 *
 * Deterministic nonces (counters or hashes) are avoided: reusing a nonce under the same key leaks
 * the GCM authentication key, and devices sharing one DEK cannot agree on a counter. The
 * random-nonce limit is about 2^32 messages per key, which member writes never approach. It is
 * still one reason a DEK rotation may eventually be needed.
 *
 * Tests may inject the nonce for golden vectors. The production path passes nothing.
 */
export async function encryptRecord(
	dek: Uint8Array,
	identity: RecordIdentity,
	payload: unknown,
	aead: AeadProvider,
	nonce: Uint8Array = randomBytes(AEAD.nonceBytes),
): Promise<string> {
	const plaintext = encodeRecordPlaintext(payload);
	const aad = recordAad({
		...identity,
		envelopeVersion: SYNC_ENVELOPE_VERSION,
	});
	const ct = await aead.encrypt(dek, plaintext, aad, nonce);
	const blob: EncryptedBlob = {
		v: SYNC_ENVELOPE_VERSION,
		iv: bytesToB64(nonce),
		ct: bytesToB64(ct),
	};
	/**
	 * Builds the string from a literal with fixed key order. `JSON.stringify` follows insertion order,
	 * and the same value must always produce the same string so that idempotent retries keep a stable
	 * request hash.
	 */
	return JSON.stringify(blob);
}

/**
 * Converts a ciphertext string back to a payload. Every failure throws.
 *
 * The engine catches these, ignores the record and advances the cursor (§19). Whether to ignore or
 * retry is the engine's decision, so returning null here would blur 'decryption failed' with
 * 'payload is null'.
 *
 * Throwing on an unknown envelope version matters. A future v2 envelope read as v1 would produce an
 * AEAD tag mismatch, which looks like a wrong key.
 */
export async function decryptRecord(
	dek: Uint8Array,
	identity: RecordIdentity,
	ciphertext: string,
	aead: AeadProvider,
): Promise<unknown> {
	const blob = parseEncryptedBlob(ciphertext);
	if (blob.v !== SYNC_ENVELOPE_VERSION)
		throw new SyncCryptoError(`unknown envelope version: ${blob.v}`);
	const nonce = b64ToBytes(blob.iv);
	if (nonce.length !== AEAD.nonceBytes)
		throw new SyncCryptoError("the nonce length is off spec");
	const aad = recordAad({ ...identity, envelopeVersion: blob.v });
	const plaintext = await aead.decrypt(dek, b64ToBytes(blob.ct), aad, nonce);
	return decodeRecordPlaintext(plaintext);
}

/**
 * Reads only the envelope shell, without decrypting. The server runs this check too.
 *
 * It verifies that the string parses as JSON, has the shape {v, iv, ct}, and that iv is 12 bytes of
 * base64. A request failing these checks cannot be opened by any key, so storing it has no purpose.
 */
export function parseEncryptedBlob(ciphertext: string): EncryptedBlob {
	let json: unknown;
	try {
		json = JSON.parse(ciphertext);
	} catch {
		throw new SyncCodecError("the encrypted envelope is not JSON");
	}
	const parsed = EncryptedBlob.safeParse(json);
	if (!parsed.success)
		throw new SyncCodecError(
			"the encrypted envelope shape breaks the contract",
		);
	return parsed.data;
}

/**
 * Envelope syntax predicate used by the server. Returns true or false and never throws.
 *
 * The server has no reason to explain the failure, since it is the client's own bug and the server
 * only needs the store-or-reject decision. So no exception path is created.
 */
export function isValidEnvelopeSyntax(
	ciphertext: string,
	declaredEnvelope: number,
): boolean {
	try {
		const blob = parseEncryptedBlob(ciphertext);
		if (blob.v !== declaredEnvelope) return false;
		return b64ToBytes(blob.iv).length === AEAD.nonceBytes;
	} catch {
		return false;
	}
}
