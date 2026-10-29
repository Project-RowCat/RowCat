import type { AuthErrorLike } from "../../lib/auth-error.ts";

/**
 * The rules of account deletion, everything checkable without a screen (same role as the report and
 * appeal turns).
 *
 * This app's tests do not render React. With ordering, locking and the irreversible boundary in a
 * hook, the only check would be trying it by hand, and a screen that runs twice here sends the
 * irreversible request twice.
 *
 * State is one phase:
 *
 * ```text
 * idle            nothing has happened yet.
 * deleting        the server was asked to delete. On failure it returns to idle (nothing was deleted).
 * ─────────────── below this line nothing can be undone ───────────────
 * purging         the account is gone; this device is being cleaned up.
 * cleanup-failed  the account is gone and only this device's cleanup failed.
 * done            cleanup finished too.
 * ```
 *
 * It is not split into booleans: `deleting` and `purging` both look "in progress" but are opposite
 * on reversibility, and booleans scatter that difference across screen conditionals, where one slip
 * opens a path back to the screen of a deleted account.
 *
 * The lock is not React state. `if (phase === "deleting") return` is only true after a render
 * arrives; with two fingers in one frame it is false both times and delete-user goes out twice. The
 * lock is a closure variable set before the first `await`.
 *
 * After the line there is no second deletion: once server success is confirmed, `run()` is refused
 * for good. Only cleanup can be retried (`retryCleanup`), and it needs no auth since the account no
 * longer exists. The member id to clean is an in-memory copy taken before server deletion, the only
 * one left.
 *
 * A failure with no response is a failure with different copy: the server may have deleted already
 * and only the response was lost. Local cleanup must not start there (that would treat an
 * unconfirmed deletion as final) and "failed, press again" must not be said either; the sentence is
 * chosen in `delete-account-error.ts`. The answer here is one thing: delete nothing and return to
 * `idle`.
 */
export type AccountDeletionPhase =
	| "idle"
	| "deleting"
	| "purging"
	| "cleanup-failed"
	| "done";

export type DeletionRunResult =
	/** Nothing was sent; not a failure. A running execution or the passed line owns the outcome. */
	| { kind: "skipped"; why: "pending" | "terminal" | "no-viewer" }
	/** The server refused or did not respond. Nothing was deleted. */
	| { kind: "refused"; failure: AuthErrorLike }
	/** The account is gone; the device cleanup result comes with it. */
	| { kind: "deleted"; cleanup: "done" | "failed" };

export type CleanupRetryResult =
	| { kind: "skipped"; why: "pending" | "no-target" }
	| { kind: "cleaned" }
	| { kind: "cleanup-failed" };

export interface DeletionTurnPorts {
	/** Wiring from `lib/account-deletion.ts`; `null` is the confirmed success. */
	deleteAccount: (password?: string) => Promise<AuthErrorLike | null>;
	/** Called only after server success. A throw is a cleanup failure, not a deletion failure. */
	purge: (viewerId: string) => Promise<void>;
	/** Reports phase changes; the screen branches on this one value. */
	onPhase: (phase: AccountDeletionPhase) => void;
}

export interface AccountDeletionTurn {
	run(input: {
		viewerId: string | null;
		password?: string;
	}): Promise<DeletionRunResult>;
	/** The account is already gone; retries only this device's cleanup, without auth. */
	retryCleanup(): Promise<CleanupRetryResult>;
}

export function createAccountDeletionTurn(
	ports: DeletionTurnPorts,
): AccountDeletionTurn {
	/** Collapses a second confirm in the same tick without waiting for a render (see header). */
	let running = false;
	/**
	 * The member whose server deletion is confirmed; this value being set is the moment the line is
	 * crossed. Every later `run()` is refused, and cleanup retries delete this copy (no server,
	 * session or cache can be asked any more).
	 */
	let deletedViewerId: string | null = null;

	const purge = async (viewerId: string): Promise<"done" | "failed"> => {
		ports.onPhase("purging");
		try {
			await ports.purge(viewerId);
			ports.onPhase("done");
			return "done";
		} catch {
			/**
			 * The account cannot be revived; only this device's cleanup failed, and that is folded neither
			 * into success nor into deletion failure.
			 */
			ports.onPhase("cleanup-failed");
			return "failed";
		}
	};

	return {
		async run({ viewerId, password }) {
			if (deletedViewerId !== null) return { kind: "skipped", why: "terminal" };
			if (running) return { kind: "skipped", why: "pending" };
			if (!viewerId) return { kind: "skipped", why: "no-viewer" };
			running = true;
			ports.onPhase("deleting");
			try {
				const failure = await ports.deleteAccount(password);
				if (failure) {
					/** Nothing was deleted; the dialog retries with its values intact. */
					ports.onPhase("idle");
					return { kind: "refused", failure };
				}
				/** Irreversible from here. `running` is released but the latch above takes over. */
				deletedViewerId = viewerId;
				return { kind: "deleted", cleanup: await purge(viewerId) };
			} finally {
				running = false;
			}
		},

		async retryCleanup() {
			if (running) return { kind: "skipped", why: "pending" };
			const target = deletedViewerId;
			if (!target) return { kind: "skipped", why: "no-target" };
			running = true;
			try {
				return (await purge(target)) === "done"
					? { kind: "cleaned" }
					: { kind: "cleanup-failed" };
			} finally {
				running = false;
			}
		},
	};
}
