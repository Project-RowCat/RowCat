import { gcm } from "@noble/ciphers/aes.js";

/**
 * AEAD provider: the only place where this package yields to the platform. Web uses `crypto.subtle`
 * for hardware acceleration; Node, Expo, and tests run pure JS. Both paths use the same byte format
 * (AES-256-GCM with the tag appended to the ciphertext), so each can decrypt the other's output. A
 * golden-vector test locks that in.
 *
 * KDF does not go here. `crypto.subtle` has HKDF, but it is not used: two paths could derive subtly
 * different keys, and a mismatched derived key shows up as 'wrong recovery code'. KDF is not a
 * bottleneck, so it is unified on noble (`keyring.ts`).
 *
 * The interface is async because of `crypto.subtle`. noble is synchronous, but a synchronous port
 * would prevent a web adapter from fitting in. The interface should match the slower
 * implementation.
 */
export interface AeadProvider {
	/** Returns ciphertext with the 16-byte tag appended. */
	encrypt(
		key: Uint8Array,
		plaintext: Uint8Array,
		aad: Uint8Array,
		nonce: Uint8Array,
	): Promise<Uint8Array>;
	/** Throws if the tag does not match. Never returns an empty value silently. */
	decrypt(
		key: Uint8Array,
		ciphertext: Uint8Array,
		aad: Uint8Array,
		nonce: Uint8Array,
	): Promise<Uint8Array>;
}

/**
 * Fixed AES-256-GCM parameters. All three values are also used when building the AAD and in server
 * validation.
 */
export const AEAD = {
	keyBytes: 32,
	nonceBytes: 12,
	tagBytes: 16,
} as const;

/**
 * Pure JS implementation, the default that runs everywhere. Web does not need to inject
 * `subtleAead`. Node tests and Expo run without an adapter; the web adapter is an optional
 * performance choice, not a precondition. The legacy code reversed the order (subtle first), which
 * forced a polyfill into every test environment.
 */
export const nobleAead: AeadProvider = {
	async encrypt(key, plaintext, aad, nonce) {
		return gcm(key, nonce, aad).encrypt(plaintext);
	},
	async decrypt(key, ciphertext, aad, nonce) {
		return gcm(key, nonce, aad).decrypt(ciphertext);
	},
};
