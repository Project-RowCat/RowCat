import { deviceValueStorage } from "../device-storage.ts";
import {
	createPushPreferenceStore,
	PUSH_PREFERENCE_KEY,
	type PushPreferenceStore,
} from "./preference.ts";

/**
 * Native wiring of the receive decision: one device key-value entry.
 *
 * All rules live in `preference.ts`; this file only decides *which key*. Same split and reason as
 * `device-installation.ts`: once a native module is imported the file cannot be opened in Node, so
 * the untestable code is kept minimal.
 *
 * **Not the member database.** This installation's decision must be the same whether or not anyone
 * is signed in, and it is not a value a member's local-data reset should erase.
 */
export const pushPreferenceStore: PushPreferenceStore =
	createPushPreferenceStore(deviceValueStorage(PUSH_PREFERENCE_KEY));
