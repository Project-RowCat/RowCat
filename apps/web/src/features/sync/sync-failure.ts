/**
 * Messages for sync screen actions whose failures cannot be explained by the status line. The
 * screen has two kinds of action. Setup and sync-now run through the controller's state machine,
 * and the status line states the reason. The actions here do not: rotate recovery code, forget
 * device, and the auto-sync toggle. Their failures do not set `SyncSnapshot.lastError` (which
 * belongs to pull, push and unlock), and no part of the screen changes, so to the user the button
 * appears to do nothing. Only these three get toasts.
 *
 * Failure causes are not distinguished, matching this screen's existing rule. The user can do the
 * same thing whatever the cause (press again), and protocol error codes would show text the user
 * cannot act on.
 *
 * Each message states that no data was lost. Failures on this screen are usually read as 'is my
 * conversation at risk?', and none of these three operations touches local data.
 *
 * They are functions, not constants: the sentence depends on the request's locale, and a module
 * constant would freeze the first request's language for every request after it.
 */
import { translator } from "#/lib/i18n/current.ts";

/**
 * The auto-sync toggle could not be saved on this device. Only the schedule setting is unchanged;
 * sync itself is still active.
 */
export const autoSyncToggleFailed = (): string =>
	translator("sync")("failure.autoSyncToggle");

/**
 * A new recovery code could not be issued. The old code still works, and that fact is the point of
 * this message. Rotation re-wraps the keyring, so a failure leaves the server keyring unchanged.
 * Without saying so, users read 'could not get a new code' as 'the old code fails too' and discard
 * what they wrote down.
 */
export const recoveryRotateFailed = (): string =>
	translator("sync")("failure.recoveryRotate");

/** Trust for this device could not be revoked. The key remains on this device. */
export const forgetDeviceFailed = (): string =>
	translator("sync")("failure.forgetDevice");
