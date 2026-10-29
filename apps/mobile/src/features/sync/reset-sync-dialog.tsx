import { AlertDialog } from "@rowcat/ui-native";
import { useRef, useState } from "react";
import {
	SYNC_RESET_CANCEL_LABEL,
	SYNC_RESET_CONFIRM_DESCRIPTION,
	SYNC_RESET_CONFIRM_LABEL,
	SYNC_RESET_CONFIRM_TITLE,
	SYNC_RESET_KEPT,
	SYNC_RESET_OTHER_DEVICES,
	SYNC_RESET_PENDING_LABEL,
} from "./sync-copy.ts";
import { resetFailureMessage } from "./sync-failure.ts";

/**
 * Confirmation dialog for resetting sync — **the exit for an account that is locked with no key.**
 *
 * Same place, same facts and same order as web's `features/sync/reset-sync-dialog.tsx`. Only the
 * container differs: web uses `Dialog` with a destructive button, while this app uses
 * `AlertDialog`, which is the slot in this app's presentation table for an irreversible
 * confirmation. That primitive also refuses to close on backdrop tap and does not pre-focus the
 * confirm action.
 *
 * ## The copy says what is kept first
 *
 * Three sentences form one description (their values live in `sync-copy.ts`). Listing only what is
 * lost would lead users to think this device's drafts are gone too, and that misreading blocks the
 * people who most need this action. What is actually lost is the server's ciphertext and this
 * device's key.
 *
 * ## Failure has two branches, and the decision is not restated here
 *
 * Only a failure requiring recent login gets different copy, because the user's next step there is
 * to sign in again rather than press again. That decision and its copy live in `sync-failure.ts`,
 * which calls the account-security slice's `needsRecentLogin` directly.
 *
 * ## The dialog stays open on failure
 *
 * Closing and then reporting would make the user read an unperformed action as performed and leave.
 * Only success closes it; the status line changing to "sync is not set up" is the evidence of the
 * result.
 */
export function ResetSyncDialog({
	open,
	onClose,
	onReset,
}: {
	open: boolean;
	onClose: () => void;
	onReset: () => Promise<void>;
}) {
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	/**
	 * One confirmation is one reset.
	 *
	 * `pending` is `setState`, so a second press in the same tick still sees `false`. The synchronous
	 * latch closes that window; even if the server is idempotent, a screen that runs twice is
	 * confusing.
	 */
	const pendingRef = useRef(false);

	const confirm = async (): Promise<void> => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			await onReset();
			onClose();
		} catch (failure) {
			setError(resetFailureMessage(failure));
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

	return (
		<AlertDialog
			open={open}
			title={SYNC_RESET_CONFIRM_TITLE}
			description={[
				SYNC_RESET_CONFIRM_DESCRIPTION,
				SYNC_RESET_KEPT,
				SYNC_RESET_OTHER_DEVICES,
			].join("\n\n")}
			confirmLabel={
				pending ? SYNC_RESET_PENDING_LABEL : SYNC_RESET_CONFIRM_LABEL
			}
			cancelLabel={SYNC_RESET_CANCEL_LABEL}
			destructive
			busy={pending}
			error={error}
			onConfirm={() => void confirm()}
			/** Does not close while running; the primitive decides that through `busy`. */
			onCancel={() => {
				setError(null);
				onClose();
			}}
		/>
	);
}
