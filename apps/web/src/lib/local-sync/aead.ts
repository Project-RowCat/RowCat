import type { AeadProvider } from "@rowcat/sync";

/**
 * Browser AEAD: a crypto.subtle adapter.
 * - Same byte format as the noble implementation in @rowcat/sync: AES-256-GCM, a 12-byte nonce,
 *   and the 16-byte tag appended after the ciphertext. This equivalence is the only reason the file
 *   exists. Golden-vector tests lock it in both directions. If the format diverges, mobile cannot
 *   open web data.
 * - The KDF is not here. crypto.subtle also offers HKDF, but it is not used. Two derivation paths
 *   could diverge subtly, and diverged keys would show users as "the recovery code is wrong". It is
 *   not a performance bottleneck either.
 * - The gain is hardware acceleration. One bootstrap encrypts thousands of records, where the
 *   difference from pure JS is real.
 */

/**
 * Cache from key material to CryptoKey, backed by a WeakMap. Once the DEK object is dropped, its
 * derived keys go with it. A string-keyed map would live for the module's whole lifetime and keep a
 * previous account's key material in memory after logout. The cache is per adapter instance for the
 * same reason: a module-global cache would become a key store that is not tied to any account.
 */
export function createSubtleAead(): AeadProvider {
	const imported = new WeakMap<Uint8Array, Promise<CryptoKey>>();

	const keyOf = (raw: Uint8Array): Promise<CryptoKey> => {
		const cached = imported.get(raw);
		if (cached) return cached;
		/**
		 * Imported with `extractable: false`. The bytes never need to be read back out of this key. If
		 * the key is not extractable, no code path can export it and write it to a log.
		 */
		const pending = crypto.subtle.importKey(
			"raw",
			raw as unknown as BufferSource,
			{ name: "AES-GCM" },
			false,
			["encrypt", "decrypt"],
		);
		imported.set(raw, pending);
		return pending;
	};

	return {
		async encrypt(key, plaintext, aad, nonce) {
			const result = await crypto.subtle.encrypt(
				{
					name: "AES-GCM",
					iv: nonce as unknown as BufferSource,
					additionalData: aad as unknown as BufferSource,
				},
				await keyOf(key),
				plaintext as unknown as BufferSource,
			);
			return new Uint8Array(result);
		},
		async decrypt(key, ciphertext, aad, nonce) {
			/**
			 * A tag mismatch makes `crypto.subtle` throw, and this code must not return an empty value. If
			 * the error were swallowed, 'decryption failed' and 'content is empty' would look the same. The
			 * engine would then apply the record and corrupt the local data.
			 */
			const result = await crypto.subtle.decrypt(
				{
					name: "AES-GCM",
					iv: nonce as unknown as BufferSource,
					additionalData: aad as unknown as BufferSource,
				},
				await keyOf(key),
				ciphertext as unknown as BufferSource,
			);
			return new Uint8Array(result);
		},
	};
}
