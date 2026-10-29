import { sha256 } from "@noble/hashes/sha2.js";
import type { DeviceKeyStore } from "@rowcat/sync";
import {
	AEAD,
	b64ToBytes,
	bytesToB64,
	bytesToHex,
	utf8ToBytes,
} from "@rowcat/sync";

/**
 * Mobile implementation of "trust this device": the DEK lives only in Keychain/Keystore.
 *
 * On the web, the DEK is wrapped with a non-extractable `CryptoKey` and kept in a per-member
 * IndexedDB. That works because IndexedDB can store a `CryptoKey` object without ever exposing its
 * bytes. SQLite has no such slot, and copying the same arrangement here would mean writing the key
 * into a plaintext file. So mobile uses the OS secret store.
 *
 * The one boundary this file guards: **the DEK is never stored in SQLite, AsyncStorage, a plaintext
 * file, React state, or the query cache.** It lives in memory only for the lifetime of the
 * controller that is currently syncing.
 *
 * The storage implementation (`SecureKeyStorage`) is an argument so it can be verified.
 * `expo-secure-store` is a native module and does not open in Node, and a mock would let tests pass
 * without anyone checking that **scope, encoding and validation** actually work. The rules here
 * (per-member entry name, base64, length check) are verified on top of the memory implementation.
 * Whether the Keychain really stores values is left to simulator QA (`README.md`).
 */

/** The three operations of the secret store. `expo-secure-store` fills this shape as-is. */
export interface SecureKeyStorage {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
}

const SECURE_KEY_PREFIX = "rowcat.sync.dek.";

/**
 * Per-member key name. **No single global key is used.**
 *
 * With a name like `"rowcat.dek"`, a DEK Alice remembered on this device would be read straight out
 * by Bob's scope. That is not a lock screen bug, it is **cross-account decryption**. Legacy started
 * from a single member-agnostic store and hit this for real. The reason `DeviceKeyStore` has no
 * owner parameter is the same: ownership must already be held by the store, and callers must not be
 * able to choose it.
 *
 * Two reasons the member id goes through SHA-256 rather than being used directly. One is format:
 * SecureStore key names allow only certain characters, and a filtering scheme can fold different
 * members to the same name (then the incident above happens). The other is traces: Keychain entry
 * names persist into backups and diagnostic tools, so there is no reason to write the member
 * identifier there in plain text.
 */
export const deviceKeyEntry = (viewerId: string): string =>
	`${SECURE_KEY_PREFIX}${bytesToHex(sha256(utf8ToBytes(viewerId)))}`;

export function createMobileDeviceKeyStore(
	storage: SecureKeyStorage,
	viewerId: string,
): DeviceKeyStore {
	const entry = deviceKeyEntry(viewerId);
	return {
		/**
		 * Written as base64. SecureStore handles strings, and this file does not invent its own
		 * byte-to-string encoding. Reusing the codec the protocol already uses (`@rowcat/sync`) leaves no
		 * room for the two representations to diverge.
		 */
		async remember(dek) {
			await storage.set(entry, bytesToB64(dek));
		},

		/**
		 * The value read back is **length-checked.**
		 *
		 * It is neither truncated nor padded. Trying to decrypt with a value outside the spec would make
		 * the failure show up as "the record is corrupt" rather than "this device is not trusted", and
		 * that diagnosis pushes the user away from the normal unlock path. A corrupt value is treated as
		 * **absent**: returning null sends the controller to the locked state, and the recovery-code
		 * entry opens.
		 */
		async recall() {
			const stored = await storage.get(entry);
			if (!stored) return null;
			try {
				const dek = b64ToBytes(stored);
				return dek.length === AEAD.keyBytes ? dek : null;
			} catch {
				return null;
			}
		},

		/**
		 * Trust revoked. This applies **only to this member on this device.**
		 *
		 * Nothing on the server is touched. Attaching a remote-revoke-looking operation here would be a
		 * lie: reverting the knowledge on a device that already holds the DEK is cryptographically
		 * impossible without DEK rotation plus full re-encryption.
		 */
		forget: () => storage.remove(entry),
	};
}
