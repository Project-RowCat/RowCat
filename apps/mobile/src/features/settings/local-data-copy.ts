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

import { deferredGroup } from "../../lib/i18n/instance.ts";

/**
 * The sentences themselves live in the dictionaries (`settings.localData`, English and Korean); this
 * table reads them in the current language. `local-data-copy.test.ts` locks the English claims by
 * value, and a Korean translation must state the same three facts.
 */
export const LOCAL_DATA_COPY = deferredGroup("settings", "localData");
