import { describe, expect, it } from "vitest";
import {
	b64ToBytes,
	base32ToBytes,
	bytesToB64,
	bytesToBase32,
	bytesToUtf8,
	decodeRecordPlaintext,
	encodeRecordPlaintext,
	PLAINTEXT_CODEC,
	SyncCodecError,
	utf8ToBytes,
} from "./codec.ts";

/**
 * Byte conversion. If this is wrong, one platform cannot open ciphertext produced by another.
 * Because `Buffer` and `atob` are not used and the code is hand-written, this file checks that the
 * hand-written code has no slips. Padding at lengths that are not multiples of 3, and extremes such
 * as 0x00 and 0xff, are where slips show up.
 */

describe("base64", () => {
	it.each([
		0, 1, 2, 3, 4, 5, 16, 31, 32, 255,
	])("round-trips %s bytes", (length) => {
		const bytes = Uint8Array.from({ length }, (_, i) => (i * 37) & 0xff);
		expect(b64ToBytes(bytesToB64(bytes))).toEqual(bytes);
	});

	it("round-trips with 0x00 and 0xff mixed in", () => {
		const bytes = new Uint8Array([0, 255, 0, 255, 128, 1]);
		expect(b64ToBytes(bytesToB64(bytes))).toEqual(bytes);
	});

	it("produces the same string as the standard implementation", () => {
		// Checks against another implementation (`btoa`). A round trip alone passes even when both
		// directions are wrong.
		const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 91) & 0xff);
		const expected = btoa(String.fromCharCode(...bytes));
		expect(bytesToB64(bytes)).toBe(expected);
	});

	it("non-base64 characters **throw** rather than being skipped", () => {
		expect(() => b64ToBytes("AA*A")).toThrow(SyncCodecError);
	});
});

describe("Crockford base32", () => {
	it("round-trips 16 bytes", () => {
		const bytes = Uint8Array.from({ length: 16 }, (_, i) => (i * 13) & 0xff);
		expect(base32ToBytes(bytesToBase32(bytes))).toEqual(bytes);
	});

	it("keeps confusable letters (I, L, O, U) out of the alphabet", () => {
		const bytes = Uint8Array.from({ length: 64 }, (_, i) => i * 4);
		expect(bytesToBase32(bytes)).not.toMatch(/[ILOU]/);
	});

	it("refuses a non-canonical last character", () => {
		const canonical = bytesToBase32(new Uint8Array(16));
		expect(() => base32ToBytes(canonical)).not.toThrow();
		expect(() => base32ToBytes(`${canonical.slice(0, -1)}1`)).toThrow(
			SyncCodecError,
		);
	});

	it("characters outside the alphabet throw", () => {
		expect(() => base32ToBytes("ABCU")).toThrow(SyncCodecError);
	});
});

describe("plaintext codecs", () => {
	it("short payloads are not compressed", () => {
		const encoded = encodeRecordPlaintext({ a: 1 });
		expect(encoded[0]).toBe(PLAINTEXT_CODEC.identity);
		expect(decodeRecordPlaintext(encoded)).toEqual({ a: 1 });
	});

	it("long repetitive payloads are compressed and really shrink", () => {
		const payload = { text: "This sentence repeats. ".repeat(200) };
		const encoded = encodeRecordPlaintext(payload);
		expect(encoded[0]).toBe(PLAINTEXT_CODEC.deflate);
		expect(encoded.length).toBeLessThan(
			utf8ToBytes(JSON.stringify(payload)).length,
		);
		expect(decodeRecordPlaintext(encoded)).toEqual(payload);
	});

	it("never larger than identity for any payload", () => {
		/**
		 * Checks that the code does not assume compression helped. On real JSON text DEFLATE almost
		 * always wins, since single-byte characters carry less than 8 bits of entropy. So the branch that
		 * falls back to identity is a defense, not a common path. Because it is rare, this test locks it
		 * down. If payloads ever start carrying already-compressed bytes (asset references, inline
		 * blobs), that branch runs for the first time, and if its condition were inverted by then,
		 * records would grow silently.
		 */
		let seed = 7;
		const random = (): number => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed >>> 8;
		};
		const payloads: unknown[] = [
			{ a: 1 },
			{ text: "This sentence repeats. ".repeat(200) },
			{
				noise: Array.from({ length: 900 }, () =>
					String.fromCharCode(33 + (random() % 94)),
				).join(""),
			},
			{ numbers: Array.from({ length: 400 }, () => random()) },
			{ mixed: "The Night Library 🌙".repeat(40), n: random() },
		];
		for (const payload of payloads) {
			const encoded = encodeRecordPlaintext(payload);
			const identitySize = utf8ToBytes(JSON.stringify(payload)).length + 1;
			expect(encoded.length).toBeLessThanOrEqual(identitySize);
			expect(decodeRecordPlaintext(encoded)).toEqual(payload);
		}
	});

	it("an unknown codec byte throws", () => {
		expect(() =>
			decodeRecordPlaintext(new Uint8Array([0x7f, 0x7b, 0x7d])),
		).toThrow(SyncCodecError);
	});

	it("an empty plaintext throws", () => {
		expect(() => decodeRecordPlaintext(new Uint8Array(0))).toThrow(
			SyncCodecError,
		);
	});

	it("Hangul and emoji round-trip", () => {
		const payload = {
			title: "The Night Library 🌙",
			body: "long manuscript".repeat(50),
		};
		expect(decodeRecordPlaintext(encodeRecordPlaintext(payload))).toEqual(
			payload,
		);
		expect(bytesToUtf8(utf8ToBytes("night 🌙"))).toBe("night 🌙");
	});
});
