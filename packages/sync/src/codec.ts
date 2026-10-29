import { deflateSync, inflateSync } from "fflate";

/**
 * Conversion between bytes and characters: the easiest place in this package to depend on a
 * platform. Neither `Buffer` nor `atob` is used. The former exists only in Node and the latter only
 * in browsers, and neither is guaranteed on Hermes. Writing the conversion once by hand makes web,
 * Node, and Expo produce the same bytes. If that equivalence breaks, ciphertext made on one
 * platform cannot be opened on another. Performance is not a concern: base64 runs once per record
 * (envelope assembly), next to AES-GCM and DEFLATE, which already cost far more.
 */

/** Codec-layer failure: the format is invalid before the envelope is opened. */
export class SyncCodecError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SyncCodecError";
	}
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

export const utf8ToBytes = (text: string): Uint8Array =>
	utf8Encoder.encode(text);
export const bytesToUtf8 = (bytes: Uint8Array): string =>
	utf8Decoder.decode(bytes);

/* Used by the envelope (`iv`, `ct`) and the keyring. */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Builds the reverse index up front, since calling `indexOf` per character would rescan the string
 * each time.
 */
const B64_INVERSE = (() => {
	const table = new Int8Array(128).fill(-1);
	for (let i = 0; i < B64.length; i++) table[B64.charCodeAt(i)] = i;
	return table;
})();

export function bytesToB64(bytes: Uint8Array): string {
	let out = "";
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
		out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
		out += B64[(n >> 6) & 63] + B64[n & 63];
	}
	const rest = bytes.length - i;
	if (rest === 1) {
		const n = bytes[i] << 16;
		out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`;
	} else if (rest === 2) {
		const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
		out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`;
	}
	return out;
}

/**
 * Base64 to bytes. Throws on unknown characters. The legacy code skipped them silently. That turned
 * corrupted ciphertext into a shorter byte array, which then surfaced as an AEAD tag mismatch, so
 * 'damaged in transit' looked like 'wrong key'. For the user these are different events (the latter
 * asks them to re-enter the recovery code), so they are kept apart.
 */
export function b64ToBytes(text: string): Uint8Array {
	let end = text.length;
	while (end > 0 && text[end - 1] === "=") end--;
	const out = new Uint8Array(Math.floor((end * 3) / 4));
	let bits = 0;
	let value = 0;
	let oi = 0;
	for (let i = 0; i < end; i++) {
		const code = text.charCodeAt(i);
		const index = code < 128 ? B64_INVERSE[code] : -1;
		if (index < 0) throw new SyncCodecError("contains non-base64 characters");
		value = (value << 6) | index;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[oi++] = (value >> bits) & 0xff;
		}
	}
	return oi === out.length ? out : out.subarray(0, oi);
}

/* Hex: the value the server uses as a lookup key (pairing code hash). */

/**
 * Bytes to lowercase hex. Base64 already exists, so why keep hex? Because the two are used in
 * different places. This value goes into a database primary key and request bodies, where case
 * sensitivity and `+/=` become real problems (URL encoding, case-folding comparison, log
 * normalization). Hex avoids all three, so it is the same string wherever it is placed.
 *
 * `@noble/hashes` has the same function, but it is written here. This file exists so that
 * byte-to-text conversion is done in one place by hand; one exception would let each later
 * conversion appear in its own place.
 */
export function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
	return out;
}

/* Crockford base32: for recovery codes and pairing codes that people copy by hand. */

/**
 * Crockford alphabet: no confusable I, L, O, or U. Standard base32 (RFC 4648) is not used. A
 * recovery code is the one value users write on paper and type back in, and losing it means the
 * data can never be read. If 0 and O, or 1 and I, share an alphabet, the result is not a typo risk
 * but unreadable.
 */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function bytesToBase32(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = "";
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += B32[(value >> bits) & 31];
		}
	}
	// Leftover bits are zero-padded to form the final character. Decoding checks those zeros again.
	if (bits > 0) out += B32[(value << (5 - bits)) & 31];
	return out;
}

/**
 * Base32 to bytes. Throws if the padding bits are not zero. 16 bytes fit in 26 characters, which is
 * 130 bits, leaving 2 bits in the last character. Ignoring those bits would decode four different
 * last characters to the same 16 bytes, so a mistyped last character would pass. Passing is
 * harmless in itself, since the secret bits are identical, but the question 'is this string that
 * code?' becomes many-to-one, and a class of typos that the checksum should catch disappears. Only
 * the canonical encoding is accepted.
 */
export function base32ToBytes(text: string): Uint8Array {
	const out = new Uint8Array(Math.floor((text.length * 5) / 8));
	let bits = 0;
	let value = 0;
	let oi = 0;
	for (const ch of text) {
		const index = B32.indexOf(ch);
		if (index < 0)
			throw new SyncCodecError(
				"contains characters not allowed in a recovery code",
			);
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			out[oi++] = (value >> bits) & 0xff;
		}
	}
	if (bits > 0 && (value & ((1 << bits) - 1)) !== 0)
		throw new SyncCodecError(
			"the recovery code's last character is not canonical",
		);
	return out;
}

/* Record plaintext codec: the compression method is self-describing. */

/**
 * The first byte of the plaintext names the compression method. It sits inside the authenticated
 * plaintext, which is the point. Outside the envelope, a server or man-in-the-middle could flip it
 * and turn the decrypted result into garbage, and that failure would look the same as a wrong key.
 * Inside, the AES-GCM tag authenticates the byte as well.
 */
export const PLAINTEXT_CODEC = {
	identity: 0x00,
	/** Raw DEFLATE, with no zlib or gzip wrapper. The GCM tag already guarantees integrity. */
	deflate: 0x01,
} as const;

/**
 * Inputs below this size are not compressed. DEFLATE nearly always grows short input, because block
 * headers and Huffman tables outweigh the content. Below the threshold, compression would cost time
 * for no gain.
 */
const COMPRESS_MIN_BYTES = 256;

/**
 * Compresses only when the result is actually smaller. Assuming compression helped would make
 * already-compressed content (such as base64 images) grow, and the extra bytes would silently eat
 * into the record limit and the account quota. This is correctness, not an optimization. Drafts and
 * room `seed` values are repetitive text and usually shrink 3 to 5 times, which gives the limits
 * headroom.
 */
export function encodeRecordPlaintext(payload: unknown): Uint8Array {
	const raw = utf8ToBytes(JSON.stringify(payload));
	if (raw.length < COMPRESS_MIN_BYTES)
		return withCodec(PLAINTEXT_CODEC.identity, raw);
	const deflated = deflateSync(raw);
	return deflated.length < raw.length
		? withCodec(PLAINTEXT_CODEC.deflate, deflated)
		: withCodec(PLAINTEXT_CODEC.identity, raw);
}

const withCodec = (codec: number, body: Uint8Array): Uint8Array => {
	const out = new Uint8Array(body.length + 1);
	out[0] = codec;
	out.set(body, 1);
	return out;
};

/**
 * An unknown codec byte throws. It means compression written by a newer client. The engine should
 * skip that record and advance the cursor (§19), not guess. Silently falling back to identity would
 * pass garbage JSON to the parser and obscure the cause.
 */
export function decodeRecordPlaintext(bytes: Uint8Array): unknown {
	if (bytes.length < 1) throw new SyncCodecError("the plaintext is empty");
	const codec = bytes[0];
	const body = bytes.subarray(1);
	if (codec === PLAINTEXT_CODEC.identity) return JSON.parse(bytesToUtf8(body));
	if (codec === PLAINTEXT_CODEC.deflate)
		return JSON.parse(bytesToUtf8(inflateSync(body)));
	throw new SyncCodecError(`unknown plaintext codec: ${codec}`);
}

/**
 * Compares two secrets without `===`, which is the whole point of this function. String and array
 * comparison stops at the first mismatch. The time that takes reveals how many bytes matched, and
 * an attacker can use that signal to recover a MAC one byte at a time. The proof of possession
 * protects the keyring against an attacker who has only stolen a session, so a leak here would be
 * fatal.
 *
 * Different lengths return false immediately. Length is not secret (MAC length is fixed), and
 * padding the shorter side to hide length would make the comparison itself wrong.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}
