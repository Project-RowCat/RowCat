import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useAccountDeletionPorts } from "../../lib/account-deletion.ts";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { deleteAccountErrorMessage } from "./delete-account-error.ts";
import {
	type AccountDeletionPhase,
	createAccountDeletionTurn,
} from "./deletion-turn.ts";

/**
 * React wiring for account deletion; no rules. Order, locking and the irreversible boundary live in
 * the pure coordinator (`deletion-turn.ts`); the four ports are implemented in
 * `lib/account-deletion.ts`.
 *
 * - Held at the screen root, not in `AccountContent` (`key={viewer.id}`): cache reset clears the
 *   viewer and unmounts the member branch, and losing progress then would leave no terminal panel.
 *   The target is a snapshot taken at request time, so cleanup and retry survive.
 * - Success navigates with `replace` so back cannot return to the deleted account's screen.
 */
export interface AccountDeletion {
	phase: AccountDeletionPhase;
	/**
	 * Whether the account is already gone; the screen branches on this alone. When true no profile,
	 * security or data section is drawn (private queries for a gone account hit a 401 wall).
	 */
	terminal: boolean;
	/** Failure text for inside the confirm dialog; set only in `idle`. */
	error: string | null;
	/** Requests server deletion; the password is passed only for credential accounts. */
	requestDelete: (password?: string) => void;
	/** Retries only this device cleanup; needs no authentication (the account is already gone). */
	retryCleanup: () => void;
}

const isTerminal = (phase: AccountDeletionPhase): boolean =>
	phase === "purging" || phase === "cleanup-failed" || phase === "done";

export function useAccountDeletion(): AccountDeletion {
	const router = useRouter();
	const identity = useMobileIdentity();
	const ports = useAccountDeletionPorts();

	const [phase, setPhase] = useState<AccountDeletionPhase>("idle");
	const [error, setError] = useState<string | null>(null);

	// Created once and held: recreating per render resets its lock and terminal latch, so a same-tick
	// second confirm or a second deletion after terminal would not be folded (same wiring as the
	// report and appeal turns).
	const turnRef = useRef<ReturnType<typeof createAccountDeletionTurn> | null>(
		null,
	);
	const portsRef = useRef(ports);
	portsRef.current = ports;
	if (turnRef.current === null)
		turnRef.current = createAccountDeletionTurn({
			deleteAccount: (password) => portsRef.current.deleteAccount(password),
			purge: (viewerId) => portsRef.current.purge(viewerId),
			onPhase: setPhase,
		});
	const turn = turnRef.current;

	// The target is the viewer at request time; the coordinator keeps that copy past terminal, so a
	// cleanup retry still knows which files to delete after the cache clears the viewer.
	const viewerId = identity.session.viewer?.id ?? null;

	const finishIfDone = useCallback(
		(cleanup: "done" | "failed"): void => {
			if (cleanup === "done") router.replace("/login");
		},
		[router],
	);

	const requestDelete = useCallback(
		(password?: string): void => {
			setError(null);
			void turn.run({ viewerId, password }).then((result) => {
				// A folded second confirm leaves state alone; the running execution owns it.
				if (result.kind === "skipped") return;
				if (result.kind === "refused") {
					setError(deleteAccountErrorMessage(result.failure));
					return;
				}
				finishIfDone(result.cleanup);
			});
		},
		[turn, viewerId, finishIfDone],
	);

	const retryCleanup = useCallback((): void => {
		void turn.retryCleanup().then((result) => {
			if (result.kind === "cleaned") router.replace("/login");
		});
	}, [turn, router]);

	return useMemo(
		() => ({
			phase,
			terminal: isTerminal(phase),
			error,
			requestDelete,
			retryCleanup,
		}),
		[phase, error, requestDelete, retryCleanup],
	);
}
