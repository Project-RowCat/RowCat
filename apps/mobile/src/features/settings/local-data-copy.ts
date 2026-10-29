/**
 * Copy for the local-data reset. What this file actually guards is the **facts** the sentences
 * state.
 *
 * The web's dialog was not copied over. That one talks about the browser, which is **false** in
 * this app; instead it lists what is really on this device:
 *
 * ```text
 * browser           this app has no tabs or browser
 * provider API key  **now exists.** It lives in Keychain/Keystore
 * ```
 *
 * The second line is the most recent change in this file. Until personal API key connections
 * existed, this copy said the app had no such store, which was true then. That premise is gone, so
 * the list widens too. If it were left out, the dialog would be **false**: users would read that
 * only conversations and drafts are erased, while connected provider keys are also lost.
 *
 * The list now covers one per-member SQLite database, the remembered sync key, and provider API
 * keys, and the deletion code removes exactly those (`lib/local-data/purge.ts`).
 *
 * ## The question this dialog must answer is not "is it really true?"
 *
 * Three: **what is lost · what remains · whether it can come back.** Without the last, the action
 * deceives the user: if the sync key is re-entered, the server's ciphertext comes back down, and
 * someone who did not know that reads the erase as having **failed**.
 */

export const LOCAL_DATA_SECTION_TITLE = "This device's data";
export const LOCAL_DATA_SECTION_DESCRIPTION =
	"Conversations and drafts in progress are saved on this device.";

export const LOCAL_DATA_ROW_LABEL = "Clear stored data";
export const LOCAL_DATA_ROW_DESCRIPTION =
	"Clears the conversations and drafts stored on this device. Your account and other devices' data stay as they are.";

/** Irreversible, so the name says exactly what it does. */
export const LOCAL_DATA_ACTION_LABEL = "Clear data";
export const LOCAL_DATA_PENDING_LABEL = "Clearing…";
export const LOCAL_DATA_CANCEL_LABEL = "Cancel";

export const LOCAL_DATA_CONFIRM_TITLE = "Clear this device's data?";
export const LOCAL_DATA_CONFIRM_DESCRIPTION =
	"Only what's stored on this device is cleared, and it can't be undone.";

/**
 * What is lost: **the things this app actually keeps on this device.**
 *
 * It is written as one list because the list is itself what gets verified
 * (`local-data-copy.test.ts`). The last two must not be dropped:
 *
 * ```text
 * sync key          if lost, sync locks on the next run; without saying so the app reads as broken
 * provider API key  if lost, every conversation on that provider stops, and we cannot give the key back
 * ```
 */
export const LOCAL_DATA_REMOVED =
	"Conversations and messages, memories, personas, drafts in progress, this device's generation settings, the remembered sync key and the connected AI provider API keys are cleared together.";

/**
 * What remains: **the difference from account deletion is stated first.**
 *
 * The two operations overlap in what they erase, so without this sentence the user would read that
 * they are deciding about their works and account.
 */
export const LOCAL_DATA_KEPT =
	"Your account stays. Published stories and comments and other devices' data don't disappear with this. The API keys on your AI provider accounts aren't revoked either.";

/**
 * The way back: **the server's ciphertext is not something this operation knows about.**
 *
 * That is why it does not say "permanently deleted": we cannot keep that promise. In practice,
 * re-entering the key on this device brings the copy back down.
 */
export const LOCAL_DATA_SYNC_NOTE =
	"If you use sync across devices, the encrypted copy kept on the server remains. Enter the key on this device again and that copy comes back down.";

/** What happens after erasing: neither logout nor restart. */
export const LOCAL_DATA_AFTER_NOTE =
	"After clearing you stay signed in, and this device's data starts over empty.";

/**
 * Failure: **the raw error is not drawn.** The only thing the user can do is try again, and SQLite
 * or Keychain error names do not say that.
 */
export const LOCAL_DATA_FAILURE_MESSAGE =
	"Couldn't clear the data. Please try again in a moment.";
