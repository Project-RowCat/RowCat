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

/**
 * The code a run or a setup fails with when this tab's session belongs to someone other than the
 * owner. It is the screens' existing word for "sign in again" (both apps already have a sentence for
 * it), and it is not a server code: no request was the problem, the cookie was.
 */
export const SYNC_LOGIN_REQUIRED = "login_required";

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((byte, index) => byte === b[index]);

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
	/** The keyring string `dek` was last shown to open; `null` when this object has not seen one. */
	let provenKeyring: string | null = null;
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

	/**
	 * A failure that says this session is not the owner's. `login_required` because that is what the
	 * person has to do in this tab, and it is a 401 so the scheduler blocks instead of backing off —
	 * retrying cannot change whose cookie the browser holds, and the next focus or press asks again.
	 */
	const notThisOwner = (): Error =>
		Object.assign(new Error(SYNC_LOGIN_REQUIRED), {
			status: 401,
			code: SYNC_LOGIN_REQUIRED,
		});
	/** A definite "this key does not open the session's keyring", with nothing proven about whose. */
	const keyDoesNotOpen = (): Error =>
		Object.assign(new Error(SYNC_ERROR_CODE.keyringProofInvalid), {
			status: 403,
			code: SYNC_ERROR_CODE.keyringProofInvalid,
		});

	/** `true` / `false` when the transport can say whose session this is; `null` when it cannot. */
	async function sessionIsOwners(): Promise<boolean | null> {
		if (!transport.sessionOwner) return null;
		return (await transport.sessionOwner(withSignal())) === owner;
	}

	/**
	 * Whether the next run may ride this session with `candidate`, asked before every run.
	 *
	 * The owner of a sync request comes only from the session cookie, and that cookie is shared by
	 * every tab of the browser. A tab left open as Alice while another tab signs in as Bob keeps
	 * Alice's scope and key in memory — nothing in that tab changes — and its next run pulled Bob's
	 * namespace: every record failed to open under Alice's key and was skipped, and the pull still
	 * moved Alice's cursor onto Bob's sequence, so her own later records were skipped for good. Her
	 * new records were then accepted into Bob's namespace. `ownsStore` cannot see this; it compares
	 * stores inside one tab.
	 *
	 * - Someone else's session throws `login_required`; the key is kept, it is right for its owner.
	 * - The owner's session whose keyring this key no longer opens (sync reset or set up again on
	 *   another device) is a real change: `inspect()` decides it the way it does at start, and the run
	 *   is skipped (`false`).
	 * - Without identity, a mismatch throws `keyringProofInvalid` and keeps the key.
	 * - Any failure to ask throws as the run's own failure. Running on anyway is exactly the case
	 *   this check exists for: the keyring read succeeded and the pull would too.
	 *
	 * The common path is two reads (who, which keyring) and no proof: the keyring string this key was
	 * proven against comes back unchanged. What this does not cover is a switch *during* a run — the
	 * check is before the run, and a run of many pages rides whatever cookie each request carries.
	 */
	async function confirmSession(candidate: Uint8Array): Promise<boolean> {
		const owners = await sessionIsOwners();
		if (owners === false) throw notThisOwner();
		const { keyring } = await readKeyring();
		if (keyring !== null && keyring === provenKeyring) return true;
		const opens =
			keyring !== null &&
			(await transport.verifyKeyring(
				{
					keyring,
					proof: proveKeyring(deriveAuthKey(candidate, owner), keyring),
				},
				withSignal(),
			));
		if (opens) {
			provenKeyring = keyring;
			return true;
		}
		if (owners === true) {
			/**
			 * The in-memory key is the one just rejected; the stored one may be newer — another tab of
			 * this member may have set sync up again or unlocked a moment ago, and the device key is one
			 * row every tab shares. So the re-check judges the stored key first. The in-memory key is
			 * left in place until a verdict replaces it: if the re-check cannot finish (a failed read, a
			 * session switched again), this tab stays trusted with a key, and its next run asks again.
			 */
			await inspectNow({ preferStored: true });
			return false;
		}
		throw keyDoesNotOpen();
	}

	/**
	 * Forgets the stored key only if it is still `rejected`. The row is shared by every tab of the
	 * member, and between reading it and forgetting it another tab may have stored a key that opens
	 * the current keyring; forgetting that one would cost the device its trust for nothing.
	 */
	async function forgetIfStill(rejected: Uint8Array): Promise<void> {
		const stored = await deviceKey.recall();
		if (stored !== null && !sameBytes(stored, rejected)) return;
		await deviceKey.forget();
	}

	async function inspectNow(
		options: { preferStored?: boolean } = {},
	): Promise<void> {
		publish({ state: "checking" });
		await refreshLocal();
		/**
		 * Every branch below that forgets the key is right only for this owner's session. Under someone
		 * else's (another tab signed in), forgetting would cost this owner their trusted device.
		 */
		try {
			if ((await sessionIsOwners()) === false) {
				publish({ state: "error", lastError: SYNC_LOGIN_REQUIRED });
				return;
			}
		} catch (error) {
			publish({ state: "error", lastError: syncFailureOf(error).code });
			return;
		}
		let keyring: string | null;
		try {
			keyring = (await readKeyring()).keyring;
			/**
			 * Another tab of this member may be setting sync up right now: its keyring lands before it
			 * stores its key, so "no keyring" is read once more before it is believed.
			 */
			if (keyring === null && (dek !== null || (await deviceKey.recall())))
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
			const stored = await deviceKey.recall();
			if (stored !== null) await forgetIfStill(stored);
			dek = null;
			provenKeyring = null;
			publish({ state: "disabled", trusted: false, lastError: null });
			return;
		}

		const stored = await deviceKey.recall();
		let remembered = options.preferStored ? (stored ?? dek) : (dek ?? stored);
		if (!remembered) {
			publish({ state: "locked", trusted: false });
			return;
		}

		let verdict = await verifyRemembered(remembered, keyring);
		if (!ownsStore()) return;
		if (verdict === "invalid") {
			/**
			 * The row is shared, so the key there now may be one another tab stored after it was read.
			 * That key is judged before this device is locked.
			 */
			const now = await deviceKey.recall();
			if (now !== null && !sameBytes(now, remembered)) {
				remembered = now;
				verdict = await verifyRemembered(now, keyring);
				if (!ownsStore()) return;
			}
		}
		if (verdict === "invalid") {
			await forgetIfStill(remembered);
			dek = null;
			provenKeyring = null;
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
		provenKeyring = verdict === "valid" ? keyring : null;
		publish({ state: "ready", trusted: true, lastError: null });
	}

	return {
		snapshot: () => snapshot,

		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		inspect: () => inspectNow(),

		async setup() {
			publish({ state: "checking" });
			const fresh = generateDek();
			const { keyring, recoveryCode } = await buildKeyring(owner, fresh, aead);
			const authKey = bytesToB64(deriveAuthKey(fresh, owner));

			try {
				/**
				 * Registering under someone else's session would put this owner's keyring in their account,
				 * lock them behind a key they cannot open, and bootstrap this owner's records into it.
				 */
				if ((await sessionIsOwners()) === false) throw notThisOwner();
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
				await inspectNow();
				return null;
			}

			if (!ownsStore()) return null;
			dek = fresh;
			provenKeyring = keyring;
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
			provenKeyring = keyring;
			await deviceKey.remember(unlocked);
			await refreshLocal();
			publish({ state: "ready", trusted: true, lastError: null });
		},

		async syncNow() {
			if (!dek) return null;
			const key = dek;
			publish({ state: "syncing" });
			try {
				if (!(await confirmSession(key))) return null;
				const result = await engine.run(key);
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
			provenKeyring = null;
			publish({ state: "locked", trusted: false, lastError: null });
		},

		async reset() {
			/**
			 * The server goes first. If the local key were forgotten first and the server then rejected the
			 * deletion (re-login required), this device would have lost its key while the server stayed
			 * unchanged. That is exactly the state this operation exists to fix.
			 */
			/**
			 * The one irreversible operation here. Under someone else's session (another tab signed in,
			 * fresh enough for the server's recent-login rule) it would erase their keyring and every
			 * ciphertext they have, while this owner's namespace stays as it was.
			 */
			if ((await sessionIsOwners()) === false) throw notThisOwner();
			await transport.resetKeyring(withSignal());
			if (!ownsStore()) return;
			await deviceKey.forget();
			dek = null;
			provenKeyring = null;
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
			provenKeyring = rotated.keyring;
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
