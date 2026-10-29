/**
 * Port for device key storage. The platform implementation of 'this device is trusted' is hidden
 * behind it. Web wraps the DEK with a non-extractable CryptoKey and keeps it in a per-member local
 * DB. Mobile will use Keychain or Keystore. This package knows neither; it needs only remember,
 * recall and forget.
 *
 * The port has no owner parameter on purpose. Storage is already scoped per member, and an owner
 * argument would let callers choose whose key to fetch. The legacy single store, which was not
 * member-scoped, caused a real cross-account unlock bug.
 */
export interface DeviceKeyStore {
	/**
	 * Remembers the DEK on this device. Implementations must never store it in plaintext; that is part
	 * of the contract.
	 */
	remember(dek: Uint8Array): Promise<void>;
	/**
	 * Returns the remembered DEK, or null if there is none. Null is not an error, since an untrusted
	 * device is a normal state.
	 */
	recall(): Promise<Uint8Array | null>;
	/** Revokes trust on this device only. Local only; nothing on the server is touched. */
	forget(): Promise<void>;
}
