import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import type { AuthFailure } from "#/features/auth/auth-error.ts";
import { authClient } from "#/lib/auth.ts";
import { translator } from "#/lib/i18n/current.ts";
import { purgeDeletedViewerLocally } from "#/lib/local-data/purge.ts";
import { useLocalDataScope } from "#/lib/local-data/scope.tsx";
import {
	deleteAccountErrorMessage,
	logDeleteAccountFailure,
} from "./delete-account-error.ts";

/**
 * One progress state for account deletion. The screens (the section, the confirm dialog and the
 * done panel) all read this value.
 *
 * It is not split into several booleans. `deleting` and `purging` both look like "in progress", but
 * they differ in whether they can be undone: cancelling `deleting` changes nothing, while `purging`
 * happens after the account is **already gone**. As booleans that difference would scatter across
 * screen conditions, and one mismatch would open a path back to a deleted account's screen.
 *
 * ```text
 * idle            Nothing has happened yet. Closing the confirm dialog ends it.
 * deleting        Server asked to delete. On failure, back to idle (nothing was deleted).
 * ─────────────── Nothing below this line can be undone ───────────────
 * purging         The account is gone. Cleaning up this device.
 * cleanup-failed  The account is gone; only this device's cleanup failed.
 * done            Cleanup finished. Leaving for the login screen.
 * ```
 */
export type AccountDeletionPhase =
	| "idle"
	| "deleting"
	| "purging"
	| "cleanup-failed"
	| "done";

/** Is it below the line: has the account already been deleted? */
const isTerminal = (phase: AccountDeletionPhase): boolean =>
	phase === "purging" || phase === "cleanup-failed" || phase === "done";

export interface AccountDeletion {
	phase: AccountDeletionPhase;
	/**
	 * Whether the account has already been deleted.
	 *
	 * The account screen branches on this one value. When true it draws no profile, security or data
	 * sections: it would otherwise try to refetch the email of a deleted account, and that lookup
	 * fails with a 401.
	 */
	terminal: boolean;
	/** Failure message for the confirm dialog. Only has a value before the line (`idle`). */
	error: string | null;
	/** Requests server-side deletion. The password is passed only for password-credential accounts. */
	requestDelete: (password?: string) => void;
	/** Retries only the device cleanup. **No authentication is needed**, since the account is already gone. */
	retryCleanup: () => void;
}

export function useAccountDeletion(): AccountDeletion {
	const scope = useLocalDataScope();
	const queryClient = useQueryClient();
	const router = useRouter();

	const [phase, setPhase] = useState<AccountDeletionPhase>("idle");
	const [error, setError] = useState<string | null>(null);

	/**
	 * Blocks a second click in the same tick.
	 *
	 * `phase` alone is not enough. State updates wait for a commit, so the second event of a fast
	 * double click still reads `idle`, and an irreversible request would go out twice. The server
	 * rejects the second with a 401, but on the client two cleanup flows would race on the same
	 * database.
	 */
	const running = useRef(false);

	/**
	 * Member id for the cleanup retry.
	 *
	 * Captured **before deletion**. Once deletion succeeds the viewer cache is cleared, and after that
	 * nothing (not the server, the session or the scope) can say which database to clean up. This ref
	 * is the only copy of that information.
	 */
	const purgeTarget = useRef<string | null>(null);

	/**
	 * Device cleanup. On success, leaves for the login screen.
	 *
	 * `replace` is the point: it leaves no back-navigation entry to the account screen. Going back
	 * would be blocked by the guard anyway, but there is no reason to keep a private screen's address
	 * in history.
	 */
	const runPurge = useCallback(
		async (viewerId: string): Promise<void> => {
			setPhase("purging");
			try {
				await purgeDeletedViewerLocally({ viewerId, scope, queryClient });
				setPhase("done");
				await router.navigate({ to: "/login", replace: true });
			} catch (failure) {
				/**
				 * There is no way to restore the account here. Only this device's cleanup failed, and folding
				 * that into success would tell the user the data was deleted from this device when it was not.
				 * We also do not return to the account screen, because there is no account left to return to.
				 */
				console.error(
					translator("account")("useAccountDeletion.accountCouldNotEraseThis"),
					failure,
				);
				setPhase("cleanup-failed");
			}
		},
		[scope, queryClient, router],
	);

	const requestDelete = useCallback(
		(password?: string): void => {
			if (running.current) return;
			running.current = true;

			const viewerId = scope.viewerId;
			purgeTarget.current = viewerId;
			setError(null);
			setPhase("deleting");

			void (async () => {
				/**
				 * Calls the Better Auth client directly. This is the only write that bypasses `@rowcat/sdk`.
				 * The reason for the exception is written in the server config (`apps/api/src/auth/index.ts`):
				 * deletion removes the authentication identity, and we reuse the auth layer's endpoint so no
				 * password field is added to our contract.
				 *
				 * **When a response arrives** it returns `{ error }`. If no response arrives at all (the server
				 * was unreachable), the promise rejects, and that branch must be caught. Otherwise the flow
				 * stays in `deleting` forever, with the button stuck on "deleting" and the duplicate guard
				 * locked, and the user cannot tell whether the account was deleted. This only shows up when
				 * that state is actually produced in a browser.
				 *
				 * Folding the thrown failure into a failure with no status code is correct: it means "no
				 * response was received", and the message says so (the server may already have deleted the
				 * account).
				 */
				const failure = await authClient
					.deleteUser(password ? { password } : {})
					.then((result) => result.error ?? null)
					.catch((thrown: unknown): AuthFailure => {
						/*
						 * The caught error message is not shown on screen. It can contain internal details such as
						 * the request URL. Only the fact that no response arrived is needed.
						 */
						logDeleteAccountFailure({ code: "fetch_failed" });
						console.error(
							translator("account")(
								"useAccountDeletion.accountCouldNotSendThe",
							),
							thrown,
						);
						return {};
					});

				if (failure) {
					logDeleteAccountFailure(failure as AuthFailure);
					setError(deleteAccountErrorMessage(failure as AuthFailure));
					setPhase("idle");
					running.current = false;
					return;
				}

				/**
				 * From here on nothing can be undone. `running` is **not released**: the flow never ends. It
				 * either leaves for the login screen or stops on the cleanup-failure screen.
				 */
				if (!viewerId) {
					/*
					 * No path should reach here without knowing the viewer (the account screen is drawn only after
					 * the viewer is confirmed). Even so, do not invent a name to delete: deleting the wrong
					 * database is far worse than failing to delete the right one.
					 */
					setPhase("cleanup-failed");
					return;
				}
				await runPurge(viewerId);
			})();
		},
		[scope.viewerId, runPurge],
	);

	const retryCleanup = useCallback((): void => {
		const viewerId = purgeTarget.current;
		if (!viewerId) return;
		void runPurge(viewerId);
	}, [runPurge]);

	return {
		phase,
		terminal: isTerminal(phase),
		error,
		requestDelete,
		retryCleanup,
	};
}
