import type {
	KeyringDto,
	KeyringRewrapRequest,
	KeyringSetupRequest,
	KeyringVerifyRequest,
	PullResponse,
	PushItem,
	PushResponse,
	SyncPairingApproveRequest,
	SyncPairingDto,
	SyncPairingLookupRequest,
	SyncPairingStartRequest,
} from "@rowcat/contracts/sync";

/**
 * Transport port: protocol operations, not HTTP. This package knows no fetch, URL or cookies. Those
 * belong to @rowcat/sdk, and the web assembly point adapts that client to this shape. The direction
 * is deliberate. If the SDK knew protocol orchestration (retries, chunking, state machine), the
 * transport layer would hold state, and Expo could not use the same SDK with a different engine.
 */

/**
 * Structural minimal subset of AbortSignal. This avoids putting DOM types in lib. Once included,
 * this package could see document and window, and anything visible eventually gets used. A real
 * AbortSignal satisfies this shape, so web passes it through unchanged.
 */
export interface SyncSignal {
	readonly aborted: boolean;
}

export interface SyncRequestOptions {
	signal?: SyncSignal;
}

export interface SyncTransport {
	/** Returns { keyring: string | null }. authKey never arrives through any path. */
	getKeyring(options?: SyncRequestOptions): Promise<KeyringDto>;
	/**
	 * Initial registration. Fails with sync_keyring_exists if one already exists (first writer only).
	 */
	setupKeyring(
		input: KeyringSetupRequest,
		options?: SyncRequestOptions,
	): Promise<KeyringDto>;
	/** Reissues the recovery code. Requires proof of possession of the current DEK. */
	rewrapKeyring(
		input: KeyringRewrapRequest,
		options?: SyncRequestOptions,
	): Promise<KeyringDto>;
	/**
	 * Namespace reset: deletes the server's keyring and all ciphertext. Requires a recent login
	 * (recent_login_required), not proof of possession. It is the only way for an account that is
	 * locked, with no key and no recovery code, to start again.
	 */
	resetKeyring(options?: SyncRequestOptions): Promise<void>;
	/**
	 * Possession check, read-only. A definite mismatch returns false; a network failure throws. The
	 * distinction matters for automatic unlock. On a definite mismatch, the locally remembered key
	 * must be discarded (cross-account and stale safety net). On a network failure it must not be
	 * discarded. If a trusted device's key were erased because one request failed on a plane, the user
	 * would have to find the recovery code again.
	 */
	verifyKeyring(
		input: KeyringVerifyRequest,
		options?: SyncRequestOptions,
	): Promise<boolean>;

	pull(
		input: { since: number; limit?: number },
		options?: SyncRequestOptions,
	): Promise<PullResponse>;

	push(
		input: { items: PushItem[]; idempotencyKey: string },
		options?: SyncRequestOptions,
	): Promise<PushResponse>;

	/*
	 * The four pairing relay operations all handle one-time state. These four lines add one thing to
	 * the protocol: hand over an envelope that expires, and come back for it. They must not mix with
	 * the record path. Pairing obtains the DEK; records use it.
	 */

	/** New device: submits the code hash and public key. Fails if the same hash already exists. */
	startPairing(
		input: SyncPairingStartRequest,
		options?: SyncRequestOptions,
	): Promise<SyncPairingDto>;
	/**
	 * Reads a session. A trusted device looks for newPublicKey; a new device looks for payload.
	 * Expired, cancelled and missing all return the same failure (sync_pairing_not_found).
	 * Distinguishing them would make that branch flip depending on cleanup timing.
	 */
	readPairing(
		input: SyncPairingLookupRequest,
		options?: SyncRequestOptions,
	): Promise<SyncPairingDto>;
	/** Trusted device: hands over the sealed DEK. The first approval to arrive wins. */
	approvePairing(
		input: SyncPairingApproveRequest,
		options?: SyncRequestOptions,
	): Promise<void>;
	/**
	 * Closes the relay. Cancellation and post-consumption cleanup are the same operation. Closing a
	 * session that does not exist counts as success (idempotent). If this call fails, the session
	 * still disappears when its TTL expires, so callers wait for the result but do not depend on it.
	 */
	cancelPairing(
		input: SyncPairingLookupRequest,
		options?: SyncRequestOptions,
	): Promise<void>;
}

/**
 * Classification of a failure. The engine uses it to decide whether to retry or stop. It reads the
 * error object structurally from the transport implementation. RowCatApiError in
 * @rowcat/sdk already has status and code and fits as is. Importing that class would make this
 * package depend on the SDK, so it takes the shape, not the type.
 */
export interface SyncFailure {
	/** HTTP status code. Network failures and cancellation are 0. */
	status: number;
	code: string;
	/** Wait time reported by a 429 or a 409 (in progress). */
	retryAfterMs?: number;
}

export function syncFailureOf(error: unknown): SyncFailure {
	if (typeof error !== "object" || error === null)
		return { status: 0, code: "sync_transport_error" };
	const row = error as Record<string, unknown>;
	return {
		status: typeof row.status === "number" ? row.status : 0,
		code: typeof row.code === "string" ? row.code : "sync_transport_error",
		...(typeof row.retryAfterMs === "number"
			? { retryAfterMs: row.retryAfterMs }
			: {}),
	};
}
