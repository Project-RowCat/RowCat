import { SYNC_ERROR_CODE } from "@rowcat/contracts";
import {
	needsRecentLogin,
	RECENT_LOGIN_REQUIRED,
} from "../account/security-error.ts";

/**
 * Sentences for when a sync-screen action cannot be explained by the status line. The web
 * counterpart is `features/sync/sync-failure.ts`.
 *
 * Failures on this screen come in two kinds:
 *
 * ```text
 * actions that pass the controller's state machine   setup · sync now   → the status line gives the reason
 * actions that do not                                reissue · forget device · auto-sync toggle
 *                                                    → the screen does not change at all
 * ```
 *
 * The last three do not set `SyncSnapshot.lastError` on failure, so staying silent would make the
 * button look like it did nothing. This app has no toasts; failures are stated inline by a `Notice`
 * in the section (`docs/design/FAILURE-FEEDBACK.md`: inline wherever the interaction surface
 * remains).
 *
 * **Each sentence states that nothing was lost.** None of these three touch local data.
 */

export const AUTO_SYNC_TOGGLE_FAILED =
	"Couldn't save the automatic sync setting. Please try again in a moment.";

/**
 * Reissue failure. **That the old code still works is the whole point of this sentence.** Without
 * it, the user reads "could not get a new code" as "the old one is unusable too" and throws away
 * the paper they wrote it on.
 */
export const RECOVERY_ROTATE_FAILED =
	"Couldn't issue a new recovery code. Your current code still works.";

export const FORGET_DEVICE_FAILED =
	"Couldn't stop trusting this device. Please try again in a moment.";

/**
 * Recovery-code unlock failure. Two branches are split.
 *
 * A checksum mismatch (a character was mistyped; checking again fixes it) and an AEAD failure (the
 * format is valid but the code is not this account's; a different code is needed) call for
 * different next steps. Folding them into one sentence would leave the user unable to tell which
 * applies.
 */
export function unlockFailureMessage(failure: unknown): string {
	const name = failure instanceof Error ? failure.name : "";
	if (name === "SyncCodecError")
		return "Please check the recovery code again. Some characters are wrong.";
	return "This code can't unlock sync. Please check whether it's a different code.";
}

/**
 * Approval failure (trusted-device side). Separates a typo from "no such session". The first is
 * fixed by retyping; the second requires the new device to generate a fresh code.
 */
export function approveFailureMessage(failure: unknown): string {
	const row = failure as { name?: string; code?: string; message?: string };
	if (row?.name === "SyncCodecError")
		return "Please check the code again. It's 16 characters.";
	if (row?.code === SYNC_ERROR_CODE.pairingNotFound)
		return "No device is waiting with that code. It may have expired.";
	if (row?.code === SYNC_ERROR_CODE.pairingAlreadyApproved)
		return "This code has already been approved.";
	if (row?.code === "account_restricted")
		return "A restricted account can't connect new devices.";
	if (row?.message === SYNC_ERROR_CODE.locked)
		return "This device is locked, so it can't approve.";
	return "Couldn't approve. Please try again in a moment.";
}

/**
 * Terminal pairing failure (new-device side) → sentence. Returns `null` for transient failures,
 * which keep waiting.
 *
 * The most important branch is `PairingKeyRejectedError`: at that moment this device **remembered
 * nothing**, and without saying so the user would read it as something having been saved wrongly.
 */
export function pairingTerminalMessage(failure: unknown): string | null {
	const row = failure as { name?: string; code?: string } | null;
	if (row?.name === "PairingKeyRejectedError")
		return "The key received doesn't belong to this account. Nothing was saved on this device.";
	if (row?.code === SYNC_ERROR_CODE.pairingNotFound)
		return "The connection expired or was cancelled. Please start again.";
	if (row?.name === "SyncCryptoError" || row?.name === "SyncCodecError")
		return "Couldn't finish connecting. Check the code and try again from the start.";
	if (row?.code === "login_required") return "Please sign in again.";
	return null;
}

export const PAIRING_START_FAILED =
	"Couldn't start connecting. Please try again in a moment.";
export const PAIRING_POLL_UNREACHABLE =
	"Couldn't check the connection. Please check your network.";

/**
 * Failure of `Start over` → sentence. **Two branches are split.**
 *
 * The server requires recent login for this action (`requireFreshSession`, 24 hours), and our
 * session lifetime is 30 days, so **for someone signed in for a long time this is the normal
 * path.** Folding that failure into a generic one would keep the person pressing the same button,
 * when the state only clears by signing in again, not by waiting.
 *
 * The decision is not restated here. `needsRecentLogin` in the account-security slice owns it (it
 * checks both RowCat's and Better Auth's codes). Two copies would drift: fixing one would strand
 * someone in this dialog who could have been guided. The sentence also reuses that slice's copy,
 * because two sentences for the same fact would make the user read a different event had occurred.
 *
 * **Nothing lost** holds for this failure as well: a failed reset touches neither the server's
 * ciphertext nor this device's key.
 */
export const SYNC_RESET_FAILED =
	"Couldn't clear sync data on the server. Please try again in a moment.";

export function resetFailureMessage(failure: unknown): string {
	return needsRecentLogin(failure) ? RECENT_LOGIN_REQUIRED : SYNC_RESET_FAILED;
}
