import { SYNC_ERROR_CODE } from "@rowcat/contracts";
import type { PairingRunnerTransport } from "@rowcat/sync";
import {
	nobleAead,
	PAIRING_POLL_INTERVAL_MS,
	PairingKeyRejectedError,
	startPairingRun,
} from "@rowcat/sync";

/**
 * Device pairing: turns this process into one of the account's devices without asking for the
 * recovery code.
 *
 * ```text
 * already-connected RowCat device (web/app)      this process
 *                                                prints a code
 * a person copies the code and approves  ──────► receives the envelope from the relay
 *                                                opens it, checks it against the keyring, then returns it
 * ```
 *
 * Crypto and ordering belong to `startPairingRun` in `@rowcat/sync`. What stays here is what only
 * the CLI knows: how often to poll, what to print, and whether the account is still this process's
 * account when approval arrives.
 *
 * Everything (clock, sleep, relay, viewer lookup) is an argument because the procedure has six
 * endings (approved, expired, cancelled, rejected, connection failure, account changed) and five of
 * them need a human to wait 5 minutes; this way all six are checked by value without a network.
 *
 * Deliberately absent:
 * - Storing the received key: the caller does that (the ownership decision lives there).
 * - Asking for the recovery code: the alternative path (`unlock`) stays as it is.
 * - Approving: this process is the new device and has no key to approve anyone else's.
 * - Persisting the private key: it lives only in the run object, so if the process dies nobody
 *   can open the leftover envelope.
 */

/**
 * The account never turned sync on: the one failure where neither pairing nor a recovery code is
 * the answer. With no key there is nothing to hand over or recover, and suggesting a recovery code
 * would send the person looking for a procedure that does not exist.
 */
const SYNC_DISABLED =
	"This account hasn't turned on sync yet. Turn on sync in the web or app first.";

/** Consecutive-failure cap: offline for the whole 5 minutes would otherwise send 150 requests. */
const MAX_CONSECUTIVE_FAILURES = 5;

export interface PairingIo {
	/** Lines left for the human. */
	readonly out: (line: string) => void;
	/** A line that gets erased, for values that refresh while waiting such as the remaining time. */
	readonly status?: (line: string) => void;
}

export interface PairingCommandOptions extends PairingIo {
	/** The viewer the server fixed at start; owns the whole procedure. */
	readonly owner: string;
	readonly transport: PairingRunnerTransport;
	readonly now: () => number;
	readonly sleep: (ms: number) => Promise<void>;
	/**
	 * Whether it is still the same account after approval arrives (really re-asks `/me`).
	 *
	 * Pairing lives 5 minutes and another terminal can run `login` meanwhile. A key from a run started
	 * as A landing in B's config would leave that file holding B's cookie next to A's envelope key, a
	 * shape of accident this repository already closed once.
	 */
	readonly stillOwned: () => Promise<boolean>;
	/** Whether the human pressed Ctrl+C; checked every round. */
	readonly cancelled?: () => boolean;
	readonly pollIntervalMs?: number;
}

export type PairingOutcome =
	/** A key that was opened and checked against the keyring; the only form that is safe to store. */
	| { readonly status: "paired"; readonly dek: Uint8Array }
	| { readonly status: "expired" }
	| { readonly status: "cancelled" }
	/**
	 * Carries the next step as a sentence; the raw exception text never lands here.
	 *
	 * `reason` is split because some failures have no recovery-code answer: if the account never
	 * turned sync on, there is no key to hand over or recover, and "use the recovery code" would point
	 * to a procedure that does not exist.
	 */
	| {
			readonly status: "failed";
			readonly message: string;
			readonly reason: "sync_disabled" | "pairing";
	  };

const REMAINING = (ms: number): string => {
	const total = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * One pairing run. Returns one of the six endings and never throws: every failure ends as a "do
 * this next" sentence, and rethrowing would make the caller rebuild it, mixing in raw text (crypto,
 * HTTP, stacks).
 */
export async function pairDevice(
	options: PairingCommandOptions,
): Promise<PairingOutcome> {
	const { out, status, owner, transport, now, sleep, stillOwned } = options;
	const cancelled = options.cancelled ?? (() => false);
	const interval = options.pollIntervalMs ?? PAIRING_POLL_INTERVAL_MS;

	/**
	 * Check the keyring first: starting on an account without one would have the user copy a code and
	 * wait 5 minutes only to learn there is no key to hand over.
	 */
	try {
		const { keyring } = await transport.getKeyring();
		if (keyring === null)
			return {
				status: "failed",
				reason: "sync_disabled",
				message: SYNC_DISABLED,
			};
	} catch (error) {
		return {
			status: "failed",
			reason: "pairing",
			message: startFailureMessage(error),
		};
	}

	let run: Awaited<ReturnType<typeof startPairingRun>>;
	try {
		run = await startPairingRun({ owner, transport, aead: nobleAead });
	} catch (error) {
		return {
			status: "failed",
			reason: "pairing",
			message: startFailureMessage(error),
		};
	}

	/** Close the relay whichever way it ends; a failure is harmless (the row expires by TTL). */
	const close = async (): Promise<void> => {
		try {
			await run.cancel();
		} catch {
			// A failed relay cleanup is not a pairing failure.
		}
	};

	/** The first line is the code; the blank line before it is the caller's spacing, not this procedure's. */
	out("Pairing code:");
	out(`  ${run.code}`);
	out("");
	out("Open this on an already connected RowCat device:");
	out("  Account → Data → Connect a new device");
	out("");
	out("Enter the code above and approve this device.");
	out("");
	out("Waiting for approval…");

	let failures = 0;
	for (;;) {
		if (cancelled()) {
			await close();
			return { status: "cancelled" };
		}
		/**
		 * Judge expiry first. The server decides too (and is authoritative), but without stopping here an
		 * expired session returns 404, which would be read as "cancelled".
		 */
		const remaining = Date.parse(run.expiresAt) - now();
		if (remaining <= 0) {
			await close();
			return { status: "expired" };
		}
		status?.(`Waiting for approval… (${REMAINING(remaining)} left)`);

		await sleep(interval);
		if (cancelled()) {
			await close();
			return { status: "cancelled" };
		}
		/**
		 * Check again after waiting: a session that expired during the wait would answer 404, read as
		 * "cancelled", and the two are different events to the user.
		 */
		if (Date.parse(run.expiresAt) - now() <= 0) {
			await close();
			return { status: "expired" };
		}

		let result: Awaited<ReturnType<typeof run.poll>>;
		try {
			result = await run.poll();
		} catch (error) {
			const terminal = terminalMessage(error);
			if (terminal !== null) {
				/**
				 * On a definitive rejection (`pairingKeyRejected`) the relay is left open to give the user a
				 * window to check the cause. The other definitive failures already have no session.
				 */
				return terminal;
			}
			failures += 1;
			if (failures >= MAX_CONSECUTIVE_FAILURES) {
				await close();
				return {
					status: "failed",
					reason: "pairing",
					message: "Couldn't confirm the connection. Please check the network.",
				};
			}
			continue;
		}
		failures = 0;
		if (result.status === "pending") continue;

		/**
		 * Approval may have arrived after the account changed. The only thing to do is discard this key:
		 * continuing would put it in another account's config.
		 */
		if (!(await stillOwnedSafely(stillOwned))) {
			await close();
			return {
				status: "failed",
				reason: "pairing",
				message:
					"The account that started pairing and the account signed in now are different accounts. Nothing was saved on this device.",
			};
		}

		/** Close after consuming, so a retry whose response was lost sees the same envelope again. */
		await close();
		return { status: "paired", dek: result.dek };
	}
}

/**
 * A failed account check is treated the same as a changed account. When unsure, do not store:
 * proceeding on failure would let an approval that arrives as the session drops land in the file
 * with no check.
 */
async function stillOwnedSafely(
	check: () => Promise<boolean>,
): Promise<boolean> {
	try {
		return await check();
	} catch {
		return false;
	}
}

/** Start failure reason to next step. Neither raw text nor status codes reach the screen. */
function startFailureMessage(error: unknown): string {
	const row = error as { code?: string; status?: number } | null;
	if (row?.code === SYNC_ERROR_CODE.pairingTooMany)
		return "Too many pairings are open. Cancel connections in progress on other devices, then try again.";
	if (row?.code === SYNC_ERROR_CODE.pairingRateLimited)
		return "Too many requests. Please try again shortly.";
	if (row?.status === 401 || row?.status === 403)
		return "The session expired, or this account can't connect devices. Please run rowcat-mcp login again.";
	return "Couldn't start pairing. Please check the API address and the connection.";
}

/**
 * Definitive failure to sentence; `null` for a transient failure (keep waiting).
 *
 * `PairingKeyRejectedError` is the branch that matters most: the next step is to check where the
 * code was entered, not to retry, and this process stored nothing, which must be stated or the user
 * reads it as something wrongly saved.
 *
 * Reasons an envelope would not open (code, account, tampering) are not told apart: the next step
 * is the same, and distinguishing them would be a signal to an attacker.
 */
function terminalMessage(
	error: unknown,
): Extract<PairingOutcome, { status: "failed" }> | null {
	const failed = (
		message: string,
		reason: "sync_disabled" | "pairing" = "pairing",
	): Extract<PairingOutcome, { status: "failed" }> => ({
		status: "failed",
		reason,
		message,
	});
	if (error instanceof PairingKeyRejectedError)
		return failed(
			"The received key doesn't belong to this account. Nothing was saved on this device.",
		);
	const row = error as { name?: string; code?: string; status?: number } | null;
	if (row?.code === SYNC_ERROR_CODE.pairingNotFound)
		return failed(
			"The connection expired or was cancelled. Please start again with rowcat-mcp pair.",
		);
	if (row?.code === SYNC_ERROR_CODE.notConfigured)
		return failed(SYNC_DISABLED, "sync_disabled");
	if (row?.name === "SyncCryptoError" || row?.name === "SyncCodecError")
		return failed(
			"Couldn't complete the connection. Please start again with rowcat-mcp pair.",
		);
	if (row?.status === 401 || row?.status === 403)
		return failed("The session expired. Please run rowcat-mcp login again.");
	return null;
}
