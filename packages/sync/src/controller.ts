import type { KeyringDto } from "@rowcat/contracts/sync";
import { SYNC_ERROR_CODE } from "@rowcat/contracts/sync";
import type { AeadProvider } from "./aead.ts";
import { bytesToB64 } from "./codec.ts";
import { generateDek } from "./crypto.ts";
import type { DeviceKeyStore } from "./device-key.ts";
import {
	createSyncEngine,
	SyncAbortedError,
	type SyncClock,
	type SyncEngine,
	type SyncRunResult,
} from "./engine.ts";
import {
	buildKeyring,
	deriveAuthKey,
	proveKeyring,
	rotateRecovery,
	unlockWithRecovery,
} from "./keyring.ts";
import {
	normalizePairingCode,
	pairingCodeHash,
	sealPairingDek,
} from "./pairing.ts";
import { PairingKeyRejectedError, startPairingRun } from "./pairing-runner.ts";
import type { SyncCodecRegistry } from "./registry.ts";
import type { SyncStore } from "./store.ts";
import {
	type SyncSignal,
	type SyncTransport,
	syncFailureOf,
} from "./transport.ts";

/**
 * Sync state machine. It contains no React. It holds the judgments about what can be done now, and
 * the actions that change those judgments. The screen subscribes to this state and only draws it.
 * The split exists so the same state machine can be used unchanged by the Expo app later, and so
 * these judgments (races, ownership, locking) can be verified without rendering.
 *
 * No module-level singleton. This controller is owned by a `LocalDataStores` instance and is
 * discarded on logout. The legacy web app created the controller at module load time and broke sync
 * after logout followed by re-login. Creating it fresh each time was the workaround.
 *
 * The DEK in memory also lives in this object, so discarding the controller is the same as locking.
 */

export type SyncState =
	/** Server not yet asked. */
	| "idle"
	| "checking"
	/** No keyring on the server: this member has never turned sync on. */
	| "disabled"
	/** A keyring exists, but this device has no DEK. A recovery code is needed. */
	| "locked"
	| "ready"
	| "syncing"
	| "error";

export interface SyncSnapshot {
	state: SyncState;
	/**
	 * Whether this device remembers the DEK. It decides whether the `Untrust this device` action is offered.
	 */
	trusted: boolean;
	initialSyncDone: boolean;
	lastSyncedAt: string | null;
	/** Code of the last failure. The human-readable message is chosen by the screen. */
	lastError: string | null;
}

/** Result of `setup` and `rotateRecovery`. The recovery code is returned only once, here. */
export interface RecoveryCodeIssued {
	recoveryCode: string;
}

export type PairingPollResult = "pending" | "paired";

/**
 * One pairing in progress. The private key's lifetime is this object's lifetime. The decision not
 * to store the private key in IndexedDB or on the server (§14) shows up in this shape. A page
 * reload discards this object and the pairing starts over. Persisting the ephemeral private key to
 * disk to survive a reload would mean persisting material that could open the DEK, all for a
 * five-minute convenience.
 */
export interface PairingSession {
	/** Display form, drawn on screen as-is (`XXXX-XXXX-XXXX-XXXX`). */
	code: string;
	/** Expiry time set by the server. The server is the authority on expiry; this value is a copy. */
	expiresAt: string;
	/**
	 * Checks once whether approval has arrived. If it has, everything finishes inside this call: open
	 * the envelope, verify it against the keyring, remember the key, then close the relay. The order
	 * is not left to callers because of §20. If the screen could insert anything between 'received'
	 * and 'trusted', verification would eventually slip later.
	 */
	poll(): Promise<PairingPollResult>;
	/** Closes only the relay. Does not touch the keyring, the DEK, other devices, or records. */
	cancel(): Promise<void>;
}

export interface SyncControllerOptions {
	owner: string;
	registry: SyncCodecRegistry;
	store: SyncStore;
	transport: SyncTransport;
	aead: AeadProvider;
	deviceKey: DeviceKeyStore;
	clock: SyncClock;
	ownsStore?: () => boolean;
	signal?: SyncSignal;
	sleep?: (ms: number) => Promise<void>;
	onDiagnostic?: SyncEngineOptionsDiagnostic;
}

type SyncEngineOptionsDiagnostic = NonNullable<
	Parameters<typeof createSyncEngine>[0]["onDiagnostic"]
>;

export interface SyncController {
	snapshot(): SyncSnapshot;
	subscribe(listener: () => void): () => void;

	/**
	 * Checks the server keyring and unlocks if this device is remembered. Called once when the screen
	 * opens.
	 */
	inspect(): Promise<void>;

	/**
	 * First-time setup: create the DEK, register the keyring, trust this device, bootstrap. If another
	 * device won the race (409), returns `null` and moves to locked. The DEK and recovery code created
	 * here are discarded: continuing with a key that differs from the winning keyring would leave this
	 * device's data unreadable on other devices forever.
	 */
	setup(): Promise<RecoveryCodeIssued | null>;

	/** Unlocks with the recovery code. Throws on a wrong code, and the state stays `locked`. */
	unlock(recoveryCode: string): Promise<void>;

	/** Manual sync. In slice 1b, the only trigger. */
	syncNow(): Promise<SyncRunResult | null>;

	/**
	 * Forgets this device. Local only. Does not touch server ciphertext, the keyring, or other
	 * devices. All trusted devices share one DEK, so remote revocation is impossible without rotating
	 * the DEK and re-encrypting everything. If the UI promised remote revocation, that would be false
	 * (§29.5).
	 */
	forgetDevice(): Promise<void>;

	/** Reissues the recovery code. The DEK stays the same. The new code is shown only once. */
	rotateRecoveryCode(): Promise<RecoveryCodeIssued>;

	/**
	 * Resets sync: deletes the server keyring and all ciphertext, and forgets this device's key. Local
	 * data stays, and the next `setup()` re-uploads it under a new key. This is the only way forward
	 * for an account that is locked with neither the key nor the recovery code. Someone who briefly
	 * stole a session can create that state by registering a keyring first. There is no proof of
	 * possession, so the server requires a recent login. On `recent_login_required`, sign in again and
	 * then call this.
	 */
	reset(): Promise<void>;

	/**
	 * New device: starts pairing. A second unlock path that does not ask for the recovery code. Only
	 * meaningful on a locked device. A device that is already trusted gains nothing from calling it
	 * (it already has the key). An account with no keyring (`disabled`) has no key to hand over.
	 */
	startPairing(): Promise<PairingSession>;

	/**
	 * Trusted device: approves the code a new device displayed, sealing the current DEK to that
	 * device. A browser that has only signed in cannot do this. Without the DEK in memory there is
	 * nothing to seal, and the check happens here, not in the screen (`sync_locked`). Approval cannot
	 * be undone, since a handed-over key cannot be recalled. So no automatic approval path is built
	 * here.
	 */
	approvePairing(code: string): Promise<void>;
}

export function createSyncController(
	options: SyncControllerOptions,
): SyncController {
	const {
		owner,
		transport,
		aead,
		deviceKey,
		store,
		ownsStore = () => true,
	} = options;

	/** The DEK in memory. It disappears when this object is discarded, and that is the lock. */
	let dek: Uint8Array | null = null;
	let snapshot: SyncSnapshot = {
		state: "idle",
		trusted: false,
		initialSyncDone: false,
		lastSyncedAt: null,
		lastError: null,
	};
	const listeners = new Set<() => void>();

	const publish = (patch: Partial<SyncSnapshot>): void => {
		snapshot = { ...snapshot, ...patch };
		for (const listener of listeners) listener();
	};

	const engine: SyncEngine = createSyncEngine({
		owner: options.owner,
		registry: options.registry,
		store: options.store,
		transport: options.transport,
		aead: options.aead,
		clock: options.clock,
		ownsStore,
		...(options.signal ? { signal: options.signal } : {}),
		...(options.sleep ? { sleep: options.sleep } : {}),
		...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
	});

	async function refreshLocal(): Promise<void> {
		if (!ownsStore()) return;
		const state = await store.readState();
		publish({
			initialSyncDone: state.initialSyncDone,
			lastSyncedAt: state.lastSyncedAt,
		});
	}

	/**
	 * Checks the remembered DEK instead of trusting it. The local wrapper is attached to this
	 * database, but nothing guarantees that the DEK inside it belongs to the keyring currently on the
	 * server. Another device may have rotated it, or it may be a leftover from an old account. So an
	 * `authKey` derived from it produces a proof over the keyring string, which is checked against the
	 * server. The point of this function is to separate a definite mismatch (false) from a network
	 * failure (exception). The first means the wrapper must be discarded. The second must never
	 * discard it: forgetting trust after a single failure on a plane would force the user to find the
	 * recovery code again.
	 */
	async function verifyRemembered(
		candidate: Uint8Array,
		keyring: string,
	): Promise<"valid" | "invalid" | "unknown"> {
		const proof = proveKeyring(deriveAuthKey(candidate, owner), keyring);
		try {
			return (await transport.verifyKeyring({ keyring, proof }, withSignal()))
				? "valid"
				: "invalid";
		} catch {
			return "unknown";
		}
	}

	const withSignal = () =>
		options.signal ? { signal: options.signal } : undefined;

	async function readKeyring(): Promise<KeyringDto> {
		return transport.getKeyring(withSignal());
	}

	return {
		snapshot: () => snapshot,

		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		async inspect() {
			publish({ state: "checking" });
			await refreshLocal();
			let keyring: string | null;
			try {
				keyring = (await readKeyring()).keyring;
			} catch (error) {
				publish({ state: "error", lastError: syncFailureOf(error).code });
				return;
			}
			if (!ownsStore()) return;

			if (keyring === null) {
				/**
				 * If the server has no keyring but a key is remembered locally, the key is definitively stale:
				 * no keyring corresponds to it. Keeping it would make the next setup look like an
				 * already-trusted device, so it is discarded here.
				 */
				await deviceKey.forget();
				dek = null;
				publish({ state: "disabled", trusted: false, lastError: null });
				return;
			}

			const remembered = dek ?? (await deviceKey.recall());
			if (!remembered) {
				publish({ state: "locked", trusted: false });
				return;
			}

			const verdict = await verifyRemembered(remembered, keyring);
			if (!ownsStore()) return;
			if (verdict === "invalid") {
				await deviceKey.forget();
				dek = null;
				publish({
					state: "locked",
					trusted: false,
					lastError: SYNC_ERROR_CODE.keyringProofInvalid,
				});
				return;
			}
			/**
			 * `unknown` (network failure) does not lock. The local data is already on this device, and
			 * locking while offline would block the user for nothing. The next check verifies again.
			 */
			dek = remembered;
			publish({ state: "ready", trusted: true, lastError: null });
		},

		async setup() {
			publish({ state: "checking" });
			const fresh = generateDek();
			const { keyring, recoveryCode } = await buildKeyring(owner, fresh, aead);
			const authKey = bytesToB64(deriveAuthKey(fresh, owner));

			try {
				await transport.setupKeyring({ keyring, authKey }, withSignal());
			} catch (error) {
				const failure = syncFailureOf(error);
				if (failure.code !== SYNC_ERROR_CODE.keyringExists) {
					publish({ state: "error", lastError: failure.code });
					throw error;
				}
				/**
				 * Lost the race. Another device created the keyring first, and ciphertext under its DEK may
				 * already be uploaded. Key material created here must not be used: with two DEKs coexisting,
				 * neither could open everything, and the account would be unrecoverable.
				 */
				dek = null;
				await deviceKey.forget();
				await this.inspect();
				return null;
			}

			if (!ownsStore()) return null;
			dek = fresh;
			await deviceKey.remember(fresh);
			publish({ state: "syncing", trusted: true, lastError: null });
			try {
				await engine.bootstrap(fresh);
			} catch (error) {
				if (error instanceof SyncAbortedError) throw error;
				/**
				 * Even if bootstrap fails, setup itself succeeded: the keyring is on the server and this device
				 * holds the DEK. Swallowing the recovery code here would mean the user never sees the only key
				 * to the account they just created, which is far worse than a sync failure.
				 */
				publish({ state: "error", lastError: syncFailureOf(error).code });
				await refreshLocal();
				return { recoveryCode };
			}
			await refreshLocal();
			publish({ state: "ready" });
			return { recoveryCode };
		},

		async unlock(recoveryCode) {
			const { keyring } = await readKeyring();
			if (keyring === null) throw new Error(SYNC_ERROR_CODE.notConfigured);
			// The checksum error and the AEAD failure each throw. The screen uses different messages for
			// them.
			const unlocked = await unlockWithRecovery(
				owner,
				keyring,
				recoveryCode,
				aead,
			);
			if (!ownsStore()) return;
			dek = unlocked;
			await deviceKey.remember(unlocked);
			await refreshLocal();
			publish({ state: "ready", trusted: true, lastError: null });
		},

		async syncNow() {
			if (!dek) return null;
			publish({ state: "syncing" });
			try {
				const result = await engine.run(dek);
				await refreshLocal();
				publish({ state: "ready", lastError: null });
				return result;
			} catch (error) {
				if (error instanceof SyncAbortedError) throw error;
				const failure = syncFailureOf(error);
				await refreshLocal();
				publish({ state: "error", lastError: failure.code });
				throw error;
			}
		},

		async forgetDevice() {
			await deviceKey.forget();
			dek = null;
			publish({ state: "locked", trusted: false, lastError: null });
		},

		async reset() {
			/**
			 * The server goes first. If the local key were forgotten first and the server then rejected the
			 * deletion (re-login required), this device would have lost its key while the server stayed
			 * unchanged. That is exactly the state this operation exists to fix.
			 */
			await transport.resetKeyring(withSignal());
			if (!ownsStore()) return;
			await deviceKey.forget();
			dek = null;
			/**
			 * The server now holds nothing, so every local `serverVersion` is false. If they are not
			 * cleared, the next bootstrap push would send every record with baseVersion 0 and have them all
			 * rejected. Pull cannot resolve those conflicts, because there is nothing to pull.
			 */
			await store.forgetServerVersions();
			await store.resetCursor();
			await refreshLocal();
			publish({ state: "disabled", trusted: false, lastError: null });
		},

		async rotateRecoveryCode() {
			if (!dek) throw new Error(SYNC_ERROR_CODE.locked);
			const rotated = await rotateRecovery(owner, dek, aead);
			await transport.rewrapKeyring(
				{ keyring: rotated.keyring, proof: rotated.proof },
				withSignal(),
			);
			return { recoveryCode: rotated.recoveryCode };
		},

		async startPairing() {
			/**
			 * Code generation, relaying, decryption, and keyring verification all belong to
			 * `startPairingRun`. What remains here is what only this app knows: whether the scope is still
			 * ours, and where the received key is remembered.
			 */
			const run = await startPairingRun({
				owner,
				transport,
				aead,
				...(options.signal ? { signal: options.signal } : {}),
			});

			return {
				code: run.code,
				expiresAt: run.expiresAt,

				async poll() {
					let result: Awaited<ReturnType<typeof run.poll>>;
					try {
						result = await run.poll();
					} catch (error) {
						/**
						 * Only a definitive rejection is stored in state. A transient failure leaves the screen
						 * waiting.
						 */
						if (error instanceof PairingKeyRejectedError)
							publish({ lastError: SYNC_ERROR_CODE.pairingKeyRejected });
						throw error;
					}
					if (result.status === "pending") return "pending";

					/**
					 * If the scope changed (logged out, then another account signed in), stop here. This response
					 * belongs to Alice, while the store open now may be Bob's. In that case the only remaining
					 * step is to do nothing (§44).
					 */
					if (!ownsStore()) return "pending";

					dek = result.dek;
					await deviceKey.remember(result.dek);
					await refreshLocal();
					publish({ state: "ready", trusted: true, lastError: null });

					/**
					 * The relay is closed only after the payload is consumed (§23). If it were closed at the first
					 * sight of the payload, a retry after a lost response would find the session already gone, and
					 * the user would have to start over through no fault of their own. A failure here is harmless:
					 * the row expires by TTL anyway, and the only device that could reopen it in the meantime
					 * already holds the key.
					 */
					try {
						await run.cancel();
					} catch {
						// Failure to clean up the relay is not a pairing failure.
					}
					return "paired";
				},

				cancel: run.cancel,
			};
		},

		async approvePairing(code) {
			if (!dek) throw new Error(SYNC_ERROR_CODE.locked);
			const normalizedCode = normalizePairingCode(code);
			const codeHash = pairingCodeHash(owner, normalizedCode);
			const session = await transport.readPairing({ codeHash }, withSignal());
			const { payload } = await sealPairingDek({
				owner,
				normalizedCode,
				newPublicKey: session.newPublicKey,
				dek,
				aead,
			});
			await transport.approvePairing({ codeHash, payload }, withSignal());
		},
	};
}
