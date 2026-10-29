import { type ByoProvider, isByoProviderName } from "@rowcat/chat";

/**
 * Physical shape of a stored provider connection, and the read boundary for it. Kept apart from
 * local-generation/record.ts on purpose: these rows stay on the device for months, and their fields
 * may grow or the format may change. One merged type would let the compiler claim fields that real
 * rows do not have.
 *
 * Deliberately absent:
 * - Plaintext API key. Only ciphertext and the wrapping key exist, and the wrapping key cannot be
 *   exported as bytes (see crypto.ts).
 * - Sync fields (dirty, rev, serverVersion, deletedAt). Their absence is the point: if they
 *   existed, someone would fill them and the user's key would be uploaded to the server.
 * - Endpoint URL. The Anthropic and Gemini addresses are fixed. Accepting arbitrary endpoints
 *   would widen the CSP, mixed-content, and network trust boundaries (OpenAI-compatible support is
 *   deferred).
 * - Key fingerprint, last four characters, or hash. Nothing displays them. `Linked` / `Not connected`
 *   (connected / not connected) is enough, and a fingerprint could be used for offline matching.
 * - Organization or project id. No screen uses them, and storing them would bind the credential's
 *   identity to the record.
 */

/**
 * Schema version. Only 1 exists so far. The version exists because this value stays on the user's
 * device for a long time. When the cipher format changes (AAD layout, IV length, algorithm), old
 * rows must be recognizable, or they would have to be discarded and the user would have to paste
 * the key again. A row with an unknown version is read as "no connection" rather than decrypted
 * while only half understood.
 */
export const PROVIDER_CONNECTION_VERSION = 1;

/**
 * One row per provider, keyed by provider name. This is a product rule. Allowing several keys per
 * provider would add a "which key this generation used" axis. That axis has no place in preferences
 * or room records and must not get one: once credential identity attaches to a conversation record,
 * it would sync.
 */
export interface StoredProviderConnection {
	provider: ByoProvider;
	version: number;
	/**
	 * Identity of this connection record, and part of the AAD. It binds the ciphertext to this row. A
	 * new id is issued on every key replacement, so copying old ciphertext into a new row fails to
	 * decrypt.
	 */
	connectionId: string;
	/**
	 * The wrapping key is stored as a non-extractable CryptoKey object. IndexedDB can store a
	 * CryptoKey by structured clone, and a non-extractable key comes back without its raw bytes ever
	 * being readable, so no raw key material is on disk. The limits of this approach are documented in
	 * the crypto.ts header.
	 */
	wrapKey: CryptoKey;
	/** AES-GCM nonce, 12 bytes. A new one is drawn on every seal. */
	iv: Uint8Array;
	/** AES-GCM ciphertext with the auth tag appended. The plaintext is the UTF-8 encoded API key. */
	ct: Uint8Array;
	/**
	 * ISO timestamp of the last connect or key replacement. The screen shows it as `Connected since`.
	 */
	updatedAt: string;
}

/**
 * The summary type the screen receives, with no credential material in it. No ciphertext, wrap key,
 * or plaintext reaches React values. If a component held the wrap key, code calling decrypt would
 * eventually appear and run somewhere in the render tree.
 */
export interface ProviderConnectionSummary {
	provider: ByoProvider;
	connected: true;
	updatedAt: string;
}

/**
 * Converts a row to a summary. Never throws, for any input. A corrupt row becomes null (no
 * connection). Throwing would break the whole settings screen, and the recovery path is
 * reconnecting from that same screen. Rows with a different schema version are handled the same
 * way. Half-understanding a future version and attempting decryption would be indistinguishable
 * from a wrong key.
 */
export function readProviderConnection(
	row: StoredProviderConnection | undefined,
): ProviderConnectionSummary | null {
	if (!row || row.version !== PROVIDER_CONNECTION_VERSION) return null;
	if (!isByoProviderName(row.provider)) return null;
	if (!row.wrapKey || !row.iv?.length || !row.ct?.length) return null;
	return {
		provider: row.provider,
		connected: true,
		updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
	};
}
