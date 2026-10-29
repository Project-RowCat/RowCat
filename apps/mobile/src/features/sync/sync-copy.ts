import { relativeTime } from "../../lib/format.ts";

/**
 * Sync section copy. All of it lives here.
 *
 * This app's tests do not render screens, so copy must be values for pure tests to check, and this
 * file becomes the one place to catch words we must not promise.
 *
 * ## What is absent from this file is the point
 *
 * - **No "real-time".** Changes from other devices arrive when the app reopens or returns to the
 *   foreground. That gap can be minutes rather than seconds, so promising real-time would be false.
 * - **No cryptographic implementation vocabulary.** AES, HKDF, DEK, cursor, epoch and
 *   serverVersion are words for diagnostics and tests. The screen says only that data is stored
 *   encrypted and the server cannot read the contents.
 * - **No "backup".** It reads as "we can restore it for you", which is the opposite of this
 *   design: if the recovery code is lost, the server's data cannot be opened by us either.
 * - **No device-list vocabulary.** The server chose not to know device identities, and drawing a
 *   list would make `Remote revoke` stand beside it, which is a lie today (see the web
 *   `sync-section.tsx` header).
 */

/* ── Status line────────────────────────────────────────────────────────────── */

export const SYNC_STATUS_CHECKING = "Checking…";
export const SYNC_STATUS_DISABLED = "Sync isn't set up.";
export const SYNC_STATUS_DISABLED_NOTE =
	"Once set up, your conversations and drafts continue on your other devices, encrypted. The server can't read them.";
export const SYNC_STATUS_LOCKED = "Locked on this device.";
/** States both routes; mentioning only pairing would make someone without another device read it as a dead end. */
export const SYNC_STATUS_LOCKED_NOTE =
	"Connect from another device that's already syncing, or enter your recovery code to continue on this device.";
export const SYNC_STATUS_SYNCING = "Syncing…";
export const SYNC_STATUS_NEVER_SYNCED = "Not synced yet.";
export const syncLastSyncedText = (iso: string): string =>
	`Last synced: ${relativeTime(iso)}`;

/**
 * Error code → sentence. Raw codes are never shown; they are our strings, not the user's. Every
 * failure also says that local edits are unaffected: a sync failure is not a save failure, and
 * without saying so the user reads the text they just wrote as at risk.
 */
const SYNC_ERROR_TEXT: Record<string, string> = {
	sync_quota_exceeded: "Sync storage is full.",
	sync_keyring_proof_invalid: "This device's key no longer matches.",
	/** A restricted account is only blocked from uploading; do not say sync as a whole is dead. */
	account_restricted:
		"A restricted account can't upload new changes. Changes from other devices keep coming in.",
	login_required: "Please sign in again.",
};

export const SYNC_ERROR_FALLBACK = "Sync failed. Please try again in a moment.";
export const SYNC_ERROR_LOCAL_SAFE =
	"Conversations and drafts on this device are intact. You can try again.";

export const syncErrorText = (
	code: string | null,
): { headline: string; note: string } => ({
	headline: SYNC_ERROR_TEXT[code ?? ""] ?? SYNC_ERROR_FALLBACK,
	note: SYNC_ERROR_LOCAL_SAFE,
});

/* ── Automatic sync line─────────────────────────────────────────────────────── */

export const SYNC_AUTO_DISABLED = "Automatic sync is off.";
export const SYNC_AUTO_OFFLINE = "Waiting while offline.";
export const SYNC_AUTO_RETRYING =
	"Waiting for a connection. Will try again shortly.";
export const SYNC_AUTO_BLOCKED = "Please check sync again.";
export const SYNC_AUTO_ENABLED = "Changes sync automatically.";

/* ── Actions───────────────────────────────────────────────────────────────── */

export const SYNC_SETUP_LABEL = "Set up sync";
export const SYNC_PAIR_LABEL = "Connect from another device";
export const SYNC_UNLOCK_LABEL = "Use recovery code";
export const SYNC_NOW_LABEL = "Sync now";
export const SYNC_APPROVE_LABEL = "Connect a new device";
export const SYNC_ROTATE_LABEL = "Reissue recovery code";
export const SYNC_FORGET_LABEL = "Stop trusting this device";
/**
 * The **third path** on the locked screen, with the same wording as web's button.
 *
 * Not called `Reset sync`: that reads as "restore settings to defaults", but what
 * actually happens is discarding the server's ciphertext, and the misreading only surfaces after
 * pressing. `Start over` (start over from scratch) states the outcome directly.
 */
export const SYNC_RESET_LABEL = "Start over";

export const SYNC_AUTO_TOGGLE_LABEL = "Automatic sync";
export const SYNC_AUTO_TOGGLE_NOTE =
	"Syncs changes on this device automatically. This setting is saved separately on each device.";

/**
 * Why there is no "sign out other devices" or "delete device" action: every trusted device shares
 * the same key, so remote revocation is impossible without rotating the key and re-uploading
 * everything. A button that exists but cannot actually block access would lie to the user.
 */
export const SYNC_FORGET_NOTE =
	"This applies only to this device. It doesn't block other devices, doesn't sign you out, and doesn't erase data stored on the server. Conversations and drafts on this device stay as they are.";

/* ── Start over (confirmation dialog)────────────────────────────────────────── */

/**
 * **The exit for an account with neither a key nor a recovery code.**
 *
 * Accounts where both earlier paths (pairing and recovery code) are blocked do exist. If someone
 * who briefly stole a session registers a keyring first, the rightful owner is stuck in `locked`;
 * someone who lost the recovery code on paper ends up in the same place. For those cases this
 * action is the only way out.
 *
 * The server requires **recent login** for it (`recent_login_required`), which is the cost of that
 * risk: a stolen session can only be used to delete ciphertext the attacker cannot read
 * (`docs/sync/ARCHITECTURE.md` §13).
 *
 * ## The copy states what remains first
 *
 * This is an irreversible action, and listing only what disappears would lead users to think this
 * device's drafts go too, which blocks the people who most need it. Most things remain: only the
 * server's ciphertext and this device's key are lost.
 */
export const SYNC_RESET_CONFIRM_TITLE = "Start sync over from the beginning?";
export const SYNC_RESET_CONFIRM_DESCRIPTION =
	"The sync data stored on the server and this device's key are deleted.";
export const SYNC_RESET_KEPT =
	"Conversations and drafts on this device stay as they are, and setting up sync again uploads them with a new key.";
/**
 * Keeps the other-devices sentence. It is the only fact about this action that happens **outside
 * this device**; without it, whoever opens the other device next reads their own data as lost.
 */
export const SYNC_RESET_OTHER_DEVICES =
	"Conversations and drafts on other devices stay too, and those devices need to set up sync again the next time they open.";
export const SYNC_RESET_CONFIRM_LABEL = "Start over";
export const SYNC_RESET_PENDING_LABEL = "Working…";
export const SYNC_RESET_CANCEL_LABEL = "Cancel";
