import { SYNC_ERROR_CODE } from "@rowcat/contracts/sync";
import type { AeadProvider } from "./aead.ts";
import { deriveAuthKey, proveKeyring } from "./keyring.ts";
import {
	generatePairingCode,
	generatePairingKeyPair,
	normalizePairingCode,
	openPairingDek,
	pairingCodeHash,
} from "./pairing.ts";
import type { SyncSignal, SyncTransport } from "./transport.ts";

/**
 * The state machine for the receiving side of pairing, from code generation to a verified DEK. It
 * does not store anything. `pairing.ts` handles the bytes; this file handles the order, which is
 * §20.
 *
 * Order: create the code and keypair, give the relay the public key, wait for approval, open the
 * envelope, check it against the keyring, and only then return the value.
 *
 * Why it is separate: three devices must now follow this order, namely web, mobile and rowcat-mcp.
 * If each writes its own version, one will eventually verify late. That device would then be marked
 * trusted while permanently unable to open its own data, and that state never heals itself. The
 * controller carries storage, device keys and state publishing along with it; MCP has none of
 * those.
 *
 * Not here:
 * - Storage. The adapter decides where received keys go (IndexedDB, SecureStore, a 0600 file).
 * - Polling schedule. Interval, retries and caps belong to each screen or CLI. This file provides
 *   a single `poll()`.
 * - Relay cleanup timing. Closing happens after the value is consumed; the adapter knows that
 *   boundary.
 * - Approval. `SyncController.approvePairing` does it; only a device holding the key can approve.
 *
 * The private key lives only inside this closure. Once the object is gone, a pending approval
 * envelope becomes bytes nobody can open (§14). Persisting the key to survive a refresh would store
 * material that can open the DEK, just for five minutes of convenience.
 */

/**
 * The four transport operations this procedure uses. Record operations (pull and push) are not part
 * of it.
 */
export type PairingRunnerTransport = Pick<
	SyncTransport,
	| "startPairing"
	| "readPairing"
	| "cancelPairing"
	| "getKeyring"
	| "verifyKeyring"
>;

/**
 * The envelope opened, but its key is not this account's key.
 *
 * This gets a separate type because the caller must describe only this case differently. Every
 * other failure means 'could not connect'. This one means the received key is not this account's,
 * and the user's remedy is not a retry but checking where the code was typed. Nothing is remembered
 * when this error is thrown; that is the property the order below (open, check, then return)
 * guarantees.
 */
export class PairingKeyRejectedError extends Error {
	readonly code = SYNC_ERROR_CODE.pairingKeyRejected;
	constructor() {
		super("the key received by pairing cannot open this account's keyring");
		this.name = "PairingKeyRejectedError";
	}
}

/**
 * Polling interval. A few seconds is enough, since the wait is for a person to copy a code. The
 * status lookup has no rate limit (polling is by design), but the value is not lowered: over a
 * five-minute window, 2 seconds is 150 polls, and polling more often would improve nothing.
 */
export const PAIRING_POLL_INTERVAL_MS = 2_000;

export type PairingRunPoll =
	| { readonly status: "pending" }
	/**
	 * Returned only after the envelope is opened and checked against the keyring. This is the only
	 * form that is safe to store.
	 */
	| { readonly status: "paired"; readonly dek: Uint8Array };

/** One pairing in progress. The lifetime of this object is the lifetime of the private key. */
export interface PairingRun {
	/** Display form shown on screen, `XXXX-XXXX-XXXX-XXXX`. */
	readonly code: string;
	/** Expiry set by the server. The server is the authority on expiry; this value is a copy. */
	readonly expiresAt: string;
	/**
	 * Checks once whether an approval has arrived. If one has, it is opened and checked inside this
	 * same call. Those steps are not left to the caller, because if anything could be inserted between
	 * them, the check would eventually fall behind.
	 */
	poll(): Promise<PairingRunPoll>;
	/**
	 * Closes only the relay entry. The keyring, DEK, other devices and records are untouched.
	 * Idempotent.
	 */
	cancel(): Promise<void>;
}

export interface PairingRunOptions {
	readonly owner: string;
	readonly transport: PairingRunnerTransport;
	readonly aead: AeadProvider;
	readonly signal?: SyncSignal;
}

/**
 * New device: starts a pairing, the unlock path that does not ask for the recovery code.
 *
 * It only makes sense on a locked device. A device that already holds a key gains nothing by
 * calling it, and an account with no keyring has no key to hand over; `poll()` reports that as
 * `notConfigured`. The check is not made up front, because an extra round trip would not change the
 * answer.
 */
export async function startPairingRun(
	options: PairingRunOptions,
): Promise<PairingRun> {
	const { owner, transport, aead } = options;
	const withSignal = () =>
		options.signal ? { signal: options.signal } : undefined;

	const code = generatePairingCode();
	const normalizedCode = normalizePairingCode(code);
	const codeHash = pairingCodeHash(owner, normalizedCode);
	/** The keypair is generated here and nowhere else. */
	const keyPair = generatePairingKeyPair();

	const started = await transport.startPairing(
		{ codeHash, newPublicKey: keyPair.publicKey },
		withSignal(),
	);

	const cancel = async (): Promise<void> => {
		await transport.cancelPairing({ codeHash }, withSignal());
	};

	return {
		code,
		expiresAt: started.expiresAt,

		async poll() {
			const session = await transport.readPairing({ codeHash }, withSignal());
			if (session.payload === null) return { status: "pending" };

			const candidate = await openPairingDek({
				owner,
				normalizedCode,
				privateKey: keyPair.privateKey,
				payload: session.payload,
				aead,
			});

			/**
			 * Do not trust a successful open. Reaching this point proves only that the peer holding the
			 * matching code and private key sealed the value. That peer may have sent an old DEK by mistake,
			 * or another device may have replaced the keyring in the meantime.
			 *
			 * The check reuses the existing keyring proof path as is; no second verification mechanism is
			 * added for pairing.
			 */
			const { keyring } = await transport.getKeyring(withSignal());
			if (keyring === null) throw new Error(SYNC_ERROR_CODE.notConfigured);
			const proof = proveKeyring(deriveAuthKey(candidate, owner), keyring);
			const accepted = await transport.verifyKeyring(
				{ keyring, proof },
				withSignal(),
			);
			/**
			 * A definitive rejection. Nothing is returned. The relay row is left to expire rather than
			 * deleted here, because deleting it now would remove the window the user has to check the cause.
			 */
			if (!accepted) throw new PairingKeyRejectedError();

			return { status: "paired", dek: candidate };
		},

		cancel,
	};
}
